"""FIX3-04 — گزارش سازگاری امبدینگ + ابزار reindex واقعی (ADR-0051).

وضعیت پیش از این fix (FIX2-03): هویت provider/model روی chunk ثبت
می‌شد و status فقط «reindex توصیه می‌شود» می‌گفت؛ نه گزارش گروهی
سازگاری بود، نه ابزاری که واقعاً بازنمایه کند. بردارهای پروجکشن
قدیم (برش سادهٔ پیش از FIX2-03) هم هیچ نشانی نداشتند.

قرارداد این fix:
- هر chunk تازه، هویت کامل (provider, model, projection) می‌گیرد؛
  projection فعلی PROJECTION_ID («folding-v1») است و NULL یعنی
  legacyِ نامعلوم → ناسازگار.
- chunk_compatibility_report گروه‌ها را با شمار و پرچم سازگاری
  می‌دهد و روی semantic_search_status سوار است.
- run_reindex / CLI (python -m app.modules.fatwa.reindex):
  dry-run بدون نوشتن، پردازش batchای به ترتیب id با checkpoint،
  اجرای دوباره no-op، و توقف روشنِ بدون نوشتن وقتی provider نیست.
"""
from __future__ import annotations

import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import delete

from app.models.models import FiqhKnowledgeChunk
from app.modules.fatwa import embeddings as emb
from app.modules.fatwa import reindex as reindex_mod

API_DIR = Path(__file__).resolve().parents[1]
_MARKER = "fix3_test"
_TEXTS = [
    "حکم نماز مسافر در سفر شرعی قصر است و شرایط آن در کتب فقهی آمده است",
    "زکات مال وقتی به نصاب برسد و حول کامل شود واجب می‌گردد",
    "روزهٔ مسافر رخصت دارد و قضای آن در ایام دیگر انجام می‌شود",
]


@pytest.fixture(autouse=True)
async def _cleanup_chunks(tc):
    async with tc["maker"]() as db:
        await db.execute(
            delete(FiqhKnowledgeChunk).where(
                FiqhKnowledgeChunk.source_type == _MARKER
            )
        )
        await db.commit()
    yield
    async with tc["maker"]() as db:
        await db.execute(
            delete(FiqhKnowledgeChunk).where(
                FiqhKnowledgeChunk.source_type == _MARKER
            )
        )
        await db.commit()


def _vec(seed: float = 1.0) -> list[float]:
    v = [0.0] * emb.EMBEDDING_DIM
    v[0] = seed
    return v


async def _seed(tc, specs: list[dict]) -> list[uuid.UUID]:
    """specs: dictهای identity/vector؛ خروجی: idها به همان ترتیب."""
    provider = emb.HashEmbeddingProvider()
    ids: list[uuid.UUID] = []
    async with tc["maker"]() as db:
        for i, spec in enumerate(specs):
            text = spec.get("text", _TEXTS[i % len(_TEXTS)])
            vec = spec.get("vector")
            if vec is None:
                vec = (await provider.embed([text]))[0]
            chunk = FiqhKnowledgeChunk(
                id=spec.get("id") or uuid.uuid4(),
                chunk_text=text,
                embedding=list(vec),
                embedding_vec=None,
                embedding_provider=spec.get("provider", "hash"),
                embedding_model=spec.get("model", "hash-trigram-v1"),
                embedding_projection=spec.get("projection", emb.PROJECTION_ID),
                source_type=_MARKER,
                workflow_status="approved",
                ai_scopes=["fatwa"],
            )
            db.add(chunk)
            ids.append(chunk.id)
        await db.commit()
    return ids


async def _get(tc, cid: uuid.UUID) -> FiqhKnowledgeChunk:
    async with tc["maker"]() as db:
        return await db.get(FiqhKnowledgeChunk, cid)


