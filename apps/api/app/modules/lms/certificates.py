"""تولید گواهی PDF سه‌زبانه (fa/ar/en در یک صفحه) — فاز ۸.

- فقط reportlab + arabic-reshaper + python-bidi (در requirements.txt پین‌شده).
- فونت‌ها از فونت‌های سیستمیِ عربی‌قابل (Noto Naskh/Sans Arabic برای fa/ar،
  DejaVu Sans برای en) — بدون فونت باندل‌شده در ریپو.
- هیچ متن فقهی‌ای در PDF تولید/اختراع نمی‌شود؛ فقط نام دارنده، عنوان دوره
  (از محتوای ثبت‌شده)، کد گواهی و تاریخ صدور.
"""
from __future__ import annotations

import io
from functools import lru_cache

import arabic_reshaper
from bidi.algorithm import get_display


_AR_FONT_CANDIDATES = [
    # Noto Sans Arabic اول: برخلاف Naskh، علائم لاتین (خط تیره، دونقطه) را هم دارد
    "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf",
]
_LATIN_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


@lru_cache(maxsize=1)
def _fonts() -> tuple[str, str]:
    """ثبت فونت‌ها در reportlab؛ (فونت عربی، فونت لاتین)."""
    import os

    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    ar_path = next((p for p in _AR_FONT_CANDIDATES if os.path.exists(p)), None)
    la_path = next((p for p in _LATIN_FONT_CANDIDATES if os.path.exists(p)), None)
    if ar_path is None or la_path is None:
        raise RuntimeError("arabic/latin system fonts not found for certificate PDF")
    pdfmetrics.registerFont(TTFont("MaturidiAR", ar_path))
    pdfmetrics.registerFont(TTFont("MaturidiLA", la_path))
    return "MaturidiAR", "MaturidiLA"


_LRE = "\u202a"  # Left-to-Right Embedding
_PDF = "\u202c"  # Pop Directional Formatting


def _has_arabic_script(text: str) -> bool:
    return any("\u0600" <= ch <= "\u06FF" or "\u0750" <= ch <= "\u077F" for ch in text)


def _ltr_embed(text: str) -> str:
    """محصورسازی مقدار لاتین/ارقام در embedding چپ‌به‌راست.

    python-bidi قاعدهٔ W4 را برای HYPHEN-MINUS (مثل تاریخ 2026-10-19) در
    پاراگراف RTL درست اعمال نمی‌کند و ارقام را برعکس می‌کند؛ embedding
    صریح این را خنثی می‌کند.
    """
    return f"{_LRE}{text}{_PDF}"


def _rtl(text: str) -> str:
    """شکل‌دهی + ترتیب درست برای متن فارسی/عربی.

    رشتهٔ منطقی کامل (label + مقدار) یکجا پردازش می‌شود تا الگوریتم bidi
    جای لاتین/ارقام را درست بگذارد؛ رشتهٔ خالص لاتین دست‌نخورده می‌ماند.
    """
    text = text or ""
    if not _has_arabic_script(text):
        return text
    return get_display(arabic_reshaper.reshape(text))


def _mixed_line(canvas, cx, y, ar_font, la_font, size, label_fa, value_latin):
    """یک خط وسط‌چین دوزبانه: برچسب فارسی (راست، فونت عربی) + مقدار لاتین (چپ).

    تک‌فونتی ممکن نیست چون فونت عربی حروف لاتین ندارد و فونت لاتین
    فرم‌های نمایشی عربی ندارد؛ پس دو drawString جدا با اندازه‌گیری دقیق.
    """
    label_v = _rtl(label_fa)
    w_label = canvas.stringWidth(label_v, ar_font, size)
    w_value = canvas.stringWidth(value_latin, la_font, size)
    gap = canvas.stringWidth("  ", ar_font, size)
    x0 = cx - (w_label + gap + w_value) / 2
    canvas.setFont(la_font, size)
    canvas.drawString(x0, y, value_latin)
    canvas.setFont(ar_font, size)
    canvas.drawString(x0 + w_value + gap, y, label_v)


def render_certificate_pdf(
    *,
    holder_name: str,
    course_title_fa: str,
    course_title_ar: str,
    course_title_en: str,
    code: str,
    issued_date_iso: str,
) -> bytes:
    """یک صفحهٔ A4 با هر سه زبان — خروجی bytes (برای StorageProvider)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    ar_font, la_font = _fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    cx = width / 2

    # قاب
    c.setStrokeColorRGB(0.45, 0.32, 0.12)
    c.setLineWidth(3)
    c.rect(24, 24, width - 48, height - 48)
    c.setLineWidth(1)
    c.rect(32, 32, width - 64, height - 64)

    y = height - 110
    # سربرگ سه‌زبانهٔ آکادمی
    c.setFont(ar_font, 22)
    c.drawCentredString(cx, y, _rtl("آکادمی ماتریدی"))
    y -= 30
    c.setFont(ar_font, 18)
    c.drawCentredString(cx, y, _rtl("أكاديمية الماتريدي"))
    y -= 30
    c.setFont(la_font, 16)
    c.drawCentredString(cx, y, "Maturidi Academy")

    y -= 60
    c.setFont(ar_font, 28)
    c.drawCentredString(cx, y, _rtl("گواهی پایان دوره"))
    y -= 36
    c.setFont(ar_font, 22)
    c.drawCentredString(cx, y, _rtl("شهادة إتمام الدورة"))
    y -= 36
    c.setFont(la_font, 20)
    c.drawCentredString(cx, y, "Certificate of Completion")

    y -= 70
    c.setFont(ar_font, 20)
    c.drawCentredString(cx, y, _rtl(holder_name))

    y -= 50
    c.setFont(ar_font, 14)
    c.drawCentredString(cx, y, _rtl(f"دوره: {course_title_fa}"))
    y -= 28
    c.drawCentredString(cx, y, _rtl(f"الدورة: {course_title_ar}"))
    y -= 28
    c.setFont(la_font, 13)
    c.drawCentredString(cx, y, f"Course:  {course_title_en}")

    y -= 70
    c.setFont(la_font, 12)
    c.drawCentredString(cx, y, f"Verification code: {code}")
    y -= 24
    # خط دوزبانه: برچسب فارسی با فونت عربی (راست)، مقدار لاتین با فونت لاتین (چپ)
    _mixed_line(c, cx, y, ar_font, la_font, 12, "کد رهگیری:", code)
    y -= 24
    c.setFont(ar_font, 12)
    c.drawCentredString(cx, y, _rtl(f"تاریخ صدور: {_ltr_embed(issued_date_iso)}"))

    c.showPage()
    c.save()
    return buf.getvalue()
