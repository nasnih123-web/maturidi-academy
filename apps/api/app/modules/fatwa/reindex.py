"""ابزار بازنمایه‌سازی (reindex) امبدینگ‌های ناسازگار — FIX3-04 (ADR-0051).

اجرا:
    python -m app.modules.fatwa.reindex --report        # فقط گزارش سازگاری
    python -m app.modules.fatwa.reindex --dry-run       # گزارش + برنامه، بدون نوشتن
    python -m app.modules.fatwa.reindex                 # اجرای واقعی
    python -m app.modules.fatwa.reindex --resume-from <chunk-id>

قرارداد:
- «ناسازگار» یعنی هویت (provider, model, projection, dim) chunk با
  هویت جاری یکی نیست — از جمله ردیف‌های legacy با هویت NULL و
  بردارهای پروجکشن قدیم (برش ساده، پیش از FIX2-03) — و، روی PG،
  ردیف JSON-سازگاری که embedding_vecاش NULL است (Pass 4 / C3).
- پردازش اکیداً به ترتیب صعودی id است و پس از هر batch کامیت
  می‌شود؛ `last_id` چاپ‌شده checkpoint است: اجرای دوباره از همان
  نقطه ادامه می‌دهد (chunkهای به‌روز رد می‌شوند) و با
  --resume-from می‌توان صریح از یک id ادامه داد. عملیات
  idempotent است — اجرای دوباره روی دادهٔ سالم no-op است.
- اگر provider واقعی در دسترس نباشد (کلید/endpoint تنظیم نیست یا
  مدل نصب نیست) ابزار پیش از هر نوشتنی با خطای روشن و exit code
  ۲ متوقف می‌شود؛ هرگز نوشتن ناقصِ ساکت نداریم. یک probe واقعی
  (embed یک رشتهٔ کوتاه) پیش از اولین batch همین را تضمین می‌کند.
- اجرای production روی دادهٔ واقعی با کلید واقعی مالک انجام
  می‌شود (مالک‌گیت) — این ابزار و تست‌هایش این‌جا تحویل شده‌اند.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import FiqhKnowledgeChunk
from app.modules.fatwa.embeddings import (
    PROJECTION_ID,
    _chunk_identity_rows,
    _identity_matches,
    chunk_compatibility_report,
    get_embedding_provider,
    pgvector_available,
    provider_identity,
    resolve_provider_name,
)


async def _incompatible_ids(
    db: AsyncSession, current: dict, resume_from: uuid.UUID | None
) -> list[uuid.UUID]:
    from app.modules.fatwa.embeddings import _pg_vec_presence

    rows = await _chunk_identity_rows(db)
    vec_present = await _pg_vec_presence(db)
    ids = []
    for cid, prov, model, proj, dim in rows:
        ident_ok = _identity_matches(prov, model, proj, dim, current)
        # Pass 4 / C3: روی PG، JSON-سازگارِ بدون embedding_vec هم
        # ناسازگار است — reindex هر دو ستون را با هم بازمی‌نویسد و
        # حذفِ ساکت از جست‌وجوی معنایی را ترمیم می‌کند.
        vec_missing = (
            vec_present is not None and ident_ok and str(cid) not in vec_present
        )
        if not ident_ok or vec_missing:
            ids.append(cid)
    ids.sort()
    if resume_from is not None:
        ids = [cid for cid in ids if cid > resume_from]
    return ids


def _print_report(report: dict, log: Callable[[str], None]) -> None:
    cur = report["current"]
    log(
        "current identity: provider={provider} model={model} "
        "projection={projection} dim={dim}".format(**cur)
    )
    for g in report["groups"]:
        log(
            "  group provider={provider} model={model} "
            "projection={projection} dim={dim}: {count} chunk(s) "
            "{mark}".format(
                mark="compatible" if g["compatible"] else "INCOMPATIBLE",
                **g,
            )
        )
    log(
        "total={chunks_total} compatible={chunks_compatible} "
        "incompatible={chunks_incompatible}".format(**report)
    )
    if report.get("embedding_vec_checked"):
        log(
            "embedding_vec checked (PG): {n} JSON-compatible chunk(s) "
            "missing embedding_vec — included in reindex".format(
                n=report.get("chunks_vec_missing", 0)
            )
        )


async def run_reindex(
    db: AsyncSession,
    *,
    dry_run: bool = False,
    batch_size: int = 50,
    resume_from: uuid.UUID | None = None,
    provider_name: str | None = None,
    log: Callable[[str], None] = print,
    debug: bool = False,
) -> dict:
    """هستهٔ ابزار — از CLI و تست‌ها صدا زده می‌شود.

    خروجی: dict با status (ok | nothing_to_do | provider_unavailable)
    و شمارنده‌ها. در حالت provider_unavailable هیچ نوشتنی انجام
    نشده است.
    """
    report = await chunk_compatibility_report(db)
    _print_report(report, log)
    current = report["current"]
    ids = await _incompatible_ids(db, current, resume_from)
    result = {
        "status": "ok",
        "dry_run": dry_run,
        "total_incompatible": len(ids),
        # Pass 4 / C8: شمارنده‌های صریح — پیش از این فقط processed بود
        # و شکستِ یک رکورد کل run را با traceback خام می‌کشت.
        "processed": 0,
        "succeeded": 0,
        "failed": 0,
        "skipped": 0,
        "remaining": len(ids),
        "failed_ids": [],
        "last_id": None,
    }
    if not ids:
        result["status"] = "nothing_to_do"
        result["remaining"] = 0
        log("reindex: nothing to do — all chunks match the current identity")
        return result
    if dry_run:
        log(f"reindex (dry-run): {len(ids)} chunk(s) would be re-embedded")
        result["last_id"] = str(ids[-1])
        return result

    # ساخت provider و probe واقعی پیش از هر نوشتن: نبود کلید/مدل =
    # توقف روشن، نه نوشتن ناقص.
    name = provider_name or await resolve_provider_name(db)
    try:
        provider = await get_embedding_provider(db, name)
        await provider.embed(["reindex availability probe"])
    except Exception as exc:  # noqa: BLE001 — هر خطای provider یعنی توقف روشن
        result["status"] = "provider_unavailable"
        result["error"] = f"{type(exc).__name__}: {exc}"
        log(f"reindex: provider unavailable — no writes made: {result['error']}")
        return result
    prov_name, prov_model = await provider_identity(provider)

    on_pg = pgvector_available()
    processed = 0
    succeeded = 0
    failed = 0
    skipped = 0
    failed_ids: list[dict] = []
    try:
        for start in range(0, len(ids), batch_size):
            batch_ids = ids[start : start + batch_size]
            chunks = (
                await db.execute(
                    select(FiqhKnowledgeChunk).where(
                        FiqhKnowledgeChunk.id.in_(batch_ids)
                    )
                )
            ).scalars().all()
            by_id = {c.id: c for c in chunks}
            ordered = [by_id[cid] for cid in batch_ids if cid in by_id]
            skipped += len(batch_ids) - len(ordered)
            # embed دسته‌ای؛ اگر یک رکورد خراب کل batch را بیندازد،
            # تک‌تک retry می‌کنیم تا رکورد خراب ایزوله شود، نه این‌که
            # کل run بمیرد (C8).
            try:
                vectors = await provider.embed([c.chunk_text for c in ordered])
                pairs = list(zip(ordered, vectors))
            except Exception:  # noqa: BLE001 — شکست batch = fallback تک‌تک
                pairs = []
                for chunk in ordered:
                    try:
                        vec = (await provider.embed([chunk.chunk_text]))[0]
                        pairs.append((chunk, vec))
                    except Exception as exc:  # noqa: BLE001 — رکورد خراب
                        failed += 1
                        failed_ids.append(
                            {
                                "id": str(chunk.id),
                                "error": f"{type(exc).__name__}: {exc}",
                            }
                        )
            for chunk, vec in pairs:
                chunk.embedding = list(vec)
                chunk.embedding_vec = list(vec) if on_pg else None
                chunk.embedding_provider = prov_name
                chunk.embedding_model = prov_model
                chunk.embedding_projection = PROJECTION_ID
            await db.commit()
            succeeded += len(pairs)
            processed = succeeded + failed
            last_id = ordered[-1].id if ordered else batch_ids[-1]
            result["last_id"] = str(last_id)
            log(
                f"reindex: processed {processed}/{len(ids)} "
                f"(last_id={last_id})"
            )
    except Exception as exc:  # خطای میانیِ run — خلاصه برمی‌گردد، نه traceback

        await db.rollback()
        result["status"] = "error"
        result["error"] = f"{type(exc).__name__}: {exc}"
        if debug:
            raise
        log(
            "reindex: FAILED mid-run — checkpoint last_id="
            f"{result['last_id']} (resume with --resume-from)"
        )
    result["processed"] = processed
    result["succeeded"] = succeeded
    result["failed"] = failed
    result["skipped"] = skipped
    result["failed_ids"] = failed_ids
    result["remaining"] = len(ids) - succeeded - failed - skipped
    if result["status"] == "ok" and failed:
        result["status"] = "partial"
    log(
        f"reindex: done — {succeeded} chunk(s) re-embedded "
        f"(succeeded={succeeded} failed={failed} "
        f"skipped={skipped} remaining={result['remaining']} "
        f"last_id={result['last_id']})"
    )
    if failed_ids:
        for item in failed_ids:
            log(f"reindex: failed chunk {item['id']}: {item['error']}")
    return result


async def _amain(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="reindex",
        description="گزارش سازگاری و بازنمایه‌سازی امبدینگ‌های دانش فقهی",
    )
    parser.add_argument(
        "--report", action="store_true", help="فقط گزارش سازگاری، بدون اجرا"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="گزارش + برنامه، بدون نوشتن"
    )
    parser.add_argument("--batch-size", type=int, default=50)
    def _uuid_arg(value: str) -> uuid.UUID:
        # Pass 4 / C8: مقدار بدشکل باید usage error بدهد، نه
        # traceback خام از uuid.UUID در _amain.
        try:
            return uuid.UUID(value)
        except ValueError:
            raise argparse.ArgumentTypeError(
                f"invalid UUID for --resume-from: {value!r}"
            ) from None

    parser.add_argument(
        "--resume-from",
        type=_uuid_arg,
        default=None,
        help="ادامه از بعد از این chunk id (checkpoint اجرای قبلی)",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="نمایش traceback کامل روی خطای میانی (پیش‌فرض: خلاصه)",
    )
    parser.add_argument(
        "--provider",
        default=None,
        help="نام provider (پیش‌فرض: همان resolve مسیر بازیابی)",
    )
    args = parser.parse_args(argv)

    from app.core.database import SessionLocal

    async with SessionLocal() as db:
        if args.report:
            _print_report(await chunk_compatibility_report(db), print)
            return 0
        result = await run_reindex(
            db,
            dry_run=args.dry_run,
            batch_size=max(1, args.batch_size),
            resume_from=args.resume_from,
            provider_name=args.provider,
            debug=args.debug,
        )
    if result["status"] == "provider_unavailable":
        print(
            "reindex FAILED: embedding provider unavailable — "
            f"{result.get('error')}",
            file=sys.stderr,
        )
        return 2
    if result["status"] == "error":
        print(
            "reindex FAILED mid-run: "
            f"{result.get('error')} — checkpoint last_id="
            f"{result.get('last_id')} (resume with --resume-from)",
            file=sys.stderr,
        )
        return 1
    if result["status"] == "partial":
        print(
            "reindex PARTIAL: "
            f"succeeded={result.get('succeeded')} "
            f"failed={result.get('failed')} — see failed chunk list above",
            file=sys.stderr,
        )
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_amain(argv))


if __name__ == "__main__":
    sys.exit(main())
