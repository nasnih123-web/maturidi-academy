"""سرویس ویجت‌ها — فاز ۱۱ (ADR-0008).

- هیچ قاعدهٔ فقهی هاردکد نمی‌شود (§۱۵.۵): اوقات شرعی از موتور فاز ۵، زکات
  از موتور واقعی فاز ۷ با rule فعال (اگر rule نبود: ۵۰۳ صادقانه).
- آیهٔ روز: انتخاب قطعی روزانه از فهرست ارجاع‌های (surah, ayah) — متن آیه
  همیشه از provider قرآن می‌آید، نه هاردکد (§۱۵.۴).
- آخرین فتوا: فقط workflow_status=published.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.models import FatwaSubmission

logger = logging.getLogger("app.widgets")

try:  # alias امن برای except — redis وابستگی واقعی است (arq)
    from redis.exceptions import RedisError as _RedisError
except ImportError:  # pragma: no cover
    class _RedisError(Exception):  # type: ignore[no-redef]
        pass

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
    from app.modules.quran import service as quran_service

    return await quran_service.get_ayah_bundle(db, surah, ayah)


async def prayer_times_widget(
    *,
    lat: float,
    lng: float,
    method: str = "mwl",
    madhab: str = "shafi",
    tz: float = 3.5,
) -> dict:
    from app.modules.quran import adhan

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


# ---------------------------------------------------------------------------
# کش آیهٔ روز (C-06/F1 — طوفان تلاش مجدد)
# ---------------------------------------------------------------------------
# آیهٔ روز برای یک تاریخ ثابت است؛ بدون کش، هر رندرِ ویجت در هزاران
# سایتِ embed یک فراخوانی provider خارجی می‌ساخت و هنگام قطعی provider
# به طوفان retry بدل می‌شد. حالا: موفقیت تا پایان روز (سقف ۶ ساعت)
# کش می‌شود و شکست ۶۰ ثانیه negative-cache می‌شود تا در قطعی،
# به‌ازای هر درخواست به provider ضربه نزنیم. کش اول Redis است و در
# نبودش in-process؛ هدر Cache-Control هم در روتر ست می‌شود.


_ayah_mem_cache: dict[str, tuple[float, dict | None]] = {}
_ayah_redis_client = None
_ayah_redis_tried = False

_NEGATIVE_TTL = 60.0


def _success_ttl() -> float:
    now = datetime.now(UTC)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    to_midnight = ((midnight + timedelta(days=1)) - now).total_seconds()
    return max(300.0, min(21600.0, to_midnight))


async def _ayah_redis():
    global _ayah_redis_client, _ayah_redis_tried
    if _ayah_redis_tried:
        return _ayah_redis_client
    _ayah_redis_tried = True
    try:
        import redis.asyncio as aioredis

        from app.core.config import get_settings

        client = aioredis.from_url(
            get_settings().redis_url, socket_connect_timeout=2
        )
        await client.ping()
        _ayah_redis_client = client
    except (ImportError, OSError, ValueError, _RedisError):
        logger.warning("ayah-of-day cache: redis unavailable — in-process cache")
        _ayah_redis_client = None
    return _ayah_redis_client


async def _ayah_cache_get(key: str) -> tuple[bool, dict | None]:
    client = await _ayah_redis()
    if client is not None:
        raw = await client.get(key)
        if raw is None:
            return False, None
        s = raw.decode() if isinstance(raw, bytes) else raw
        return True, (None if s == "__error__" else json.loads(s))
    entry = _ayah_mem_cache.get(key)
    if entry is None or entry[0] < time.time():
        return False, None
    return True, entry[1]


async def _ayah_cache_set(key: str, value: dict | None, ttl: float) -> None:
    client = await _ayah_redis()
    if client is not None:
        await client.set(
            key, "__error__" if value is None else json.dumps(value), ex=int(ttl)
        )
        return
    _ayah_mem_cache[key] = (time.time() + ttl, value)


async def ayah_of_day(db: AsyncSession, *, bundle_fn=None) -> dict:
    """آیهٔ روز — قطعی بر اساس روز سال (تزریق‌پذیر برای تست) + کش روزانه."""
    idx = date.today().timetuple().tm_yday % len(AYAH_ROTATION)
    surah, ayah = AYAH_ROTATION[idx]
    cache_key = f"widget:ayah-of-day:{date.today().isoformat()}:{surah}:{ayah}"
    hit, cached = await _ayah_cache_get(cache_key)
    if hit:
        if cached is None:
            raise APIError(502, "quran_provider_error", "دریافت آیه ناموفق بود")
        return {
            "date": date.today().isoformat(),
            "surah": surah,
            "ayah": ayah,
            "bundle": cached,
        }
    fn = bundle_fn or _default_ayah_bundle
    try:
        bundle = await fn(db, surah, ayah)
    except APIError:
        raise
    except Exception as exc:
        await _ayah_cache_set(cache_key, None, _NEGATIVE_TTL)
        raise APIError(502, "quran_provider_error", "دریافت آیه ناموفق بود") from exc
    await _ayah_cache_set(cache_key, bundle, _success_ttl())
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
    from app.modules.calculators import service as calc_service

    try:
        amt = Decimal(str(amount))
    except (InvalidOperation, ValueError, TypeError):
        raise APIError(422, "bad_amount", "مبلغ نامعتبر است")
    if amt < 0:
        raise APIError(422, "bad_amount", "مبلغ نمی‌تواند منفی باشد")
    try:
        result = await calc_service.calculate_zakat(
            db, assets={"cash": amt}, debts=Decimal(0)
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
