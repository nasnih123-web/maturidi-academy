"""ابزار یوتیوب برای ویدیوهای خارجی (لینکی) — بخش ویدیوها.

- تجزیه/اعتبارسنجی URLهای یوتیوب و استخراج شناسهٔ ۱۱کاراکتری ویدیو.
- ساخت URL کانونیک watch، URL امبد (youtube-nocookie) و بندانگشتی.
- واکشی best-effort عنوان از oEmbed یوتیوب — هرگز raise نمی‌کند؛
  خطا یعنی None و فراخواننده خودش تصمیم می‌گیرد (عنوان دستی یا ۴۲۲).

فرم‌های پذیرفته: youtube.com/watch?v=ID و youtu.be/ID و
youtube.com/shorts/ID و youtube.com/live/ID و youtube.com/embed/ID
(با www/m هم). هر چیز دیگری رد است.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

import httpx

_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_WATCH_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com"})
_ID_PATH_SEGMENTS = frozenset({"shorts", "live", "embed"})

OEMBED_URL = "https://www.youtube.com/oembed"


def parse_youtube_video_id(url: str | None) -> str | None:
    """شناسهٔ ویدیو از URL یوتیوب — None یعنی URL معتبر یوتیوب نیست."""
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower()
    candidate: str | None = None
    if host == "youtu.be":
        parts = [p for p in parsed.path.split("/") if p]
        candidate = parts[0] if len(parts) == 1 else None
    elif host in _WATCH_HOSTS:
        if parsed.path == "/watch":
            values = parse_qs(parsed.query).get("v")
            candidate = values[0] if values else None
        else:
            parts = [p for p in parsed.path.split("/") if p]
            if len(parts) == 2 and parts[0] in _ID_PATH_SEGMENTS:
                candidate = parts[1]
    if candidate and _VIDEO_ID_RE.match(candidate):
        return candidate
    return None


def canonical_watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def embed_url(video_id: str) -> str:
    return f"https://www.youtube-nocookie.com/embed/{video_id}"


def thumbnail_url(video_id: str) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=4.0)


async def fetch_youtube_title(watch_url: str) -> str | None:
    """عنوان ویدیو از oEmbed — best-effort: هر خطا/پاسخ بدی None است."""
    try:
        async with _make_client() as client:
            resp = await client.get(
                OEMBED_URL, params={"url": watch_url, "format": "json"}
            )
        if resp.status_code != 200:
            return None
        data = resp.json()
        title = data.get("title") if isinstance(data, dict) else None
        if isinstance(title, str) and title.strip():
            return title.strip()
        return None
    except Exception:  # noqa: BLE001 — واکشی عنوان نباید ساخت آیتم را بشکند
        return None
