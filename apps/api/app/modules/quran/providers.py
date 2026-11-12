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
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
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
        text_edition: str | None = None,
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
        text_edition: str | None = None,
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


def _cache_get_stale(key: str) -> dict | None:
    """مقدار کش بدون توجه به TTL — فقط پشتیبانِ هنگام خطای upstream.

    گام ۵: وابستگی زندهٔ ترجمه/تفسیر نباید با اولین قطعی AlQuran
    Cloud کل صفحه را ۵۰۳ کند؛ اگر نسخه‌ای از همین پاسخ قبلاً گرفته
    شده، همان (با لاگ هشدار) سرو می‌شود تا upstream برگردد.
    """
    with _cache_lock:
        entry = _cache.get(key)
    return entry[1] if entry is not None else None


def clear_quran_cache() -> None:
    """فقط برای تست — پاک‌سازی کش درون‌فرایندی provider."""
    with _cache_lock:
        _cache.clear()


class AlQuranCloudProvider:
    """provider پیش‌فرض فاز ۵ — api.alquran.cloud (متن عثمانی Tanzil).

    از endpoint ترکیبی `/surah/{n}/editions/{a},{b},...` استفاده می‌کند تا
    متن+ترجمه+تفسیر+صوت در یک round-trip گرفته شود (بودجهٔ عملکرد §۱۶).

    کلاس پایهٔ providerهای سازگار با شکل AlQuran Cloud است: زیرکلاس
    `AlQuranCompatibleProvider` همان قرارداد را با شناسه/نشانی دلخواه
    (provider سفارشیِ ثبت‌شده در رجیستری فاز ۲) پیاده می‌کند.
    """

    id = "alquran_cloud"
    name = "AlQuranCloud"
    base_url = "https://api.alquran.cloud/v1"
    api_key: str | None = None

    def _edition_ids(
        self,
        text_edition: str | None,
        translation_edition: str | None,
        tafsir_edition: str | None,
        reciter_edition: str | None,
    ) -> list[str]:
        # گروه‌بندی فاز ۲ فقط editionهای همان گروه را می‌دهد؛ text_edition
        # برای گروه‌های غیرمتن None است و از مسیر حذف می‌شود.
        ids: list[str] = []
        for ed in (text_edition, translation_edition, tafsir_edition, reciter_edition):
            if ed and ed not in ids:
                ids.append(ed)
        if not ids:
            raise QuranProviderError(
                "no editions requested", provider_id=self.id,
            )
        return ids

    async def _get(self, path: str) -> dict:
        last_exc: Exception | None = None
        for attempt in range(RETRY_ATTEMPTS + 1):
            try:
                # proxy صریح از env — بدون اتکا به تجزیهٔ خودکار httpx
                # (که روی بعضی محیط‌ها InvalidURL می‌دهد و باید graceful شود).
                # کلید provider سفارشی فقط در هدر می‌رود و هرگز لاگ نمی‌شود.
                headers = (
                    {"Authorization": f"Bearer {self.api_key}"}
                    if self.api_key
                    else None
                )
                async with httpx.AsyncClient(
                    timeout=REQUEST_TIMEOUT, proxy=_proxy_from_env(),
                    headers=headers,
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
        text_edition: str | None = None,
        translation_edition: str | None = None,
        tafsir_edition: str | None = None,
        reciter_edition: str | None = None,
    ) -> dict:
        ids = self._edition_ids(
            text_edition, translation_edition, tafsir_edition, reciter_edition
        )
        cache_key = f"surah:{self.id}:{number}:{','.join(ids)}"
        # پشتیبانِ stale را قبل از _cache_get بردار — آن تابع مقدارِ
        # منقضی را از کش حذف می‌کند و پشتیبان باید قبلش ذخیره شده باشد.
        stale = _cache_get_stale(cache_key)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        try:
            return await self._fetch_surah_live(number, ids, cache_key)
        except QuranProviderError:
            if stale is not None:
                logger.warning(
                    "provider %s failed for surah %s; serving stale cache",
                    self.id, number,
                )
                return stale
            raise

    async def _fetch_surah_live(
        self, number: int, ids: list[str], cache_key: str
    ) -> dict:
        data = await self._get(f"/surah/{number}/editions/{','.join(ids)}")
        if not isinstance(data, list):
            raise QuranProviderError(
                "unexpected provider payload shape for surah",
                provider_id=self.id,
            )
        merged = self._merge_edition_ayahs(data)
        if not merged:
            raise QuranProviderError(
                "provider returned no ayahs for surah",
                provider_id=self.id,
            )
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
        text_edition: str | None = None,
        translation_edition: str | None = None,
        tafsir_edition: str | None = None,
        reciter_edition: str | None = None,
    ) -> dict:
        ids = self._edition_ids(
            text_edition, translation_edition, tafsir_edition, reciter_edition
        )
        cache_key = f"ayah:{self.id}:{surah}:{ayah}:{','.join(ids)}"
        stale = _cache_get_stale(cache_key)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        try:
            return await self._fetch_ayah_live(surah, ayah, ids, cache_key)
        except QuranProviderError:
            if stale is not None:
                logger.warning(
                    "provider %s failed for ayah %s:%s; serving stale cache",
                    self.id, surah, ayah,
                )
                return stale
            raise

    async def _fetch_ayah_live(
        self, surah: int, ayah: int, ids: list[str], cache_key: str
    ) -> dict:
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
        if not editions:
            raise QuranProviderError(
                "provider returned no editions for ayah",
                provider_id=self.id,
            )
        result = {"editions": editions, "edition_ids": ids}
        _cache_put(cache_key, result)
        return result


