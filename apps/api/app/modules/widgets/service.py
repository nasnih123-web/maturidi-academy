"""سرویس ویجت‌ها — فاز ۱۱ (ADR-0008).

- هیچ قاعدهٔ فقهی هاردکد نمی‌شود (§۱۵.۵): اوقات شرعی از موتور فاز ۵، زکات
  از موتور واقعی فاز ۷ با rule فعال (اگر rule نبود: ۵۰۳ صادقانه).
- آیهٔ روز: انتخاب قطعی روزانه از فهرست ارجاع‌های (surah, ayah) — متن آیه
  همیشه از provider قرآن می‌آید، نه هاردکد (§۱۵.۴).
- آخرین فتوا: فقط workflow_status=published.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.models import FatwaSubmission

# ارجاع‌های ثابت آیات مشهور — فقط (سوره، آیه)؛ متن از provider می‌آید.
AYAH_ROTATION: list[tuple[int, int]] = [
    (2, 255),   # آیةالکرسی
    (13, 28),
    (94, 6),
    (2, 152),
    (39, 53),
    (55, 13),
    (3, 139),
    (65, 3),
    (94, 5),
    (20, 114),
]


async def _default_ayah_bundle(db: AsyncSession, surah: int, ayah: int) -> dict:
    from app.modules.quran import service as quran_service  # noqa: PLC0415

    return await quran_service.get_ayah_bundle(db, surah, ayah)


async def prayer_times_widget(
    *,
    lat: float,
    lng: float,
    method: str = "mwl",
    madhab: str = "shafi",
    tz: float = 3.5,
) -> dict:
    from app.modules.quran import adhan  # noqa: PLC0415

    if not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise APIError(422, "bad_coordinates", "مختصات نامعتبر است")
    try:
        times = adhan.prayer_times(
            date.today(), lat, lng, tz=tz, method=method, madhab=madhab
        )
    except ValueError as exc:
        raise APIError(422, "bad_prayer_params", str(exc))
    return {
        "date": date.today().isoformat(),
        "lat": lat,
        "lng": lng,
        "method": method,
        "madhab": madhab,
        "tz": tz,
        "times": times,
    }


async def ayah_of_day(db: AsyncSession, *, bundle_fn=None) -> dict:
    """آیهٔ روز — قطعی بر اساس روز سال (تزریق‌پذیر برای تست)."""
    idx = date.today().timetuple().tm_yday % len(AYAH_ROTATION)
    surah, ayah = AYAH_ROTATION[idx]
    fn = bundle_fn or _default_ayah_bundle
    try:
        bundle = await fn(db, surah, ayah)
    except APIError:
        raise
    except Exception as exc:  # noqa: BLE001 — خطای provider
        raise APIError(502, "quran_provider_error", "دریافت آیه ناموفق بود") from exc
    return {
        "date": date.today().isoformat(),
        "surah": surah,
        "ayah": ayah,
        "bundle": bundle,
    }


async def latest_fatwa(db: AsyncSession) -> dict:
    row = (
        await db.execute(
            select(FatwaSubmission)
            .where(FatwaSubmission.workflow_status == "published")
            .order_by(FatwaSubmission.published_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        raise APIError(404, "no_published_fatwa", "هنوز فتوای منتشرشده‌ای نیست")
    return {
        "id": str(row.id),
        "title": row.title or {},
        "excerpt": (row.body or "")[:400],
        "published_at": row.published_at.isoformat() if row.published_at else None,
    }


async def zakat_mini(db: AsyncSession, *, amount: str) -> dict:
    """ماشین‌حساب سادهٔ زکات — موتور واقعی فاز ۷؛ بدون rule: ۵۰۳ صادقانه."""
    from app.modules.calculators import service as calc_service  # noqa: PLC0415

    try:
        amt = Decimal(str(amount))
    except (InvalidOperation, ValueError, TypeError):
        raise APIError(422, "bad_amount", "مبلغ نامعتبر است")
    if amt < 0:
        raise APIError(422, "bad_amount", "مبلغ نمی‌تواند منفی باشد")
    try:
        result = await calc_service.calculate_zakat(
            db, assets={"cash": amt}, debts=Decimal("0")
        )
    except APIError as exc:
        if exc.code == "rules_not_approved":
            raise APIError(
                503,
                "zakat_rule_not_configured",
                "پیکربندی زکات هنوز توسط عالم تأیید نشده است",
            )
        raise
    res = result.get("result") or {}
    return {
        "amount": str(amt),
        "currency": (result.get("nisab_snapshot") or {}).get("currency"),
        "zakat_due": str(res.get("zakat_due")) if res.get("zakat_due") is not None else None,
        "nisab": str(res.get("nisab_value")) if res.get("nisab_value") is not None else None,
        "detail": result,
    }