def _is_current(chunk: FiqhKnowledgeChunk) -> bool:
    return (
        chunk.embedding_provider == "hash"
        and chunk.embedding_model == "hash-trigram-v1"
        and chunk.embedding_projection == emb.PROJECTION_ID
        and chunk.embedding is not None
        and len(chunk.embedding) == emb.EMBEDDING_DIM
    )


# ------------------------------------------------------------ گزارش


async def test_compatibility_report_groups_and_flags(tc):
    await _seed(
        tc,
        [
            {},  # سازگار
            {"provider": "external_api", "model": "text-embedding-3"},
            {"provider": None, "model": None, "projection": None},  # legacy
            {"projection": "slice-v0"},  # پروجکشن قدیم
            {"vector": [0.5] * 8},  # بُعد غلط
        ],
    )
    async with tc["maker"]() as db:
        report = await emb.chunk_compatibility_report(db)
    assert report["current"] == {
        "provider": "hash",
        "model": "hash-trigram-v1",
        "projection": emb.PROJECTION_ID,
        "dim": emb.EMBEDDING_DIM,
    }
    groups = report["groups"]
    ext = [g for g in groups if g["provider"] == "external_api"]
    assert ext and ext[0]["count"] == 1 and ext[0]["compatible"] is False
    legacy = [g for g in groups if g["provider"] is None]
    assert legacy and legacy[0]["count"] == 1 and legacy[0]["compatible"] is False
    old_proj = [g for g in groups if g["projection"] == "slice-v0"]
    assert old_proj and old_proj[0]["compatible"] is False
    wrong_dim = [g for g in groups if g["dim"] == 8]
    assert wrong_dim and wrong_dim[0]["compatible"] is False
    assert report["chunks_incompatible"] >= 4
    assert report["reindex_recommended"] is True


async def test_status_carries_compatibility_report(tc):
    await _seed(tc, [{"provider": None, "model": None, "projection": None}])
    async with tc["maker"]() as db:
        status = await emb.semantic_search_status(db)
    assert "compatibility" in status
    assert status["compatibility"]["chunks_incompatible"] >= 1


# ------------------------------------------------------------- اجرا


async def test_dry_run_writes_nothing(tc):
    ids = await _seed(
        tc,
        [
            {"provider": None, "model": None, "projection": None,
             "vector": _vec()},
            {"projection": "slice-v0", "vector": _vec()},
        ],
    )
    before = {cid: (await _get(tc, cid)).embedding for cid in ids}
    async with tc["maker"]() as db:
        result = await reindex_mod.run_reindex(db, dry_run=True, log=lambda s: None)
    assert result["status"] == "ok"
    assert result["total_incompatible"] >= 2
    assert result["processed"] == 0
    for cid in ids:
        after = await _get(tc, cid)
        assert after.embedding == before[cid]
        assert not _is_current(after)


async def test_reindex_makes_all_current_and_changes_vectors(tc):
    ids = await _seed(
        tc,
        [
            {"provider": None, "model": None, "projection": None,
             "vector": _vec()},
            {"provider": "external_api", "model": "text-embedding-3",
             "vector": _vec()},
            {},
        ],
    )
    legacy_before = (await _get(tc, ids[0])).embedding
    lines: list[str] = []
    async with tc["maker"]() as db:
        result = await reindex_mod.run_reindex(
            db, batch_size=2, log=lines.append
        )
    assert result["status"] == "ok"
    assert result["processed"] >= 2
    assert any("processed 2/" in line for line in lines)
    for cid in ids:
        assert _is_current(await _get(tc, cid)), f"chunk {cid} not current"
    legacy_after = (await _get(tc, ids[0])).embedding
    assert legacy_after != legacy_before, "بردار ناسازگار باید واقعاً عوض شود"
    expected = (await emb.HashEmbeddingProvider().embed([_TEXTS[0]]))[0]
    assert legacy_after == expected

    # اجرای دوباره: no-op کامل
    async with tc["maker"]() as db:
        again = await reindex_mod.run_reindex(db, log=lambda s: None)
    assert again["status"] == "nothing_to_do"
    assert again["processed"] == 0


