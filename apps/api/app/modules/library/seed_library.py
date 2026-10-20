"""سید نمایشی کتابخانه — فاز ۹ (idempotent).

پنج آیتم نمایشی، یکی برای هر kind، با فایل‌های **واقعی** تولیدشده در کد:
- pdf: PDF معتبر یک‌صفحه‌ای با reportlab
- audio: WAV سه‌ثانیه‌ای سکوت (ماژول wave)
- video: mp4 واقعی ۶۴×۶۴ یک‌ثانیه‌ای (ffmpeg lavfi)
- video_360: mp4 واقعی ۱۲۸×۶۴ (نسبت ۲:۱ اکوئرکتنگولار) با برچسب نمایشی
- mindmap: فایل FreeMind (.mm) معتبر XML

همهٔ آیتم‌ها published + public با برچسب «نمایشی» در عنوان هستند.
آیتم صوتی یک transcript واقعیِ کوتاه دارد تا جست‌وجو روی آن کار کند.
هیچ متن فقهی اختراعی در سید نیست.
"""
from __future__ import annotations

import io
import os
import subprocess
import tempfile
import wave
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.storage import get_storage
from app.models.models import LibraryItem

DEMO_MARKER = "phase9-demo-v1"


def _L(fa: str, ar: str, en: str) -> dict:
    return {"fa": fa, "ar": ar, "en": en}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _demo_pdf() -> bytes:
    from reportlab.lib.pagesizes import A5
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A5)
    c.setFont("Helvetica", 14)
    c.drawString(60, 500, "Maturidi Academy - Library Demo PDF")
    c.setFont("Helvetica", 10)
    c.drawString(60, 480, "This is a real generated demo file (phase 9 seed).")
    c.drawString(60, 464, "No invented fiqh content inside.")
    c.showPage()
    c.save()
    return buf.getvalue()


def _demo_wav(seconds: int = 3, rate: int = 8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * (rate * seconds))
    return buf.getvalue()


def _demo_mp4(width: int, height: int, seconds: int = 1) -> bytes:
    """mp4 واقعی با ffmpeg (رنگ ثابت).

    یافتهٔ فاز ۱۷ (SEC-17-08): به‌جای مسیر ثابت در /tmp از tempfile امن
    استفاده می‌شود (جلوگیری از پیش‌بینی/ربودن مسیر).
    """
    fd, out = tempfile.mkstemp(prefix="libdemo_", suffix=".mp4")
    os.close(fd)
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-f", "lavfi", "-i",
                f"color=c=0x1d3a2a:s={width}x{height}:d={seconds}:r=10",
                "-pix_fmt", "yuv420p", "-c:v", "libx264", out,
            ],
            check=True, timeout=60,
        )
        with open(out, "rb") as fh:
            return fh.read()
    finally:
        try:
            os.unlink(out)
        except OSError:
            pass


def _demo_mindmap() -> bytes:
    return (
        b'<?xml version="1.0" encoding="UTF-8"?>\n'
        b'<map version="1.0.1">\n'
        b'  <node TEXT="Maturidi Academy (demo)">\n'
        b'    <node TEXT="Library"/>\n'
        b'    <node TEXT="Phases 0-18"/>\n'
        b'  </node>\n'
        b'</map>\n'
    )


def _demo_cover(label: str) -> bytes:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (96, 96), (29, 58, 42))
    d = ImageDraw.Draw(img)
    d.text((8, 40), label[:10], fill=(212, 175, 55))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


