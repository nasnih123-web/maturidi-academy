"""pipeline درون‌ریزی دانش — فاز ۶.

extract → normalize → provenance → approval → chunk → embed → index

به‌صورت جاب ARQ روی صف `ai` ثبت می‌شود (الگوی calendar_tasks فاز ۴):
worker.py توابع رجیستری را از app.core.queues می‌خواند.

منبع‌های فعلی: متن مستقیم (text) و فایل متنی (file_path).
اتصال به library_items در فاز ۹ (source_library_item_ref رزرو شده).
approval: chunkهای ساخته‌شده با workflow_status=draft می‌مانند و فقط با
مجوز fatwa.approve تأیید می‌شوند — RAG هرگز draft را نمی‌خواند (§۹/§۱۰).
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.core.queues import register_task


def normalize_text(raw: str) -> str:
    """normalize: یکدست‌سازی فاصله‌ها و خطوط — بدون تغییر معنا."""
    import re

    text_value = raw.replace("\r\n", "\n").replace("\r", "\n")
    text_value = re.sub(r"[ \t]+", " ", text_value)
    text_value = re.sub(r"\n{3,}", "\n\n", text_value)
    return text_value.strip()


def extract_source(source_type: str, payload: dict[str, Any]) -> str:
    """extract: متن خام از منبع. فعلاً text مستقیم و فایل متنی."""
    if source_type == "text":
        text_value = payload.get("text", "")
        if not isinstance(text_value, str) or not text_value.strip():
            raise ValueError("payload.text خالی است")
        return text_value
    if source_type == "file":
        path = payload.get("file_path", "")
        # محدودیت امنیتی: فقط فایل متنی داخل دایرکتوری مجاز uploads
        from pathlib import Path

        base = Path("uploads").resolve()
        target = (base / path).resolve()
        if base not in target.parents and target != base:
            raise ValueError("مسیر فایل خارج از دایرکتوری مجاز است")
        if target.suffix.lower() not in (".txt", ".md", ".markdown"):
            raise ValueError("فقط فایل متنی (.txt/.md) پشتیبانی می‌شود")
        return target.read_text(encoding="utf-8")
    if source_type == "library_item":
        # فاز ۹: متن از پیش استخراج‌شدهٔ آیتم کتابخانه (عنوان/توضیح/transcript/OCR)
        # در payload.text می‌آید — استخراج فایل بر عهدهٔ ماژول library است.
        text_value = payload.get("text", "")
        if not isinstance(text_value, str) or not text_value.strip():
            raise ValueError("payload.text خالی است")
        return text_value
    raise ValueError(f"source_type ناشناخته: {source_type}")


async def run_ingestion(
    db,
    run_id: UUID,
    *,
    source_type: str,
    payload: dict[str, Any],
    topic_category: str | None = None,
    madhab_scope: str | None = None,
    ai_scopes: list[str] | None = None,
    source_citation: dict | None = None,
    created_by=None,
) -> dict[str, Any]:
    """اجرای کامل pipeline برای یک run — تست‌پذیر و بدون ARQ هم صدا زدنی."""
    from app.models.models import FiqhKnowledgeChunk, IngestionRun

    from .embeddings import (
        chunk_text_paragraphs,
        get_embedding_provider,
        provider_identity,
        resolve_provider_name,
    )

    run = await db.get(IngestionRun, run_id)
    if run is None:
        raise ValueError(f"ingestion run یافت نشد: {run_id}")
    run.status = "running"
    run.started_at = datetime.now(UTC)
    await db.flush()

    stats: dict[str, Any] = {"stages": {}}
    try:
        raw = extract_source(source_type, payload)
        stats["stages"]["extract"] = {"chars": len(raw)}

        normalized = normalize_text(raw)
        stats["stages"]["normalize"] = {"chars": len(normalized)}

        # provenance: ردیابی منبع بدون FK فیزیکی (§۹.۵)
        source_ref = {
            "type": source_type,
            "id": payload.get("source_id") or str(run_id),
            "version": payload.get("source_version") or "v1",
        }
        stats["stages"]["provenance"] = source_ref

        chunks = chunk_text_paragraphs(normalized)
        stats["stages"]["chunk"] = {"count": len(chunks)}

        # FIX2-03: همان resolve_provider_name واحدِ مسیر بازیابی —
        # پیش‌فرض قدیمیِ «or "hash"» در production بی‌صدا دانش را با
        # hash ایندکس می‌کرد در حالی که بازیابی با local_model بود.
        provider_name = await resolve_provider_name(db)
        provider = await get_embedding_provider(db, provider_name)
        vectors = await provider.embed(chunks)
        prov_name, prov_model = await provider_identity(provider)
        stats["stages"]["embed"] = {
            "provider": prov_name,
            "model": prov_model,
            "count": len(vectors),
        }

        scopes = ai_scopes or []
        chunk_ids: list[str] = []
        # روی Postgres ستون برداری واقعی هم پر می‌شود (B-03 — ADR-0026)؛
        # روی SQLite نوع Vector مقدار list را نمی‌پذیرد و ستون خالی می‌ماند.
        from app.modules.fatwa.embeddings import pgvector_available

        on_pg = pgvector_available()
        for text_chunk, vec in zip(chunks, vectors):
            chunk = FiqhKnowledgeChunk(
                chunk_text=text_chunk,
                embedding=list(vec),
                embedding_vec=list(vec) if on_pg else None,
                embedding_provider=prov_name,
                embedding_model=prov_model,
                source_type="ingested",
                source_ref=source_ref,
                source_citation=source_citation,
                topic_category=topic_category,
                madhab_scope=madhab_scope,
                workflow_status="draft",  # approval دستی — هرگز auto-approve
                ai_scopes=scopes,
            )
            db.add(chunk)
            await db.flush()
            chunk_ids.append(str(chunk.id))
        stats["stages"]["index"] = {"chunk_ids": chunk_ids}

        run.status = "done"
        run.stats = stats
    except Exception as exc:
        run.status = "failed"
        stats["error"] = str(exc)
        run.stats = stats
        raise
    finally:
        run.finished_at = datetime.now(UTC)
        await db.flush()
    return stats


@register_task("ai")
async def ingest_knowledge_run(ctx: dict, run_id: str) -> dict:
    """جاب ARQ درون‌ریزی — پوستهٔ نازک روی run_ingestion (الگوی فاز ۴)."""
    from uuid import UUID as _UUID

    from app.core.database import SessionLocal
    from app.models.models import IngestionRun

    rid = _UUID(run_id)
    async with SessionLocal() as db:
        run = await db.get(IngestionRun, rid)
        if run is None:
            return {"ok": False, "error": "run not found"}
        # payload و تنظیمات در stats.run_config ذخیره شده‌اند (service.trigger_ingestion)
        cfg = (run.stats or {}).get("run_config") or {}
        stats = await run_ingestion(
            db,
            rid,
            source_type=run.source_type,
            payload=cfg.get("payload") or {},
            topic_category=cfg.get("topic_category"),
            madhab_scope=cfg.get("madhab_scope"),
            ai_scopes=cfg.get("ai_scopes"),
            source_citation=cfg.get("source_citation"),
        )
        await db.commit()
        return {"ok": True, "stats": stats}
