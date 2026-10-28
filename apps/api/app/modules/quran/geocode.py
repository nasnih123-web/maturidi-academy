"""جست‌وجو و نام‌گذاری مکان برای صفحهٔ اوقات شرعی — پروکسی Nominatim.

صفحه دیگر فیلد شهر ندارد: کاربر هر مکانی در جهان (شهر، روستا، منطقه) را
سرچ می‌کند یا با GPS موقعیت می‌گیرد. پوشش جهانی با Nominatim/OpenStreetMap
به دست می‌آید — هیچ فهرست مکانی هاردکد نمی‌شود و هیچ نتیجه‌ای جعل نمی‌شود.

- جست‌وجو: Nominatim /search (limit=8، addressdetails=1، accept-language=fa).
- نام کوتاه: village → town → city → municipality → county → state؛ اگر
  هیچ‌کدام نبود، بخش اول display_name. display_name همان رشتهٔ محلی
  Nominatim است.
- معکوس: Nominatim /reverse (zoom=10، addressdetails=1، accept-language=fa).
- حافظهٔ درون‌فرایندی با TTL یک ساعت؛ خطای بالادست → GeocodeUpstreamError
  (سرویس آن را به ۵۰۲ تبدیل می‌کند). مختصات هرگز لاگ نمی‌شوند — این ماژول
  اصلاً لاگ نمی‌نویسد.
"""
from __future__ import annotations

import time

import httpx

NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
_USER_AGENT = "Maturidi-Academy/1.0 (prayer-times page)"
_TIMEOUT = 10.0
_CACHE_TTL = 3600.0
_SEARCH_LIMIT = 8

_SHORT_NAME_KEYS = ("village", "town", "city", "municipality", "county", "state")

_cache: dict[str, tuple[float, object]] = {}


class GeocodeUpstreamError(Exception):
    """بالادست جغرافیایی در دسترس نیست یا پاسخ نامعتبر داد."""


def _cache_get(key: str):
    entry = _cache.get(key)
    if entry is None:
        return None
    ts, value = entry
    if time.monotonic() - ts > _CACHE_TTL:
        del _cache[key]
        return None
    return value


def _cache_set(key: str, value: object) -> None:
    if len(_cache) > 1000:
        _cache.clear()
    _cache[key] = (time.monotonic(), value)


def _http_get(path: str, params: dict) -> object:
    """یک GET به Nominatim — نقطهٔ تزریق تست‌ها (mock همین تابع است)."""
    try:
        with httpx.Client(timeout=_TIMEOUT, headers={"User-Agent": _USER_AGENT}) as client:
            res = client.get(f"{NOMINATIM_BASE}{path}", params=params)
    except httpx.HTTPError as exc:
        raise GeocodeUpstreamError(f"nominatim unreachable: {exc}") from exc
    if res.status_code != 200:
        raise GeocodeUpstreamError(f"nominatim status {res.status_code}")
    try:
        return res.json()
    except ValueError as exc:
        raise GeocodeUpstreamError("nominatim invalid json") from exc


def _short_name(address: dict, display_name: str) -> str | None:
    for key in _SHORT_NAME_KEYS:
        value = address.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    if display_name:
        first = display_name.split(",")[0].strip()
        if first:
            return first
    return None


def _place_from_item(item: dict) -> dict:
    raw_address = item.get("address")
    address: dict = raw_address if isinstance(raw_address, dict) else {}
    raw_display_name = item.get("display_name")
    display_name: str = raw_display_name if isinstance(raw_display_name, str) else ""
    try:
        lat = float(item["lat"])
        lng = float(item["lon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise GeocodeUpstreamError("nominatim item without coordinates") from exc
    return {
        "name": _short_name(address, display_name),
        "display_name": display_name,
        "lat": lat,
        "lng": lng,
    }


def search_places(query: str) -> list[dict]:
    """جست‌وجوی مکان — حداکثر ۸ نتیجه، مرتب به ترتیب Nominatim."""
    q = query.strip()
    if not q:
        raise ValueError("empty geocode query")
    cache_key = f"search:{q.lower()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]
    data = _http_get(
        "/search",
        {"format": "json", "addressdetails": 1, "limit": _SEARCH_LIMIT,
         "accept-language": "fa", "q": q},
    )
    if not isinstance(data, list):
        raise GeocodeUpstreamError("nominatim search did not return a list")
    results = [_place_from_item(item) for item in data if isinstance(item, dict)]
    _cache_set(cache_key, results)
    return results


def reverse_place(lat: float, lng: float) -> dict:
    """نام مکان برای مختصات — اگر نامی نبود، name برابر None است.

    نبودِ نام هرگز خطا نیست: تماس‌گیرنده (صفحه) باز هم اوقات را از روی
    مختصات می‌گیرد و مختصات را به‌عنوان برچسب نشان می‌دهد.
    """
    cache_key = f"reverse:{round(lat, 4)}:{round(lng, 4)}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]
    data = _http_get(
        "/reverse",
        {"format": "json", "lat": lat, "lon": lng, "zoom": 10,
         "addressdetails": 1, "accept-language": "fa"},
    )
    if not isinstance(data, dict):
        raise GeocodeUpstreamError("nominatim reverse did not return an object")
    place = _place_from_item(data)
    _cache_set(cache_key, place)
    return place
