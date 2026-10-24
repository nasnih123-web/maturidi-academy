"""Remediation Pass 4 — Group C regression tests.

C1 dispatcher backoff anchored to last_attempt_at (not created_at).
C2 pgvector/full-identity retrieval (model/projection/legacy).
C3 compatibility report inspects embedding_vec (PG) / reports the gap.
C4 failed ingestion commits its failure (no orphan "queued").
C5 Redis listener reconnects with bounded backoff, single-flight.
C6 /health stays liveness; /ready probes the DB (503 when down).
C8 reindex per-record failures + summary + checkpoint, no raw traceback.
C9 migration b5c6d7e8f9a0 downgrade refuses on duplicate triples.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dispatcher import RedisBus, dispatch_once
from app.models.models import DomainEvent, FiqhKnowledgeChunk, IngestionRun
from app.modules.fatwa import embeddings as emb
from app.modules.fatwa.ingestion import run_ingestion

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------- C1
@pytest.fixture()
async def file_db(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path}/events.db"
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


class _FailBus:
    def __init__(self) -> None:
        self.attempts = 0

    async def publish(self, message: dict) -> None:
        self.attempts += 1
        raise RuntimeError("bus down")


async def _seed_old_event(file_db, retry_count: int):
    async with file_db() as db:
        ev = DomainEvent(
            event_type="test.tick",
            aggregate_type="test",
            aggregate_id="pass4-c1",
            payload={},
            created_at=datetime.now(UTC) - timedelta(hours=1),
            retry_count=retry_count,
            last_attempt_at=datetime.now(UTC),
        )
        db.add(ev)
        await db.commit()
        return ev.event_id


async def _get_event(file_db, event_id):
    async with file_db() as db:
        return await db.get(DomainEvent, event_id)


async def _rewind_last_attempt(file_db, event_id, seconds: int):
    async with file_db() as db:
        ev = await db.get(DomainEvent, event_id)
        ev.last_attempt_at = datetime.now(UTC) - timedelta(seconds=seconds)
        await db.commit()


async def test_c1_old_event_does_not_retry_immediately(file_db):
    """رویداد ۱ ساعت پیش با retry=1 و تلاشِ همین‌الان: dispatch نباید
    فوراً retry کند (پیش از fix، مبنا created_at بود و فوراً retry
    می‌شد) و نباید dead-letter شود."""
    event_id = await _seed_old_event(file_db, retry_count=1)
    bus = _FailBus()
    assert await dispatch_once(file_db, bus, worker_id="w1") == 0
    assert bus.attempts == 0
    ev = await _get_event(file_db, event_id)
    assert ev.retry_count == 1 and ev.failed_at is None


async def test_c1_backoff_steps_then_dead_letter_only_at_five(file_db):
    event_id = await _seed_old_event(file_db, retry_count=1)
    bus = _FailBus()
    # هر گام: فقط وقتی delay از آخرین تلاش گذشته، دقیقاً یک تلاش.
    # delayها: retry1→2s, retry2→4s, retry3→8s, retry4→16s.
    for retry_before, delay in [(1, 2), (2, 4), (3, 8), (4, 16)]:
        await _rewind_last_attempt(file_db, event_id, delay + 1)
        assert await dispatch_once(file_db, bus, worker_id="w1") == 0
        ev = await _get_event(file_db, event_id)
        assert ev.retry_count == retry_before + 1
        if retry_before < 4:
            assert ev.failed_at is None
    assert bus.attempts == 4
    ev = await _get_event(file_db, event_id)
    assert ev.failed_at is not None  # دقیقاً در retry پنجم dead-letter
    await dispatch_once(file_db, bus, worker_id="w1")
    assert bus.attempts == 4  # مرده دیگر تلاش نمی‌شود


# ---------------------------------------------------------------- C2/C3
@pytest.fixture(autouse=True)
async def _cleanup_chunks(tc):
    yield
    async with tc["maker"]() as db:
        await db.execute(
            delete(FiqhKnowledgeChunk).where(
                FiqhKnowledgeChunk.source_type == "pass4_c_test"
            )
        )
        await db.commit()


async def _add_chunk_c(db, text_value, vector, provider, model, projection):
    chunk = FiqhKnowledgeChunk(
        chunk_text=text_value,
        embedding=list(vector),
        embedding_provider=provider,
        embedding_model=model,
        embedding_projection=projection,
        source_type="pass4_c_test",
        workflow_status="approved",
        ai_scopes=["fatwa"],
    )
    db.add(chunk)
    await db.flush()
    return chunk


async def test_c2_full_identity_never_gets_semantic_score(tc):
    provider = emb.HashEmbeddingProvider()
    query = "حکم نماز مسافر در سفر چیست"
    query_vec = (await provider.embed([query]))[0]
    async with tc["maker"]() as db:
        good = await _add_chunk_c(
            db, "نماز مسافر قصر خوانده می‌شود", query_vec,
            "hash", "hash-trigram-v1", "folding-v1",
        )
        wrong_model = await _add_chunk_c(
            db, "متن نامرتبط آشپزی", query_vec,
            "hash", "other-model-v9", "folding-v1",
        )
        wrong_proj = await _add_chunk_c(
            db, "متن نامرتبط نجاری", query_vec,
            "hash", "hash-trigram-v1", "legacy-slice",
        )
        legacy = await _add_chunk_c(
            db, "ردیف قدیمی بدون هویت", query_vec, None, None, None,
        )
        await db.commit()
    # top_k بزرگ: DB تست بین فایل‌ها مشترک است و chunkهای تست‌های
    # دیگر هم در اسکن Backend B هستند — رتبه‌بندیِ سراسری نباید
    # chunkهای این تست را از top_k بیرون بیندازد.
    results = await emb.ChunkIndex(provider).search(db, query, top_k=1000)
    by_id = {r.chunk_id: r for r in results}
    assert by_id[good.id].semantic > 0.0
    assert by_id[wrong_model.id].semantic == 0.0
    assert by_id[wrong_proj.id].semantic == 0.0
    assert by_id[legacy.id].semantic == 0.0


async def test_c2_pgvector_sql_filters_by_full_identity(tc):
    """SQL مسیر PG باید فیلتر هویت کامل داشته باشد — پنجرهٔ top_k*3
    فقط با بردارهای سازگار پر شود."""

    class _FakeResult:
        def all(self):
            return []

    class _FakeDB:
        def __init__(self):
            self.sql = ""
            self.params = {}

        async def execute(self, stmt, params=None):
            self.sql = str(stmt)
            self.params = params or {}
            return _FakeResult()

        async def rollback(self):
            pass

    fake = _FakeDB()
    rows = await emb._pgvector_search(
        fake, [0.1] * 256, 5, {"ai_scope": "fatwa"},
        identity={
            "provider": "hash", "model": "hash-trigram-v1",
            "projection": "folding-v1", "dim": 256,
        },
    )
    assert rows == []
    assert "embedding_provider = :ident_prov" in fake.sql
    assert "embedding_model = :ident_model" in fake.sql
    assert "embedding_projection = :ident_proj" in fake.sql
    assert fake.params["ident_prov"] == "hash"
    assert fake.params["ident_model"] == "hash-trigram-v1"
    assert fake.params["ident_proj"] == "folding-v1"


async def test_c3_report_keys_and_sqlite_vec_checked_flag(tc):
    """روی SQLite ستون برداری معنا ندارد — گزارش باید صریح بگوید
    بررسی vec انجام نشده، نه این‌که سازگاریِ JSON را به‌جای آن جا بزند."""
    async with tc["maker"]() as db:
        report = await emb.chunk_compatibility_report(db)
    assert report["embedding_vec_checked"] is False
    assert "chunks_vec_missing" in report
    assert report["chunks_vec_missing"] == 0
    assert await emb._pg_vec_presence(db) is None


# ---------------------------------------------------------------- C4
async def test_c4_failed_ingestion_commits_failed_not_queued(tc):
    async with tc["maker"]() as db:
        run = IngestionRun(source_type="text", status="queued", stats={})
        db.add(run)
        await db.flush()
        run_id = run.id
        await db.commit()
    async with tc["maker"]() as db:
        with pytest.raises(ValueError):
            await run_ingestion(
                db, run_id, source_type="text", payload={"text": "   "},
                ai_scopes=["fatwa"],
            )
    # session تازه: ردیف باید failed باشد، نه queuedِ یتیم.
    async with tc["maker"]() as db:
        row = await db.get(IngestionRun, run_id)
        assert row.status == "failed"
        assert "error" in (row.stats or {})
    async with tc["maker"]() as db:
        await db.execute(delete(IngestionRun).where(IngestionRun.id == run_id))
        await db.commit()


async def test_c4_mid_pipeline_embed_failure_commits_failed(tc, monkeypatch):
    """شکست در مرحلهٔ embed (پس از extract/normalize) هم باید failed
    را commit کند، نه این‌که با rollback به queued برگردد."""
    async def _boom_provider(db, name):
        class _Boom:
            name = "hash"
            model_name = "hash-trigram-v1"

            async def embed(self, texts):
                raise RuntimeError("provider down")

        return _Boom()

    monkeypatch.setattr(emb, "get_embedding_provider", _boom_provider)
    async with tc["maker"]() as db:
        run = IngestionRun(source_type="text", status="queued", stats={})
        db.add(run)
        await db.flush()
        run_id = run.id
        await db.commit()
    async with tc["maker"]() as db:
        with pytest.raises(RuntimeError):
            await run_ingestion(
                db, run_id, source_type="text",
                payload={"text": "پاراگراف اول دربارهٔ نماز است و توضیح می‌دهد.\n\nپاراگراف دوم دربارهٔ روزه است و توضیح می‌دهد."},
                ai_scopes=["fatwa"],
            )
    async with tc["maker"]() as db:
        row = await db.get(IngestionRun, run_id)
        assert row.status == "failed"
        assert "provider down" in (row.stats or {}).get("error", "")
        await db.execute(delete(IngestionRun).where(IngestionRun.id == run_id))
        await db.commit()


# ---------------------------------------------------------------- C5
class _FlakyPubSub:
    def __init__(self, script):
        self._script = script  # list: ("msg", data) | ("raise", exc) | ("hang",)
        self.closed = False

    async def subscribe(self, channel):
        pass

    async def unsubscribe(self, channel):
        pass

    async def close(self):
        self.closed = True

    async def listen(self):
        for item in self._script:
            if item[0] == "msg":
                yield {"type": "message", "data": item[1]}
            elif item[0] == "raise":
                raise item[1]
            else:
                await asyncio.sleep(3600)


class _FlakyClient:
    def __init__(self, scripts):
        self._scripts = list(scripts)
        self.pubsubs = []

    def pubsub(self):
        ps = _FlakyPubSub(self._scripts.pop(0) if self._scripts else [("hang",)])
        self.pubsubs.append(ps)
        return ps

    async def publish(self, channel, data):
        pass

    async def aclose(self):
        pass


async def test_c5_listener_reconnects_once_and_only_once():
    import json

    client = _FlakyClient([
        [("msg", json.dumps({"event_id": "m1"})), ("raise", ConnectionError("redis gone"))],
        [("msg", json.dumps({"event_id": "m2"})), ("hang",)],
    ])
    bus = RedisBus(client)
    # backoff کوتاه برای تست
    bus.LISTENER_BACKOFF_INITIAL_S = 0.01
    bus.LISTENER_BACKOFF_MAX_S = 0.05
    received: list[str] = []

    async def _cb(message):
        received.append(message["event_id"])

    task = asyncio.create_task(bus.run_listener(_cb))
    try:
        await asyncio.wait_for(_poll(lambda: received == ["m1", "m2"]), timeout=5)
        assert bus.listener_state()["alive"] is True
        assert bus.listener_state()["consecutive_failures"] == 0
        # pubsub اول بسته شده پیش از subscribe دوم (single-flight)
        assert client.pubsubs[0].closed is True
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=2)


async def _poll(pred, interval=0.05):
    while not pred():
        await asyncio.sleep(interval)


# ---------------------------------------------------------------- C6
async def test_c6_health_is_liveness_and_ready_probes_db(tc, monkeypatch):
    client = tc["client"]
    r = await client.get("/health")
    assert r.status_code == 200
    r = await client.get("/ready")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"

    # DB خراب → /health هنوز 200 (liveness)، /ready می‌شود 503.
    import app.core.database as db_mod

    class _BadCtx:
        async def __aenter__(self):
            raise ConnectionError("db gone")

        async def __aexit__(self, *a):
            return False

    class _BadFactory:
        def __call__(self):
            return _BadCtx()

    monkeypatch.setattr(db_mod, "SessionLocal", _BadFactory())
    r = await client.get("/health")
    assert r.status_code == 200
    r = await client.get("/ready")
    assert r.status_code == 503
    assert r.json()["status"] == "not_ready"


# ---------------------------------------------------------------- C8
async def test_c8_per_record_failure_summary_and_resume(tc, monkeypatch):
    from app.modules.fatwa import reindex as reindex_mod

    calls = {"bad_failed_once": False}

    class _FlakyProvider:
        name = "hash"
        model_name = "hash-trigram-v1"

        async def embed(self, texts):
            if len(texts) > 1:
                raise RuntimeError("batch boom")
            if "BADCHUNK" in texts[0] and not calls["bad_failed_once"]:
                calls["bad_failed_once"] = True
                raise RuntimeError("bad chunk")
            return (await emb.HashEmbeddingProvider().embed(texts))

    async def _fake_get_provider(db, name):
        return _FlakyProvider()

    monkeypatch.setattr(reindex_mod, "get_embedding_provider", _fake_get_provider)
    marker = "pass4_c8_test"

    async def _seed():
        async with tc["maker"]() as db:
            await db.execute(
                delete(FiqhKnowledgeChunk).where(
                    FiqhKnowledgeChunk.source_type == marker
                )
            )
            for text_value in [
                "متن خوب اول دربارهٔ نماز مسافر است و توضیح می‌دهد",
                "BADCHUNK متن خراب دوم دربارهٔ روزه مسافر است و توضیح می‌دهد",
                "متن خوب سوم دربارهٔ زکات مسافر است و توضیح می‌دهد",
            ]:
                db.add(FiqhKnowledgeChunk(
                    chunk_text=text_value,
                    embedding=[0.1] * 256,
                    embedding_provider="other",
                    embedding_model="x",
                    embedding_projection=None,
                    source_type=marker,
                    workflow_status="approved",
                    ai_scopes=["fatwa"],
                ))
            await db.commit()

    await _seed()
    async with tc["maker"]() as db:
        result = await reindex_mod.run_reindex(db, log=lambda *a: None)
    assert result["status"] == "partial"
    assert result["succeeded"] == 2
    assert result["failed"] == 1
    assert len(result["failed_ids"]) == 1
    assert result["remaining"] == 0
    assert result["last_id"] is not None
    # resume: فقط رکورد خراب مانده و این بار موفق می‌شود؛ خوب‌ها
    # دوباره پردازش نمی‌شوند.
    async with tc["maker"]() as db:
        again = await reindex_mod.run_reindex(db, log=lambda *a: None)
    assert again["total_incompatible"] == 1
    assert again["status"] == "ok"
    assert again["succeeded"] == 1 and again["failed"] == 0
    async with tc["maker"]() as db:
        await db.execute(
            delete(FiqhKnowledgeChunk).where(
                FiqhKnowledgeChunk.source_type == marker
            )
        )
        await db.commit()


def test_c8_malformed_resume_from_is_usage_error_not_traceback():
    from app.modules.fatwa import reindex as reindex_mod

    with pytest.raises(SystemExit) as excinfo:
        reindex_mod.main(["--resume-from", "not-a-uuid"])
    assert excinfo.value.code == 2


# ---------------------------------------------------------------- C9
def test_c9_downgrade_refuses_on_duplicate_triples(tmp_path):
    import importlib.util
    import pathlib as _pl

    from sqlalchemy import create_engine
    from sqlalchemy import text as sa_text

    spec = importlib.util.spec_from_file_location(
        "mig_b5c6",
        str(
            _pl.Path(__file__).resolve().parent.parent
            / "alembic/versions/b5c6d7e8f9a0_fix2_11_release_group_retention.py"
        ),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    engine = create_engine(f"sqlite:///{tmp_path}/c9.db")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(
            sa_text(
                "INSERT INTO build_releases (id, platform, version, "
                "build_number, artifact_key, signed, build_metadata, "
                "created_at) VALUES "
                "(:id, 'android', '1.1.0', '42', 'a.apk', 0, '{}', "
                "'2026-10-24 00:00:00'), "
                "(:id2, 'android', '1.1.0', '42', 'b.apk', 0, '{}', "
                "'2026-10-24 00:00:00')"
            ),
            {"id": str(uuid.uuid4()), "id2": str(uuid.uuid4())},
        )

    class _BatchCtx:
        def __init__(self, calls):
            self._calls = calls

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def create_unique_constraint(self, *a, **k):
            self._calls.append(("create_unique", a, k))

    class _FakeOp:
        def __init__(self, conn):
            self._conn = conn
            self.calls: list = []

        def get_bind(self):
            return self._conn

        def drop_index(self, *a, **k):
            self.calls.append(("drop_index", a, k))

        def batch_alter_table(self, *a, **k):
            return _BatchCtx(self.calls)

    with engine.connect() as conn:
        fake = _FakeOp(conn)
        mod.op = fake
        with pytest.raises(RuntimeError, match="downgrade refused"):
            mod.downgrade()
        # هیچ DDLای پیش از رد شدن اجرا نشده — schema دست‌نخورده است.
        assert fake.calls == []
        # حذف یکی از دوقلوها → downgrade آزاد می‌شود.
        conn.execute(
            sa_text("DELETE FROM build_releases WHERE artifact_key = 'b.apk'")
        )
        conn.commit()
        fake2 = _FakeOp(conn)
        mod.op = fake2
        mod.downgrade()
        assert ("drop_index",) == (fake2.calls[0][0],) or fake2.calls[0][0] == "drop_index"
        assert any(c[0] == "create_unique" for c in fake2.calls)