_DEMO_SPECS = [
    {
        "kind": "pdf",
        "ext": ".pdf",
        "mime": "application/pdf",
        "make": _demo_pdf,
        "title": _L("جزوهٔ نمایشی کتابخانه (PDF)", "كراسة تجريبية (PDF)", "Library demo booklet (PDF)"),
        "description": _L("فایل نمایشی واقعی برای فاز ۹.", "ملف تجريبي حقيقي للمرحلة ٩.", "Real demo file for phase 9."),
        "tags": ["demo", "نمایشی"],
        "transcript": None,
    },
    {
        "kind": "audio",
        "ext": ".wav",
        "mime": "audio/wav",
        "make": _demo_wav,
        "title": _L("صوت نمایشی کتابخانه", "صوت تجريبي", "Library demo audio"),
        "description": _L("سه ثانیه سکوت — فایل نمایشی واقعی.", "ثلاث ثوانٍ من الصمت — ملف تجريبي.", "Three seconds of silence — real demo file."),
        "tags": ["demo", "نمایشی"],
        "transcript": "این یک متن نمایشی برای آزمون جست‌وجوی کتابخانه است؛ واژهٔ کلیدی: ماتریدیه.",
    },
    {
        "kind": "video",
        "ext": ".mp4",
        "mime": "video/mp4",
        "make": lambda: _demo_mp4(64, 64),
        "title": _L("ویدیوی نمایشی کتابخانه", "فيديو تجريبي", "Library demo video"),
        "description": _L("ویدیوی واقعی یک‌ثانیه‌ای ۶۴×۶۴ — نمایشی.", "فيديو حقيقي ثانية واحدة — تجريبي.", "Real one-second 64x64 video — demo."),
        "tags": ["demo", "نمایشی"],
        "transcript": None,
    },
    {
        "kind": "video_360",
        "ext": ".mp4",
        "mime": "video/mp4",
        "make": lambda: _demo_mp4(128, 64),
        "title": _L("ویدیوی ۳۶۰° نمایشی (پلیر UI)", "فيديو ٣٦٠° تجريبي", "Demo 360° video (player UI)"),
        "description": _L(
            "فایل نمایشی واقعی با نسبت ۲:۱؛ پخش‌کنندهٔ پانوراما سمت وب آن را نمایش می‌دهد.",
            "ملف تجريبي بنسبة ٢:١؛ مشغّل البانوراما يعرضه.",
            "Real demo file, 2:1 aspect; the web panorama player renders it.",
        ),
        "tags": ["demo", "نمایشی", "360"],
        "transcript": None,
    },
    {
        "kind": "mindmap",
        "ext": ".mm",
        "mime": "application/xml",
        "make": _demo_mindmap,
        "title": _L("نقشهٔ فکری نمایشی", "خريطة ذهنية تجريبية", "Demo mindmap"),
        "description": _L("فایل FreeMind معتبر — نمایشی.", "ملف FreeMind صالح — تجريبي.", "Valid FreeMind file — demo."),
        "tags": ["demo", "نمایشی"],
        "transcript": None,
    },
]


async def seed_library_demo(db: AsyncSession) -> dict[str, int]:
    """سید idempotent — اگر ۵ آیتم نمایشی موجود بود، کاری نمی‌کند."""
    existing = (
        await db.execute(
            select(LibraryItem).where(LibraryItem.source_type == "seed_demo")
        )
    ).scalars().all()
    if len(existing) >= 5:
        return {"skipped": len(existing), "created": 0}

    storage = get_storage()
    created = 0
    for spec in _DEMO_SPECS:
        data = spec["make"]()
        key = f"library/{spec['kind']}/demo-{spec['kind']}{spec['ext']}"
        await storage.put_object(key, data, spec["mime"])
        cover = _demo_cover(spec["kind"])
        cover_key = f"library/covers/demo-{spec['kind']}.png"
        await storage.put_object(cover_key, cover, "image/png")

        item = LibraryItem(
            kind=spec["kind"],
            title=spec["title"],
            description=spec["description"],
            cover_media_key=cover_key,
            media_key=key,
            topic_tags=list(spec["tags"]),
            visibility="public",
            workflow_status="published",
            version=1,
            ai_scopes=[],
            include_in_fatwa_rag=False,
            ai_indexed=False,
            transcript=spec["transcript"],
            transcript_status="done" if spec["transcript"] else "pending",
            ocr_status="pending",
            duration_seconds=3 if spec["kind"] == "audio" else (1 if spec["kind"] in ("video", "video_360") else None),
            file_size_bytes=len(data),
            mime_type=spec["mime"],
            source_type="seed_demo",
            source_ref={"seed": DEMO_MARKER, "kind": spec["kind"]},
            published_at=_utcnow(),
        )
        # برچسب نمایشی صریح در عنوان فارسی
        item.title = {**spec["title"], "fa": spec["title"]["fa"] + " (نمایشی)"}
        db.add(item)
        created += 1
    await db.flush()
    return {"skipped": 0, "created": created}
