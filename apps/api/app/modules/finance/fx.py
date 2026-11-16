"""نرخ لحظه‌ای ارز برای تبدیل حمایت‌های دستیِ ارزی به ریال.

هنگام تأیید یک حمایت دستی با ارز غیرریالی (USDT / TON / USD)، مبلغ آن
باید با نرخ لحظه‌ای به ریال تبدیل و به مجموع کمپین اضافه شود (درخواست
مالک). منابع عمومیِ بدون کلید:

- والکس (api.wallex.ir): بازار USDTTMN برای تتر و دلار (دلار با نرخ
  تتر سنجیده می‌شود — عرف بازار ایران) و TONUSDT برای نرخ تقاطعی تون.
- کوین‌گکو: TON/USD جهانی، وقتی بازار تونِ والکس نقدشونده نیست.

هر خطا یا نبود قیمت → FxUnavailable؛ در آن حالت مسیر تأیید از ادمین
نرخ دستی می‌خواهد. نرخ هرگز حدس زده یا ساخته نمی‌شود. پاسخ والکس در
حافظهٔ فرایند ۵ دقیقه کش می‌شود تا هنگام تأییدهای پیاپی، منبع بیرونی
زیر فشار نرود.
"""
from __future__ import annotations

import time
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

import httpx

_TIMEOUT = httpx.Timeout(6.0, connect=4.0)
_CACHE_TTL_S = 300.0
_WALLEX_MARKETS_URL = "https://api.wallex.ir/v1/markets"
_COINGECKO_TON_URL = (
    "https://api.coingecko.com/api/v3/simple/price?ids=toncoin&vs_currencies=usd"
)
_UA = {"User-Agent": "maturidi-academy/1.0 (+finance-fx)"}

_wallex_cache: tuple[dict, float] | None = None
_rate_cache: dict[str, tuple[int, str, float]] = {}


class FxUnavailable(Exception):
    """نرخ لحظه‌ای از هیچ منبعی به دست نیامد — نرخ دستی لازم است."""

    def __init__(self, currency: str) -> None:
        super().__init__(currency)
        self.currency = currency


def _price(raw: object) -> Decimal | None:
    """قیمت والکس: رشتهٔ عددی یا '-' (نبود معامله) → Decimal مثبت یا None."""
    if raw is None:
        return None
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        return None
    return value if value > 0 else None


async def _wallex_symbols() -> dict:
    global _wallex_cache
    now = time.monotonic()
    if _wallex_cache is not None and now - _wallex_cache[1] < _CACHE_TTL_S:
        return _wallex_cache[0]
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.get(_WALLEX_MARKETS_URL, headers=_UA)
        res.raise_for_status()
        data = res.json()
    symbols = (data.get("result") or {}).get("symbols") or {}
    if not isinstance(symbols, dict) or not symbols:
        raise FxUnavailable("wallex")
    _wallex_cache = (symbols, now)
    return symbols


def _wallex_last(symbols: dict, symbol: str) -> Decimal | None:
    stats = (symbols.get(symbol) or {}).get("stats") or {}
    return _price(stats.get("lastPrice"))


async def _usdt_rate_irr() -> tuple[int, str] | None:
    """نرخ هر USDT به ریال از بازار USDTTMN والکس (تومان × ۱۰)."""
    try:
        symbols = await _wallex_symbols()
    except (httpx.HTTPError, ValueError, FxUnavailable):
        return None
    tmn = _wallex_last(symbols, "USDTTMN")
    if tmn is None:
        return None
    return int((tmn * 10).to_integral_value(rounding=ROUND_HALF_UP)), "wallex"


async def _ton_rate_irr() -> tuple[int, str] | None:
    """نرخ هر TON به ریال: تقاطعی از والکس، وگرنه کوین‌گکو × نرخ تتر."""
    usdt = await _usdt_rate_irr()
    if usdt is None:
        return None
    usdt_irr, _ = usdt
    try:
        symbols = await _wallex_symbols()
        ton_usdt = _wallex_last(symbols, "TONUSDT")
    except (httpx.HTTPError, ValueError, FxUnavailable):
        ton_usdt = None
    if ton_usdt is not None:
        return int((ton_usdt * usdt_irr).to_integral_value(rounding=ROUND_HALF_UP)), "wallex"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.get(_COINGECKO_TON_URL, headers=_UA)
            res.raise_for_status()
            ton_usd = _price((res.json().get("toncoin") or {}).get("usd"))
    except (httpx.HTTPError, ValueError, KeyError, AttributeError):
        return None
    if ton_usd is None:
        return None
    return int((ton_usd * usdt_irr).to_integral_value(rounding=ROUND_HALF_UP)), "coingecko"


async def get_rate_irr(currency: str) -> tuple[int, str]:
    """(نرخ هر واحد به ریال، منبع) — برای ارز ناشناس/بدون قیمت FxUnavailable."""
    cur = (currency or "").upper()
    if cur == "IRR":
        return 1, "fixed"
    now = time.monotonic()
    cached = _rate_cache.get(cur)
    if cached is not None and now - cached[2] < _CACHE_TTL_S:
        return cached[0], cached[1]
    rate: tuple[int, str] | None = None
    if cur in ("USDT", "USD"):
        rate = await _usdt_rate_irr()
    elif cur == "TON":
        rate = await _ton_rate_irr()
    if rate is None:
        raise FxUnavailable(cur)
    _rate_cache[cur] = (rate[0], rate[1], now)
    return rate
