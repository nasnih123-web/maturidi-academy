"""جاب‌های صف media — فاز ۹ (قرارداد §۵).

transcribe_media: STT با Whisper — اگر باینری/مدل در دسترس نبود، وضعیت
  transcript_status=failed با دلیل صریح ثبت می‌شود؛ هرگز transcript جعلی.
ocr_pdf: OCR با Tesseract — رفتار graceful یکسان.

هر دو تابع مستقیم هم تست‌پذیرند (بدون ARQ).
"""
from __future__ import annotations

import asyncio
import shutil
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.core.queues import register_task

WHISPER_BIN = "whisper"
TESSERACT_BIN = "tesseract"
PDFTOPPM_BIN = "pdftoppm"


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def _load_item(db, item_id: str):
    from app.models.models import LibraryItem

    item = await db.get(LibraryItem, uuid.UUID(item_id))
    if item is None:
        raise ValueError(f"library item یافت نشد: {item_id}")
    return item


async def _read_media_bytes(item) -> bytes:
    """خواندن بایت‌های فایل از storage (provider محلی)."""
    from app.core.storage import get_storage

    storage = get_storage()
    read_bytes = getattr(storage, "read_bytes", None)
    if read_bytes is None:
        raise RuntimeError("storage provider خواندن بایت‌ها را پشتیبانی نمی‌کند")
    return await read_bytes(item.media_key)


@register_task("media")
async def transcribe_media(ctx: dict, item_id: str) -> dict:
    """رونویسی صوت/ویدیو با Whisper (صف media)."""
    from app.core.database import SessionLocal

    async with SessionLocal() as db:
        item = await _load_item(db, item_id)
        item.transcript_status = "processing"
        item.processing_error = None
        await db.commit()

        whisper = shutil.which(WHISPER_BIN)
        if whisper is None:
            reason = (
                "whisper_not_installed: باینری whisper در دسترس نیست؛ "
                "رونویسی انجام نشد (transcript جعلی ساخته نشد)"
            )
            item.transcript_status = "failed"
            item.processing_error = reason
            await db.commit()
            return {"ok": False, "reason": reason}

        try:
            data = await _read_media_bytes(item)
        except Exception as exc:  # noqa: BLE001
            reason = f"read_failed: خواندن فایل از storage ناموفق بود: {exc}"
            item.transcript_status = "failed"
            item.processing_error = reason
            await db.commit()
            return {"ok": False, "reason": reason}

        suffix = Path(item.media_key).suffix or ".bin"
        with tempfile.TemporaryDirectory(prefix="lib-transcribe-") as tmp:
            src = Path(tmp) / f"input{suffix}"
            src.write_bytes(data)
            proc = await asyncio.create_subprocess_exec(
                whisper, str(src),
                "--model", "tiny",
                "--output_format", "txt",
                "--output_dir", tmp,
                "--language", "fa",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, stderr = await asyncio.wait_for(proc.communicate(), timeout=1500)
            except TimeoutError:
                proc.kill()
                reason = "whisper_timeout: رونویسی بیش از حد طول کشید"
                item.transcript_status = "failed"
                item.processing_error = reason
                await db.commit()
                return {"ok": False, "reason": reason}
            if proc.returncode != 0:
                reason = f"whisper_failed: کد خروج {proc.returncode}: {stderr.decode(errors='replace')[:500]}"
                item.transcript_status = "failed"
                item.processing_error = reason
                await db.commit()
                return {"ok": False, "reason": reason}
            txt_files = list(Path(tmp).glob("*.txt"))
            transcript = txt_files[0].read_text(encoding="utf-8").strip() if txt_files else ""
            if not transcript:
                reason = "whisper_empty: خروجی رونویسی خالی بود"
                item.transcript_status = "failed"
                item.processing_error = reason
                await db.commit()
                return {"ok": False, "reason": reason}
            item.transcript = transcript
            item.transcript_status = "done"
            item.processing_error = None
            await db.commit()
            return {"ok": True, "chars": len(transcript)}


@register_task("media")
async def ocr_pdf(ctx: dict, item_id: str) -> dict:
    """OCR پی‌دی‌اف اسکن‌شده با Tesseract (صف media)."""
    from app.core.database import SessionLocal

    async with SessionLocal() as db:
        item = await _load_item(db, item_id)
        item.ocr_status = "processing"
        item.processing_error = None
        await db.commit()

        tesseract = shutil.which(TESSERACT_BIN)
        pdftoppm = shutil.which(PDFTOPPM_BIN)
        if tesseract is None or pdftoppm is None:
            missing = [b for b, p in ((TESSERACT_BIN, tesseract), (PDFTOPPM_BIN, pdftoppm)) if p is None]
            reason = (
                f"ocr_tools_missing: ابزارهای {', '.join(missing)} در دسترس نیستند؛ "
                "OCR انجام نشد (متن جعلی ساخته نشد)"
            )
            item.ocr_status = "failed"
            item.processing_error = reason
            await db.commit()
            return {"ok": False, "reason": reason}

        try:
            data = await _read_media_bytes(item)
        except Exception as exc:  # noqa: BLE001
            reason = f"read_failed: خواندن فایل از storage ناموفق بود: {exc}"
            item.ocr_status = "failed"
            item.processing_error = reason
            await db.commit()
            return {"ok": False, "reason": reason}

        try:
            from app.core.platform_settings import get_setting
            langs = await get_setting(db, "media.ocr_langs") or "fas+ara+eng"
        except Exception:  # noqa: BLE001
            langs = "fas+ara+eng"

        with tempfile.TemporaryDirectory(prefix="lib-ocr-") as tmp:
            src = Path(tmp) / "input.pdf"
            src.write_bytes(data)
            # PDF → تصویر (۱۵۰dpi کافی برای OCR)
            proc = await asyncio.create_subprocess_exec(
                pdftoppm, "-png", "-r", "150", str(src), str(Path(tmp) / "page"),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            _, err = await asyncio.wait_for(proc.communicate(), timeout=600)
            if proc.returncode != 0:
                reason = f"pdftoppm_failed: {err.decode(errors='replace')[:300]}"
                item.ocr_status = "failed"
                item.processing_error = reason
                await db.commit()
                return {"ok": False, "reason": reason}
            pages = sorted(Path(tmp).glob("page-*.png"))
            if not pages:
                reason = "ocr_no_pages: صفحه‌ای از PDF استخراج نشد"
                item.ocr_status = "failed"
                item.processing_error = reason
                await db.commit()
                return {"ok": False, "reason": reason}
            texts: list[str] = []
            for page in pages:
                proc = await asyncio.create_subprocess_exec(
                    tesseract, str(page), "stdout", "-l", langs,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                )
                try:
                    out, _ = await asyncio.wait_for(proc.communicate(), timeout=300)
                except TimeoutError:
                    proc.kill()
                    continue
                if proc.returncode == 0 and out:
                    texts.append(out.decode(errors="replace").strip())
            ocr_text = "\n\n".join(t for t in texts if t).strip()
            if not ocr_text:
                reason = "ocr_empty: متنی از صفحات استخراج نشد"
                item.ocr_status = "failed"
                item.processing_error = reason
                await db.commit()
                return {"ok": False, "reason": reason}
            item.ocr_text = ocr_text
            item.ocr_status = "done"
            item.processing_error = None
            await db.commit()
            return {"ok": True, "pages": len(pages), "chars": len(ocr_text)}
