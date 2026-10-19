"""انتزاع provider متن/ترجمه/تفسیر/صوت قرآن — فاز ۵.

متن معیار قرآن فقط از provider می‌آید؛ **هیچ endpointای متن را ویرایش نمی‌کند**
(مشخصات فاز ۵ و §۱۵.۵: هیچ قاعده‌ای هاردکد/استنتاج نمی‌شود — متن دینی از
منبع canonical، نه از دانش مدل).

provider پیش‌فرض: AlQuranCloud (`https://api.alquran.cloud/v1`).
معماری provider اضافه (مثل Quran.com) فقط با پیاده‌سازی `QuranProvider` و
ثبت در `PROVIDERS` — بدون تغییر روتر/سرویس.

الزامات (مشخصات فاز ۵):
- timeout + retry با backoff روی خطاهای شبکه/۵xx؛
- کش درون‌فرایندی کوتاه‌مدت (۶۰۰ ثانیه) برای پاسخ‌های provider؛
- خرابی provider همیشه به `QuranProviderError` تبدیل می‌شود و سرویس آن را
  به پاکت خطای یکدست ۵۰۳ (§۱) تبدیل می‌کند — هرگز ۵۰۰ با traceback.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 10.0
RETRY_ATTEMPTS = 2
RETRY_BACKOFF = 0.5
CACHE_TTL = 600.0  # ۱۰ دقیقه — متن قرآن ثابت است؛ کش کوتاه فقط برای ترافیک

# متغیرهای پروکسی به ترتیب اولویت — صریح خوانده می‌شوند چون تجزیهٔ env در
# httpx روی بعضی محیط‌ها (no_proxy با IPv6 براکت‌دار) خطا می‌دهد؛ با proxy
# صریح، httpx دیگر env را تجزیه نمی‌کند.
_PROXY_ENV_VARS = (
    "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy",
    "ALL_PROXY", "all_proxy",
)


def _proxy_from_env() -> str | None:
    for var in _PROXY_ENV_VARS:
        url = os.environ.get(var)
        if url and url.strip():
            return url.strip()
    return None


class QuranProviderError(Exception):
    """خرابی provider — سرویس به APIError ۵۰۳ تبدیلش می‌کند."""

    def __init__(self, message: str, *, provider_id: str, status_code: int | None = None):
        super().__init__(message)
        self.provider_id = provider_id
        self.status_code = status_code


class AyahEditionText:
    """متن یک آیه در یک edition (متن/ترجمه/تفسیر/صوت)."""

    def __init__(
        self,
        *,
        text: str,
        audio_url: str | None = None,
        juz: int | None = None,
        page: int | None = None,
    ):
        self.text = text
        self.audio_url = audio_url
        self.juz = juz
        self.page = page


class QuranProvider(Protocol):
    """قرارداد هر provider قرآن."""

    id: str
    name: str

    async def fetch_surah(
        self,
        number: int,
        *,
        text_edition: str,
        translation_edition: str | None = None,
        tafsir_edition: str | None = None,
        reciter_edition: str | None = None,
    ) -> dict:
        """بستهٔ سوره: {ayahs: [{number_in_surah, editions: {edition_id: AyahEditionText}}], ...}."""
        ...

    async def fetch_ayah(
        self,
        surah: int,
        ayah: int,
        *,
        text_edition: str,
        translation_edition: str | None = None,
        tafsir_edition: str | None = None,
        reciter_edition: str | None = None,
    ) -> dict:
        ...


_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def _cache_get(key: str) -> dict | None:
    with _cache_lock:
        entry = _cache.get(key)
    if entry is None:
        return None
    stored_at, value = entry
    if time.monotonic() - stored_at > CACHE_TTL:
        with _cache_lock:
            _cache.pop(key, None)
        return None
    return value


def _cache_put(key: str, value: dict) -> None:
    with _cache_lock:
        _cache[key] = (time.monotonic(), value)


def clear_quran_cache() -> None:
    """فقط برای تست — پاک‌سازی کش درون‌فرایندی provider."""
    with _cache_lock:
        _cache.clear()


class AlQuranCloudProvider:
    """provider پیش‌فرض فاز ۵ — api.alquran.cloud (متن عثمانی Tanzil).

    از endpoint ترکیبی `/surah/{n}/editions/{a},{b},...` استفاده می‌کند تا
    متن+ترجمه+تفسیر+صوت در یک round-trip گرفته شود (بودجهٔ عملکرد §۱۶).
    """

    id = "alquran_cloud"
    name = "AlQuranCloud"
    base_url = "https://api.alquran.cloud/v1"

    def _edition_ids(
        self,
        text_edition: str,
        translation_edition: str | None,
        tafsir_edition: str | None,
        reciter_edition: str | None,
    ) -> list[str]:
        ids = [text_edition]
        for ed in (translation_edition, tafsir_edition, reciter_edition):
            if ed and ed not in ids:
                ids.append(ed)
        return ids

    async def _get(self, path: str) -> dict:
        last_exc: Exception | None = None
        for attempt in range(RETRY_ATTEMPTS + 1):
            try:
                # proxy صریح از env — بدون اتکا به تجزیهٔ خودکار httpx
                # (که روی بعضی محیط‌ها InvalidURL می‌دهد و باید graceful شود).
                async with httpx.AsyncClient(
                    timeout=REQUEST_TIMEOUT, proxy=_proxy_from_env()
                ) as client:
                    resp = await client.get(f"{self.base_url}{path}")
                if resp.status_code == 429 or resp.status_code >= 500:
                    last_exc = httpx.HTTPStatusError(
                        f"upstream {resp.status_code}", request=resp.request,
                        response=resp,
                    )
                    await asyncio.sleep(RETRY_BACKOFF * (attempt + 1))
                    continue
                if resp.status_code != 200:
                    raise QuranProviderError(
                        f"provider returned HTTP {resp.status_code}",
                        provider_id=self.id, status_code=resp.status_code,
                    )
                try:
                    body = resp.json()
                except ValueError as exc:
                    raise QuranProviderError(
                        f"provider returned invalid JSON: {exc}",
                        provider_id=self.id,
                    )
                if not isinstance(body, dict) or body.get("code") != 200:
                    raise QuranProviderError(
                        f"provider error payload: {str(body)[:200]}",
                        provider_id=self.id,
                    )
                return body["data"]
            except QuranProviderError:
                raise
            except httpx.HTTPError as exc:
                # همهٔ خطاهای حمل‌ونقل (timeout/connect/proxy/...) → retry و سپس ۵۰۳
                last_exc = exc
                logger.warning(
                    "alquran_cloud attempt %d failed: %s", attempt + 1, exc
                )
                await asyncio.sleep(RETRY_BACKOFF * (attempt + 1))
        raise QuranProviderError(
            f"provider unreachable after {RETRY_ATTEMPTS + 1} attempts: {last_exc}",
            provider_id=self.id,
        )

    @staticmethod
    def _merge_edition_ayahs(data: list[dict]) -> dict[int, dict]:
        """ادغام editions روی numberInSurah — کلید: شمارهٔ آیه در سوره."""
        merged: dict[int, dict] = {}
        for edition in data:
            edition_id = edition.get("edition", {}).get("identifier", "unknown")
            for ayah in edition.get("ayahs", []):
                n = ayah.get("numberInSurah")
                if n is None:
                    continue
                slot = merged.setdefault(n, {})
                slot[edition_id] = AyahEditionText(
                    text=ayah.get("text", ""),
                    audio_url=ayah.get("audio"),
                    juz=ayah.get("juz"),
                    page=ayah.get("page"),
                )
        return merged

    async def fetch_surah(
        self,
        number: int,
        *,
        text_edition: str,
        translation_edition: str | None = None,
        tafsir_edition: str | None = None,
        reciter_edition: str | None = None,
    ) -> dict:
        ids = self._edition_ids(
            text_edition, translation_edition, tafsir_edition, reciter_edition
        )
        cache_key = f"surah:{number}:{','.join(ids)}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        data = await self._get(f"/surah/{number}/editions/{','.join(ids)}")
        if not isinstance(data, list):
            raise QuranProviderError(
                "unexpected provider payload shape for surah",
                provider_id=self.id,
            )
        merged = self._merge_edition_ayahs(data)
        result = {
            "ayahs": [
                {"number_in_surah": n, "editions": merged[n]}
                for n in sorted(merged)
            ],
            "edition_ids": ids,
        }
        _cache_put(cache_key, result)
        return result

    async def fetch_ayah(
        self,
        surah: int,
        ayah: int,
        *,
        text_edition: str,
        translation_edition: str | None = None,
        tafsir_edition: str | None = None,
        reciter_edition: str | None = None,
    ) -> dict:
        ids = self._edition_ids(
            text_edition, translation_edition, tafsir_edition, reciter_edition
        )
        cache_key = f"ayah:{surah}:{ayah}:{','.join(ids)}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        data = await self._get(f"/ayah/{surah}:{ayah}/editions/{','.join(ids)}")
        if not isinstance(data, list):
            raise QuranProviderError(
                "unexpected provider payload shape for ayah",
                provider_id=self.id,
            )
        editions: dict[str, AyahEditionText] = {}
        for edition in data:
            edition_id = edition.get("edition", {}).get("identifier", "unknown")
            editions[edition_id] = AyahEditionText(
                text=edition.get("text", ""),
                audio_url=edition.get("audio"),
                juz=edition.get("juz"),
                page=edition.get("page"),
            )
        result = {"editions": editions, "edition_ids": ids}
        _cache_put(cache_key, result)
        return result


PROVIDERS: dict[str, QuranProvider] = {
    AlQuranCloudProvider.id: AlQuranCloudProvider(),
}


def get_provider(provider_id: str) -> QuranProvider:
    """provider ثبت‌شده — نامعتبر → QuranProviderError (سرویس: ۵۰۳/۴۰۰ envelope)."""
    try:
        return PROVIDERS[provider_id]
    except KeyError:
        raise QuranProviderError(
            f"unknown quran provider: {provider_id}", provider_id=provider_id
        ) from None