async def test_reindex_resume_from_checkpoint(tc):
    fixed = [uuid.uuid4() for _ in range(3)]
    for fid in fixed:
        await _seed(
            tc,
            [{"id": fid, "provider": None, "model": None,
              "projection": None, "vector": _vec()}],
        )
    ordered_ids = sorted(fixed)
    first, rest = ordered_ids[0], ordered_ids[1:]
    async with tc["maker"]() as db:
        result = await reindex_mod.run_reindex(
            db, resume_from=first, log=lambda s: None
        )
    assert result["status"] == "ok"
    assert not _is_current(await _get(tc, first)), (
        "chunkِ قبل از checkpoint نباید دست بخورد"
    )
    for cid in rest:
        assert _is_current(await _get(tc, cid))


async def test_reindex_provider_unavailable_writes_nothing(tc, monkeypatch):
    ids = await _seed(
        tc,
        [{"provider": None, "model": None, "projection": None,
          "vector": _vec()}],
    )

    async def _boom(db, name=None):
        raise emb.EmbeddingProviderError("کلید واقعی در دسترس نیست (تست)")

    monkeypatch.setattr(reindex_mod, "get_embedding_provider", _boom)
    async with tc["maker"]() as db:
        result = await reindex_mod.run_reindex(db, log=lambda s: None)
    assert result["status"] == "provider_unavailable"
    assert result["processed"] == 0
    assert not _is_current(await _get(tc, ids[0]))


# ------------------------------------------------- CLI واقعی (subprocess)


def _build_cli_db(path: Path) -> None:
    """دیتابیس خصوصی CLI: یک chunk legacy + یک chunk جاری."""
    import asyncio as _asyncio

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.core.database import Base
    from app.models import models  # noqa: F401 — رجیستر مدل‌ها روی Base

    async def _setup() -> None:
        engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        provider = emb.HashEmbeddingProvider()
        good_vec = (await provider.embed([_TEXTS[0]]))[0]
        async with maker() as db:
            db.add(
                FiqhKnowledgeChunk(
                    chunk_text=_TEXTS[1],
                    embedding=_vec(),
                    embedding_provider=None,
                    embedding_model=None,
                    embedding_projection=None,
                    source_type=_MARKER,
                    workflow_status="approved",
                    ai_scopes=["fatwa"],
                )
            )
            db.add(
                FiqhKnowledgeChunk(
                    chunk_text=_TEXTS[0],
                    embedding=list(good_vec),
                    embedding_provider="hash",
                    embedding_model="hash-trigram-v1",
                    embedding_projection=emb.PROJECTION_ID,
                    source_type=_MARKER,
                    workflow_status="approved",
                    ai_scopes=["fatwa"],
                )
            )
            await db.commit()
        await engine.dispose()

    _asyncio.run(_setup())


def _run_cli(db_path: Path, *args: str) -> subprocess.CompletedProcess:
    import os

    env = dict(os.environ)
    env["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path}"
    env["APP_ENV"] = "dev"
    env["PYTHONPATH"] = str(API_DIR)
    return subprocess.run(
        [sys.executable, "-m", "app.modules.fatwa.reindex", *args],
        cwd=API_DIR, env=env, capture_output=True, text=True, timeout=180,
        check=False,
    )


def test_cli_end_to_end(tmp_path):
    db_path = tmp_path / "cli_reindex.db"
    _build_cli_db(db_path)

    r = _run_cli(db_path, "--report")
    assert r.returncode == 0, r.stderr[-500:]
    assert "incompatible=1" in r.stdout

    r = _run_cli(db_path, "--dry-run")
    assert r.returncode == 0, r.stderr[-500:]
    assert "would be re-embedded" in r.stdout

    r = _run_cli(db_path)
    assert r.returncode == 0, r.stderr[-500:]
    assert "re-embedded" in r.stdout

    r = _run_cli(db_path, "--report")
    assert r.returncode == 0, r.stderr[-500:]
    assert "incompatible=0" in r.stdout