# ---------------------------------------------------------------------------
# رجیستری provider فاز ۲ — ترکیب بر اساس نوع محتوا
# ---------------------------------------------------------------------------

#: انواع محتوایی که هر یک دقیقاً یک provider دارند (تصمیم قفل‌شده).
PROVIDER_CONTENT_TYPES = ("audio", "text", "translation", "tafsir")

#: provider پیش‌فرض هر نوع، وقتی انتخابی ثبت نشده باشد.
DEFAULT_PROVIDERS_BY_TYPE: dict[str, str] = {
    "audio": "alquran_cloud",
    "text": "self_hosted",
    "translation": "alquran_cloud",
    "tafsir": "alquran_cloud",
}


class AlQuranCompatibleProvider(AlQuranCloudProvider):
    """provider سفارشیِ سازگار با شکل AlQuran Cloud.

    همان قرارداد و همان اعتبارسنجی شکل پاسخ (`code == 200`، دادهٔ فهرستی،
    آیه‌های غیرتهی) را دارد، فقط شناسه/نام/نشانی از رجیستری می‌آید.
    شکل ناسازگار هرگز بی‌صدا پذیرفته نمی‌شود: `_get` یا ادغام،
    `QuranProviderError` می‌دهد و سرویس آن را به ۵۰۳ صادقانه تبدیل می‌کند.
    کلید (در صورت وجود) فقط در هدر Authorization می‌رود و هرگز لاگ نمی‌شود.
    """

    def __init__(
        self,
        *,
        id: str,
        name: str,
        base_url: str,
        api_key: str | None = None,
    ):
        self.id = id
        self.name = name
        self.base_url = base_url
        self.api_key = api_key or None


#: مسیر فایل متن Tanzil — کنار همین ماژول، سمت سرور (هرگز در باندل وب).
_TANZIL_PATH = Path(__file__).resolve().parent / "data" / "tanzil_uthmani.txt"
_TANZIL_LINE_RE = re.compile(r"^(\d+)\|(\d+)\|(.*)$")
_tanzil_lock = threading.Lock()
_tanzil_data: dict[int, dict[int, str]] | None = None


def _load_tanzil_text() -> dict[int, dict[int, str]]:
    """خواندن تنبل فایل Tanzil — فقط خط‌های `سوره|آیه|متن`، بقیه
    (بلوک کپی‌رایت و خط‌های خالی) نادیده گرفته می‌شوند. نسخهٔ ذخیره‌شده
    هرگز تغییر نمی‌کند؛ نرمال‌سازی جستجو و تقسیم ۶/۷ فاتحه فقط در
    زمان نمایش/ایندکس انجام می‌شود، نه روی این متن."""
    global _tanzil_data
    if _tanzil_data is not None:
        return _tanzil_data
    with _tanzil_lock:
        if _tanzil_data is not None:
            return _tanzil_data
        try:
            raw = _TANZIL_PATH.read_text(encoding="utf-8")
        except OSError as exc:
            raise QuranProviderError(
                "self-hosted quran text file is missing",
                provider_id="self_hosted",
            ) from exc
        data: dict[int, dict[int, str]] = {}
        for line in raw.splitlines():
            m = _TANZIL_LINE_RE.match(line)
            if not m:
                continue
            data.setdefault(int(m.group(1)), {})[int(m.group(2))] = m.group(3)
        total = sum(len(v) for v in data.values())
        if len(data) != 114 or total != 6236:
            raise QuranProviderError(
                "self-hosted quran text file is incomplete",
                provider_id="self_hosted",
            )
        _tanzil_data = data
        return data


