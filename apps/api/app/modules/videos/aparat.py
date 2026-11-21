"""ابزار آپارات برای ویدیوهای خارجی (لینکی) — بخش ویدیوها.

- تجزیه/اعتبارسنجی URLهای آپارات و استخراج هش ویدیو.
- ساخت URL کانونیک watch و URL امبد آپارات.
- واکشی best-effort فراداده (عنوان + کاور): منبع اصلی API جیسون عمومی
  آپارات (etc/api/video/videohash/HASH) است؛ اگر عنوانی نداد، سقوط به
  تگ‌های og صفحهٔ تماشا. هرگز raise نمی‌کند؛ خطا یعنی None و
  فراخواننده خودش تصمیم می‌گیرد (عنوان دستی یا ۴۲۲). مقدار ساختگی
  هرگز ساخته نمی‌شود.

فرم‌های پذیرفته: aparat.com/v/HASH و www.aparat.com/v/HASH و فرم امبد
آپارات aparat.com/video/video/embed/videohash/HASH/vt/frame
(http یا https). هش: حروف/ارقام انگلیسی، ۴ تا ۱۲ نویسه (مثل cpuac8h).
هر چیز دیگری رد است.
"""
from __future__ import annotations

import html as html_lib
import re
from urllib.parse import urlparse

import httpx

_HASH_RE = re.compile(r"^[A-Za-z0-9]{4,12}$")
_WATCH_HOSTS = frozenset({"aparat.com", "www.aparat.com"})
_EMBED_PREFIX = ("video", "video", "embed", "videohash")

# هدر مرورگرمانند — آپارات به کلاینت‌های بدون UA پاسخ کامل نمی‌دهد.
_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

# API جیسون عمومی آپارات برای فرادادهٔ ویدیو — صفحهٔ تماشا برای
# کلاینت‌های سروری فقط پوستهٔ JS است و تگ og ندارد، برای همین منبع
# اصلی فراداده همین API است و og فقط مسیر جایگزین است.
_API_VIDEO_URL = "https://www.aparat.com/etc/api/video/videohash/{video_hash}"

# سقف دانلود کاور og — اعتبارسنجی نهایی حجم با _validate_cover کتابخانه
# است؛ این سقف فقط جلوی کشیدن فایل حجیم از راه دور را می‌گیرد.
_COVER_DOWNLOAD_CAP = 6 * 1024 * 1024


def parse_aparat_video_hash(url: str | None) -> str | None:
    """هش ویدیو از URL آپارات — None یعنی URL معتبر آپارات نیست."""
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower()
    if host not in _WATCH_HOSTS:
        return None
    parts = tuple(p for p in parsed.path.split("/") if p)
    candidate: str | None = None
    if len(parts) == 2 and parts[0] == "v":
        candidate = parts[1]
    elif (
        len(parts) == 7
        and parts[:4] == _EMBED_PREFIX
        and parts[5:] == ("vt", "frame")
    ):
        candidate = parts[4]
    if candidate and _HASH_RE.match(candidate):
        return candidate
    return None


def canonical_watch_url(video_hash: str) -> str:
    return f"https://www.aparat.com/v/{video_hash}"


def embed_url(video_hash: str) -> str:
    return (
        "https://www.aparat.com/video/video/embed/videohash/"
        f"{video_hash}/vt/frame"
    )


def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=4.0,
        follow_redirects=True,
        headers={"User-Agent": _USER_AGENT},
    )


_META_TAG_RE = re.compile(r"<meta\b[^>]*>", re.IGNORECASE | re.DOTALL)
_ATTR_RE = re.compile(r'([\w:-]+)\s*=\s*["\'](.*?)["\']', re.DOTALL)


def _og_content(page: str, prop: str) -> str | None:
    """مقدار content یک تگ متای og — تگ‌به‌تگ خوانده می‌شود تا ترتیب
    صفت‌ها (property قبل یا بعد از content) بی‌اثر باشد و مقدار از
    مرز تگ رد نشود؛ entityهای HTML باز می‌شوند."""
    for tag in _META_TAG_RE.findall(page):
        attrs = {
            m.group(1).lower(): m.group(2) for m in _ATTR_RE.finditer(tag)
        }
        if attrs.get("property") != prop and attrs.get("name") != prop:
            continue
        value = (attrs.get("content") or "").strip()
        if value:
            return html_lib.unescape(value)
    return None


async def _meta_from_api(
    video_hash: str,
) -> tuple[str | None, str | None]:
    """(عنوان، کاور) از API جیسون آپارات — کاور big_poster است و اگر
    نبود/معتبر نبود small_poster؛ کاور فقط وقتی پذیرفته است که URL
    https باشد. هر خطا/پاسخ بد (None, None) است."""
    try:
        async with _make_client() as client:
            resp = await client.get(
                _API_VIDEO_URL.format(video_hash=video_hash)
            )
        if resp.status_code != 200:
            return None, None
        payload = resp.json()
        video = payload.get("video") if isinstance(payload, dict) else None
        if not isinstance(video, dict):
            return None, None
        raw_title = video.get("title")
        title = raw_title.strip() if isinstance(raw_title, str) else ""
        cover: str | None = None
        for key in ("big_poster", "small_poster"):
            candidate = video.get(key)
            if isinstance(candidate, str):
                candidate = candidate.strip()
                if candidate.startswith("https://"):
                    cover = candidate
                    break
        return title or None, cover
    except Exception:  # noqa: BLE001 — واکشی فراداده نباید ساخت آیتم را بشکند
        return None, None


async def _meta_from_og(
    watch_url: str,
) -> tuple[str | None, str | None]:
    """(عنوان، کاور) از og صفحهٔ تماشا — مسیر جایگزین وقتی API عنوانی
    نداد؛ هر خطا/پاسخ بد (None, None) است."""
    try:
        async with _make_client() as client:
            resp = await client.get(watch_url)
        if resp.status_code != 200:
            return None, None
        page = resp.text
        return _og_content(page, "og:title"), _og_content(page, "og:image")
    except Exception:  # noqa: BLE001 — واکشی فراداده نباید ساخت آیتم را بشکند
        return None, None


async def fetch_aparat_meta(watch_url: str) -> tuple[str | None, str | None]:
    """(عنوان، کاور) ویدیوی آپارات — اول API جیسون؛ اگر عنوانی نداد،
    og صفحهٔ تماشا. best-effort: شکست کامل (None, None) است و هیچ
    مقداری ساخته نمی‌شود."""
    video_hash = parse_aparat_video_hash(watch_url)
    if video_hash is not None:
        title, cover = await _meta_from_api(video_hash)
        if title:
            return title, cover
    return await _meta_from_og(watch_url)


async def fetch_cover_bytes(cover_url: str) -> bytes | None:
    """دانلود best-effort بایت‌های کاور og:image (فقط https، با سقف
    حجم) — هر خطا None است؛ اسکن و اعتبارسنجی magic با فراخواننده است
    (همان مسیر کاور آپلودی کتابخانه)."""
    try:
        parsed = urlparse(cover_url)
        if parsed.scheme != "https" or not parsed.hostname:
            return None
        async with _make_client() as client:
            resp = await client.get(cover_url)
        if resp.status_code != 200:
            return None
        data = resp.content
        if not data or len(data) > _COVER_DOWNLOAD_CAP:
            return None
        return data
    except Exception:  # noqa: BLE001 — کاور نباید ساخت آیتم را بشکند
        return None
