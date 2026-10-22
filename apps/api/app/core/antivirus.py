"""اسکن ویروس آپلودها با ClamAV — C-01 (ADR-0028، قرارداد §۷).

پروتکل INSTREAM روی TCP به clamd: فرمان `zINSTREAM` و بعد قطعه‌ها با
پیشوند طول ۴بایتی big-endian؛ پاسخ clamd یا `stream: OK` است یا
`stream: <signature> FOUND`.

سیاست — FAIL-CLOSED در همهٔ محیط‌ها:
- فایل آلوده → رد (422 file_infected) + ممیزی در لایهٔ سرویس.
- اسکنر در دسترس نیست/خطای پروتکل → رد (503 antivirus_unavailable).
  هرگز «رد شدن بی‌صدا» نداریم.
- تنها استثنا: پرچم صریح `CLAMAV_ALLOW_INSECURE_DEV_BYPASS=true` و
  فقط وقتی app_env=dev — با لاگ CRITICAL در هر فراخوانی. در
  production این پرچم هیچ اثری ندارد.
"""
from __future__ import annotations

import asyncio
import logging
import struct
from dataclasses import dataclass

from app.core.config import get_settings
from app.core.errors import APIError

logger = logging.getLogger(__name__)

_CHUNK = 8192


class AntivirusUnavailable(Exception):
    """اسکنر پاسخ نداد — در سیاست fail-closed یعنی رد آپلود."""


@dataclass(frozen=True)
class ScanResult:
    clean: bool
    signature: str | None = None


async def scan_bytes(
    data: bytes,
    *,
    host: str | None = None,
    port: int | None = None,
    timeout: float | None = None,
) -> ScanResult:
    """اسکن واقعی با پروتکل INSTREAM — خطای انتقال → AntivirusUnavailable."""
    s = get_settings()
    host = host or s.clamav_host
    port = port or s.clamav_port
    timeout = timeout if timeout is not None else s.clamav_timeout_seconds
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
    except (OSError, TimeoutError) as exc:
        raise AntivirusUnavailable(f"connect {host}:{port}: {exc}") from exc
    try:
        writer.write(b"zINSTREAM\x00")
        for i in range(0, len(data), _CHUNK):
            part = data[i : i + _CHUNK]
            writer.write(struct.pack(">I", len(part)) + part)
        writer.write(struct.pack(">I", 0))
        await writer.drain()
        try:
            raw = await asyncio.wait_for(reader.readline(), timeout=timeout)
        except TimeoutError as exc:
            raise AntivirusUnavailable("clamd response timeout") from exc
    except AntivirusUnavailable:
        raise
    except (OSError, ConnectionError) as exc:
        raise AntivirusUnavailable(f"instream: {exc}") from exc
    finally:
        writer.close()
    response = raw.decode("utf-8", errors="replace").strip()
    if response.endswith("OK"):
        return ScanResult(clean=True)
    if "FOUND" in response:
        # قالب: "stream: Eicar-Test-Signature FOUND"
        signature = response.split(":", 1)[-1].replace("FOUND", "").strip()
        return ScanResult(clean=False, signature=signature or "unknown")
    raise AntivirusUnavailable(f"unexpected clamd response: {response[:120]!r}")


def bypass_active() -> bool:
    """بای‌پس ناامن فقط dev + پرچم صریح — در production هرگز."""
    s = get_settings()
    return bool(s.clamav_allow_insecure_dev_bypass and s.app_env == "dev")


async def scan_upload_or_reject(data: bytes, *, filename: str | None) -> ScanResult:
    """گیت آپلود — خروجی تمیز برمی‌گرداند یا APIError پرتاب می‌کند.

    آلوده → 422 file_infected؛ اسکنر غایب → 503 antivirus_unavailable
    (fail-closed). فراخواننده مسئول ممیزی رد شدن است (db/actor آن‌جاست).
    """
    if bypass_active():
        logger.critical(
            "CLAMAV BYPASS ACTIVE (dev-only insecure flag): upload %r "
            "accepted WITHOUT antivirus scan",
            filename,
        )
        return ScanResult(clean=True)
    try:
        result = await scan_bytes(data)
    except AntivirusUnavailable as exc:
        logger.error("antivirus unavailable — rejecting upload %r: %s", filename, exc)
        raise APIError(
            503,
            "antivirus_unavailable",
            "اسکن ویروس در دسترس نیست؛ آپلود به‌صورت fail-closed رد شد. "
            "سرویس ClamAV را بررسی کنید.",
        ) from exc
    if not result.clean:
        logger.warning(
            "infected upload rejected: %r signature=%s", filename, result.signature
        )
        raise APIError(
            422,
            "file_infected",
            "فایل به ویروس آلوده است و رد شد",
            {"signature": result.signature},
        )
    return result