class SelfHostedProvider:
    """متن عربی خودمیزبان (Tanzil Uthmani 1.1، Hafs) — فقط نوع text.

    پشت همان قرارداد QuranProvider. فایل سمت سرور ذخیره شده و لفظ‌به‌لفظ
    (verbatim، CC BY 3.0) سرو می‌شود؛ ترجمه/تفسیر/صوت از providerهای
    خودشان می‌آیند (گروه‌بندی سرویس هرگز edition غیرمتن را به این
    provider نمی‌دهد؛ اگر مستقیم چنین درخواستی برسد، خطا می‌دهد نه
    پاسخ ناقص بی‌صدا). فایل Tanzil شمارهٔ جزء/صفحه ندارد، پس juz/page
    برای این edition همیشه None است — خوانندهٔ وب null را تحمل می‌کند
    (quran.ts آن‌ها را به null تبدیل می‌کند) و جزء/صفحه را از دادهٔ
    مصحف می‌خواند، نه از edition متن."""

    id = "self_hosted"
    name = "Self-hosted (Tanzil)"
    base_url = ""

    async def fetch_surah(
        self,
        number: int,
        *,
        text_edition: str | None = None,
        translation_edition: str | None = None,
        tafsir_edition: str | None = None,
        reciter_edition: str | None = None,
    ) -> dict:
        if not text_edition:
            raise QuranProviderError(
                "self_hosted requires text_edition",
                provider_id=self.id,
            )
        if translation_edition or tafsir_edition or reciter_edition:
            raise QuranProviderError(
                "self_hosted serves text only",
                provider_id=self.id,
            )
        data = _load_tanzil_text()
        surah = data.get(number)
        if surah is None:
            raise QuranProviderError(
                f"surah not in self-hosted text: {number}",
                provider_id=self.id,
            )
        return {
            "ayahs": [
                {
                    "number_in_surah": ayah,
                    "editions": {
                        text_edition: AyahEditionText(text=surah[ayah]),
                    },
                }
                for ayah in sorted(surah)
            ],
            "edition_ids": [text_edition],
        }

    async def fetch_ayah(
        self,
        surah: int,
        ayah: int,
        *,
        text_edition: str | None = None,
        translation_edition: str | None = None,
        tafsir_edition: str | None = None,
        reciter_edition: str | None = None,
    ) -> dict:
        if not text_edition:
            raise QuranProviderError(
                "self_hosted requires text_edition",
                provider_id=self.id,
            )
        if translation_edition or tafsir_edition or reciter_edition:
            raise QuranProviderError(
                "self_hosted serves text only",
                provider_id=self.id,
            )
        data = _load_tanzil_text()
        text = data.get(surah, {}).get(ayah)
        if text is None:
            raise QuranProviderError(
                f"ayah not in self-hosted text: {surah}:{ayah}",
                provider_id=self.id,
            )
        return {"editions": {text_edition: AyahEditionText(text=text)}}


# ---------------------------------------------------------------------------
# provider باندل‌شده (گام ۵ برابری با ترتیل) — دادهٔ سمت سرور، بدون
# هیچ فراخوانی زنده. ترجمه‌های فارسیِ خود ترتیل (رواد/تاجی) دادهٔ
# داخل ریپو دارند؛ تفسیرهای فارسی QUL (مختصر/سعدی) فقط وقتی فعال‌اند
# که فایل داده‌شان با importer در data/tafsir/ گذاشته شده باشد —
# نبود فایل یعنی خطای صادقانه، نه ردیف مرده در انتخاب‌گر.
# ---------------------------------------------------------------------------

