"""ارائه‌دهندهٔ نرخ نصاب طلا/نقره — فاز ۷.

انتزاع قیمت از منبع قابل‌پیکربندی (env یا platform_settings) + کش در DB.
بدون کلید/URL: مسیر graceful با وضعیت price_unavailable — هرگز حدس/عدد
ساختگی برنمی‌گرداند (§۱۵.۹).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.platform_settings import get_typed_setting
from app.models.models import NisabPriceCache

CACHE_SOURCE = "default"
DEFAULT_TTL_SECONDS = 6 * 3600  # ۶ ساعت

_PRICE_URL_ENV = "NISAB_PRICE_URL"
_PRICE_URL_SETTING = "zakat.price_source_url"
_TTL_SETTING = "zakat.price_ttl_seconds"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _price_source_url(db: AsyncSession) -> str | None:
    env_url = os.environ.get(_PRICE_URL_ENV, "").strip()
    if env_url:
        return env_url
    try:
        value = await get_typed_setting(db, _PRICE_URL_SETTING, None)
    except Exception:  # noqa: BLE001 — تنظیم غایب/نامعتبر → مسیر graceful
        return None
    return str(value).strip() if value else None


async def _ttl_seconds(db: AsyncSession) -> int:
    try:
        value = await get_typed_setting(db, _TTL_SETTING, DEFAULT_TTL_SECONDS)
        return max(60, int(value))
    except Exception:  # noqa: BLE001
        return DEFAULT_TTL_SECONDS


async def fetch_live_prices(source_url: str) -> dict[str, Any]:
    """fetch مستقیم از URL پیکربندی‌شده.

    شکل قراردادی پاسخ: {"gold_per_gram": n, "silver_per_gram": n, "currency": "USD"}
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(source_url)
        resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, dict):
        raise ValueError("unexpected price payload shape")
    return {
        "gold_per_gram": data.get("gold_per_gram"),
        "silver_per_gram": data.get("silver_per_gram"),
        "currency": str(data.get("currency") or "USD"),
        "source": source_url,
    }


async def _read_cache(db: AsyncSession) -> NisabPriceCache | None:
    return (
        await db.execute(
            select(NisabPriceCache).where(NisabPriceCache.source == CACHE_SOURCE)
        )
    ).scalar_one_or_none()


async def _write_cache(
    db: AsyncSession, *, gold: Any, silver: Any, currency: str, source: str
) -> NisabPriceCache:
    row = await _read_cache(db)
    now = _utcnow()
    if row is None:
        row = NisabPriceCache(
            source=CACHE_SOURCE, currency=currency,
            gold_per_gram=gold, silver_per_gram=silver, fetched_at=now,
        )
        db.add(row)
    else:
        row.currency = currency
        row.gold_per_gram = gold
        row.silver_per_gram = silver
        row.fetched_at = now
        row.updated_at = now
    await db.flush()
    return row


def _to_out(
    row: NisabPriceCache | None, *, stale: bool, status: str, source: str
) -> dict[str, Any]:
    def _s(v: Any) -> str | None:
        return str(Decimal(str(v))) if v is not None else None

    return {
        "status": status,
        "gold_per_gram": _s(row.gold_per_gram) if row else None,
        "silver_per_gram": _s(row.silver_per_gram) if row else None,
        "currency": row.currency if row else None,
        "source": source,
        "fetched_at": row.fetched_at.isoformat() if row else None,
        "stale": stale,
    }


async def get_nisab_prices(db: AsyncSession) -> dict[str, Any]:
    """نرخ‌های نصاب با کش DB و پرچم staleness.

    - کش تازه (در TTL) → status=ok, stale=false
    - fetch موفق → کش به‌روز، status=ok
    - fetch ناموفق/بدون URL ولی کش موجود → status=stale, stale=true
    - هیچ کشی و هیچ منبعی → status=price_unavailable (graceful، بدون exception)
    """
    source_url = await _price_source_url(db)
    ttl = await _ttl_seconds(db)
    cached = await _read_cache(db)
    now = _utcnow()

    if cached is not None:
        fetched = cached.fetched_at
        if fetched.tzinfo is None:
            # SQLite نا‌آگاه برمی‌گرداند — همهٔ زمان‌ها UTCاند (§۱)
            fetched = fetched.replace(tzinfo=timezone.utc)
        age = (now - fetched).total_seconds()
        if age <= ttl and cached.gold_per_gram is not None:
            return _to_out(cached, stale=False, status="ok", source="cache")

    if source_url:
        try:
            live = await fetch_live_prices(source_url)
            row = await _write_cache(
                db,
                gold=live["gold_per_gram"],
                silver=live["silver_per_gram"],
                currency=live["currency"],
                source=source_url,
            )
            await db.commit()
            return _to_out(row, stale=False, status="ok", source=source_url)
        except Exception:  # noqa: BLE001 — شبکه/شکل پاسخ: fallback به کش
            pass

    if cached is not None and cached.gold_per_gram is not None:
        return _to_out(cached, stale=True, status="stale", source="cache")

    return {
        "status": "price_unavailable",
        "gold_per_gram": None,
        "silver_per_gram": None,
        "currency": None,
        "source": source_url or "unconfigured",
        "fetched_at": None,
        "stale": False,
    }
