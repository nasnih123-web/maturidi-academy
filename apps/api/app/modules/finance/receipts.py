"""رسید PDF سه‌زبانهٔ اهدا — فاز ۱۵.

از الگوی `app/modules/lms/certificates.py` استفاده می‌کند (reportlab +
arabic-reshaper + python-bidi، فونت‌های سیستمی) — منطق فونت/شکل‌دهی تکرار
نمی‌شود (§۱۵.۲) و فقط از طریق همان ماژول فراخوانی می‌گردد.

محتوا (طبق مشخصات): فقط نام اهداکننده، عنوان کمپین (از محتوای ثبت‌شده)،
مبلغ، کدهای مرجع و تاریخ‌ها — هیچ محتوای فقهی‌ای تولید/اختراع نمی‌شود.
"""
from __future__ import annotations

import io

from app.modules.lms import certificates as _cert


def render_receipt_pdf(
    *,
    donor_name: str,
    campaign_title_fa: str,
    campaign_title_ar: str,
    campaign_title_en: str,
    amount_irr: int,
    gateway: str,
    gateway_reference: str,
    intent_id: str,
    receipt_id: str,
    paid_at_iso: str,
) -> bytes:
    """یک صفحهٔ A4 سه‌زبانه — خروجی bytes."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    ar_font, la_font = _cert._fonts()
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
    c.setFont(ar_font, 22)
    c.drawCentredString(cx, y, _cert._rtl("آکادمی ماتریدی"))
    y -= 30
    c.setFont(ar_font, 18)
    c.drawCentredString(cx, y, _cert._rtl("أكاديمية الماتريدي"))
    y -= 30
    c.setFont(la_font, 16)
    c.drawCentredString(cx, y, "Maturidi Academy")

    y -= 60
    c.setFont(ar_font, 26)
    c.drawCentredString(cx, y, _cert._rtl("رسید اهدا"))
    y -= 34
    c.setFont(ar_font, 20)
    c.drawCentredString(cx, y, _cert._rtl("إيصال التبرع"))
    y -= 34
    c.setFont(la_font, 18)
    c.drawCentredString(cx, y, "Donation Receipt")

    y -= 60
    c.setFont(ar_font, 18)
    c.drawCentredString(cx, y, _cert._rtl(donor_name or "اهداکنندهٔ گرامی"))

    y -= 46
    c.setFont(ar_font, 13)
    c.drawCentredString(cx, y, _cert._rtl(f"کمپین: {campaign_title_fa}"))
    y -= 26
    c.drawCentredString(cx, y, _cert._rtl(f"الحملة: {campaign_title_ar}"))
    y -= 26
    c.setFont(la_font, 12)
    c.drawCentredString(cx, y, f"Campaign:  {campaign_title_en}")

    y -= 46
    amount_str = f"{amount_irr:,} IRR"
    _cert._mixed_line(c, cx, y, ar_font, la_font, 14, "مبلغ:", amount_str)
    y -= 30
    c.setFont(ar_font, 13)
    c.drawCentredString(cx, y, _cert._rtl(f"تاریخ پرداخت: {_cert._ltr_embed(paid_at_iso)}"))

    y -= 60
    c.setFont(la_font, 11)
    c.drawCentredString(cx, y, f"Gateway: {gateway}")
    y -= 22
    _cert._mixed_line(c, cx, y, ar_font, la_font, 11, "کد رهگیری درگاه:", gateway_reference)
    y -= 22
    _cert._mixed_line(c, cx, y, ar_font, la_font, 11, "شناسهٔ رسید:", receipt_id)
    y -= 22
    _cert._mixed_line(c, cx, y, ar_font, la_font, 11, "شناسهٔ پرداخت:", intent_id)

    c.showPage()
    c.save()
    return buf.getvalue()