_BUNDLED_DATA_DIR = Path(__file__).resolve().parent / "data"
_BUNDLED_TRANSLATION_FILES: dict[str, str] = {
    "fa.rowwad": "fa_rowwad.json",
    "fa.taji": "fa_taji.json",
}
_BUNDLED_TAFSIR_EDITIONS: tuple[str, ...] = ("fa.mokhtasar", "fa.saadi")

_bundled_lock = threading.Lock()
_bundled_cache: dict[str, dict[str, str]] = {}


def _bundled_path(edition: str) -> Path | None:
    if edition in _BUNDLED_TRANSLATION_FILES:
        return _BUNDLED_DATA_DIR / _BUNDLED_TRANSLATION_FILES[edition]
    if edition in _BUNDLED_TAFSIR_EDITIONS:
        return _BUNDLED_DATA_DIR / "tafsir" / f"{edition}.json"
    return None


def bundled_available() -> dict[str, list[str]]:
    """editionهای باندل‌شده‌ای که فایل داده‌شان واقعاً روی دیسک هست."""
    available: dict[str, list[str]] = {"translation": [], "tafsir": []}
    for edition, filename in _BUNDLED_TRANSLATION_FILES.items():
        if (_BUNDLED_DATA_DIR / filename).is_file():
            available["translation"].append(edition)
    for edition in _BUNDLED_TAFSIR_EDITIONS:
        path = _BUNDLED_DATA_DIR / "tafsir" / f"{edition}.json"
        if path.is_file():
            available["tafsir"].append(edition)
    return available


def _load_bundled(edition: str) -> dict[str, str]:
    """بارگذاری تنبل + اعتبارسنجی سخت‌گیرانهٔ یک edition باندل‌شده."""
    if edition in _bundled_cache:
        return _bundled_cache[edition]
    with _bundled_lock:
        if edition in _bundled_cache:
            return _bundled_cache[edition]
        path = _bundled_path(edition)
        if path is None:
            raise QuranProviderError(
                f"unknown bundled edition: {edition}", provider_id="bundled"
            )
        if not path.is_file():
            raise QuranProviderError(
                f"bundled edition data is not installed: {edition}",
                provider_id="bundled",
            )
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise QuranProviderError(
                f"bundled edition data is unreadable: {edition}: {exc}",
                provider_id="bundled",
            ) from exc
        if (
            not isinstance(raw, dict)
            or len(raw) < 6000
            or not all(
                isinstance(k, str) and isinstance(v, str) and v.strip()
                for k, v in raw.items()
            )
        ):
            raise QuranProviderError(
                f"bundled edition data is incomplete: {edition}",
                provider_id="bundled",
            )
        _bundled_cache[edition] = raw
        return raw


class BundledEditionsProvider:
    """ترجمه/تفسیر از فایل‌های دادهٔ سمت سرور (قرارداد QuranProvider)."""

    id = "bundled"
    name = "Bundled (server-side data)"
    base_url = ""

    def _requested(
        self,
        text_edition: str | None,
        translation_edition: str | None,
        tafsir_edition: str | None,
        reciter_edition: str | None,
    ) -> list[str]:
        if text_edition or reciter_edition:
            raise QuranProviderError(
                "bundled serves translation/tafsir only", provider_id=self.id
            )
        requested = [e for e in (translation_edition, tafsir_edition) if e]
        if not requested:
            raise QuranProviderError(
                "bundled requires a translation or tafsir edition",
                provider_id=self.id,
            )
        return requested

    async def fetch_surah(
        self,
        number: int,
        *,
        text_edition: str | None = None,
        translation_edition: str | None = None,
        tafsir_edition: str | None = None,
        reciter_edition: str | None = None,
    ) -> dict:
        requested = self._requested(
            text_edition, translation_edition, tafsir_edition, reciter_edition
        )
        merged: dict[int, dict] = {}
        for edition in requested:
            data = _load_bundled(edition)
            for key, text in data.items():
                surah_s, ayah_s = key.split(":", 1)
                if int(surah_s) == number:
                    merged.setdefault(int(ayah_s), {})[edition] = (
                        AyahEditionText(text=text)
                    )
        if not merged:
            raise QuranProviderError(
                f"no bundled ayahs for surah {number}", provider_id=self.id
            )
        return {
            "ayahs": [
                {"number_in_surah": n, "editions": merged[n]}
                for n in sorted(merged)
            ],
            "edition_ids": requested,
        }

    async def fetch_ayah(
        self,
        surah: int,
        ayah: int,
        *,
        text_edition: str | None = None,
        translation_edition: str | None = None,
        tafsir_edition: str | None = None,
        reciter_edition: str | None = None,
    ) -> dict:
        requested = self._requested(
            text_edition, translation_edition, tafsir_edition, reciter_edition
        )
        editions: dict[str, AyahEditionText] = {}
        for edition in requested:
            text = _load_bundled(edition).get(f"{surah}:{ayah}")
            if text is None:
                raise QuranProviderError(
                    f"bundled edition {edition} has no ayah {surah}:{ayah}",
                    provider_id=self.id,
                )
            editions[edition] = AyahEditionText(text=text)
        return {"editions": editions, "edition_ids": requested}


#: مسیریابی به‌ازای edition (گام ۵): این editionها همیشه از provider
#: باندل‌شده می‌آیند، هر providerای که برای نوعشان انتخاب شده باشد —
#: چون منبعشان AlQuran Cloud نیست و آن‌جا وجود ندارند.
EDITION_PROVIDER_OVERRIDES: dict[str, str] = {
    "fa.rowwad": "bundled",
    "fa.taji": "bundled",
    "fa.mokhtasar": "bundled",
    "fa.saadi": "bundled",
}


#: کاتالوگ providerهای شناخته‌شده ولی هنوز متصل‌نشده — فقط فراداده و
#: پیکربندی؛ هیچ‌کدام تا وقتی fetcher نداشته باشند قابل انتخاب نیستند.
#: EveryAyah یک CDN فایل صوتی است و fawazahmed0 دادهٔ ایستای JSON با
#: شکلی غیر از AlQuran Cloud دارد، پس هیچ‌کدام با کلاس سازگار بالا
#: سرو نمی‌شوند. Quran Foundation v4 فقط پیکربندی است (بدون OAuth،
#: بدون محتوای باندل‌شده، بدون کلمه‌به‌کلمه) تا فاز بعد.
PROVIDER_CATALOG: dict[str, dict] = {
    "everyayah": {
        "id": "everyayah",
        "name": "EveryAyah",
        "base_url": "https://everyayah.com/data",
        "types": ["audio"],
        "implemented": False,
        "config_only": False,
    },
    "fawazahmed0": {
        "id": "fawazahmed0",
        "name": "fawazahmed0",
        "base_url": "https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1",
        "types": ["translation"],
        "implemented": False,
        "config_only": False,
    },
    "quran_foundation": {
        "id": "quran_foundation",
        "name": "Quran Foundation v4",
        "base_url": "https://api.quran.com/api/v4",
        "types": ["audio", "text", "translation", "tafsir"],
        "implemented": False,
        "config_only": True,
    },
}


def catalog_entries() -> list[dict]:
    """رونوشت کاتالوگ برای پاسخ API — هرگز دادهٔ حساس ندارد."""
    return [dict(entry) for entry in PROVIDER_CATALOG.values()]


_ID_RE = None


def _custom_id_re():
    global _ID_RE
    if _ID_RE is None:
        import re

        _ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
    return _ID_RE


def _is_http_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    v = value.strip()
    return v.startswith(("https://", "http://"))


def validate_custom_provider_entry(entry: object) -> dict:
    """اعتبارسنجی خالص یک provider سفارشی — خروجی canonical، وگرنه
    TypeError (نوع اشتباه) یا ValueError (مقدار نامعتبر)."""
    if not isinstance(entry, dict):
        raise TypeError("custom provider entry must be an object")
    pid = entry.get("id")
    if not isinstance(pid, str) or not _custom_id_re().match(pid):
        raise ValueError(
            "custom provider id must match [a-z0-9_-]{1,64} and start alphanumerically"
        )
    name = entry.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 120:
        raise ValueError("custom provider name must be a non-empty string (max 120)")
    base_url = entry.get("base_url")
    if not _is_http_url(base_url):
        raise ValueError("custom provider base_url must be an http(s) URL")
    ptype = entry.get("type")
    if ptype not in PROVIDER_CONTENT_TYPES:
        raise ValueError(
            "custom provider type must be one of "
            + "|".join(PROVIDER_CONTENT_TYPES)
        )
    return {
        "id": pid,
        "name": name.strip(),
        "base_url": str(base_url).strip().rstrip("/"),
        "type": ptype,
    }


def clean_custom_providers(value: object) -> list[dict]:
    """فهرست providerهای سفارشی — ورودی نامعتبر → ValueError (نه حذف بی‌صدا)."""
    if not isinstance(value, list):
        raise TypeError("quran.custom_providers must be an array")
    out: list[dict] = []
    seen: set[str] = set()
    for item in value:
        entry = validate_custom_provider_entry(item)
        if entry["id"] in seen:
            raise ValueError(f"quran.custom_providers: duplicate id '{entry['id']}'")
        if entry["id"] in PROVIDERS or entry["id"] in PROVIDER_CATALOG:
            raise ValueError(
                f"quran.custom_providers: id '{entry['id']}' collides with a built-in id"
            )
        seen.add(entry["id"])
        out.append(entry)
    return out


def validate_providers_by_type(value: object) -> dict:
    """اعتبارسنجی خالص انتخاب بر اساس نوع — فقط شکل؛ شناسهٔ ناشناخته در
    زمان resolve به ۵۰۳ صادقانه می‌رسد، نه fallback بی‌صدا."""
    if not isinstance(value, dict):
        raise TypeError("quran.providers_by_type must be an object")
    out: dict[str, str] = {}
    for key, pid in value.items():
        if key not in PROVIDER_CONTENT_TYPES:
            raise ValueError(
                "quran.providers_by_type: unknown content type "
                f"'{key}' (expected {'|'.join(PROVIDER_CONTENT_TYPES)})"
            )
        if not isinstance(pid, str) or not pid.strip():
            raise ValueError(f"quran.providers_by_type[{key}] must be a non-empty string")
        out[key] = pid.strip()
    return out


def validate_custom_provider_keys(value: object) -> dict:
    """نگاشت شناسه → کلید؛ مقدارهای تهی حذف می‌شوند (یعنی بدون کلید)."""
    if not isinstance(value, dict):
        raise TypeError("quran.custom_provider_keys must be an object")
    out: dict[str, str] = {}
    for key, secret in value.items():
        if not isinstance(key, str) or not isinstance(secret, str):
            raise TypeError("quran.custom_provider_keys must map strings to strings")
        if secret.strip():
            out[key] = secret
    return out


def build_provider_map(
    custom_providers: list[dict],
    custom_keys: dict[str, str],
) -> dict[str, QuranProvider]:
    """providerهای قابل سرو: AlQuran Cloud + سفارشی‌های ثبت‌شده."""
    providers: dict[str, QuranProvider] = dict(PROVIDERS)
    for entry in custom_providers:
        providers[entry["id"]] = AlQuranCompatibleProvider(
            id=entry["id"],
            name=entry["name"],
            base_url=entry["base_url"],
            api_key=custom_keys.get(entry["id"]),
        )
    return providers


def resolve_provider(
    provider_id: str,
    custom_providers: list[dict],
    custom_keys: dict[str, str],
) -> QuranProvider:
    """provider یک نوع محتوا — ناشناخته یا کاتالوگیِ متصل‌نشده → ۵۰۳،
    نه fallback بی‌صدا به AlQuran Cloud."""
    providers = build_provider_map(custom_providers, custom_keys)
    try:
        return providers[provider_id]
    except KeyError:
        raise QuranProviderError(
            f"unknown quran provider: {provider_id}", provider_id=provider_id
        ) from None


PROVIDERS: dict[str, QuranProvider] = {
    AlQuranCloudProvider.id: AlQuranCloudProvider(),
    SelfHostedProvider.id: SelfHostedProvider(),
    BundledEditionsProvider.id: BundledEditionsProvider(),
}


def get_provider(provider_id: str) -> QuranProvider:
    """provider ثبت‌شده در کد — نامعتبر → QuranProviderError (سرویس: ۵۰۳/۴۰۰ envelope)."""
    try:
        return PROVIDERS[provider_id]
    except KeyError:
        raise QuranProviderError(
            f"unknown quran provider: {provider_id}", provider_id=provider_id
        ) from None
