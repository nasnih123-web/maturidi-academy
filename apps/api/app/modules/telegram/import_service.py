"""درون‌ریزی آرشیو کانال تلگرام — فاز ۱۱ (ADR-0008).

- جاب ARQ روی صف `telegram` (قرارداد §۵)؛ `POST /api/v1/telegram/import`
  فقط جاب را در صف می‌گذارد.
- flood-wait: گرفتن FloodWait → sleep نمایی با سقف ۳۰۰ ثانیه، حداکثر ۳ تلاش
  برای هر دورِ خواندن؛ پیام‌های دیده‌شده با id دوباره پردازش نمی‌شوند.
- هر فایل از فیلتر امنیتی فاز ۹ (§۷: پسوند + magic-byte + سقف حجم) عبور
  می‌کند — همان `validate_upload_content` کتابخانه.
- ثبت به‌صورت `library_items` با `source_type="telegram_import"`،
  `workflow_status=in_review` و `source_ref={origin:"telegram", channel,
  message_id}`؛ بازبینی نهایی انسانی در ویرایشگر رسانهٔ فاز ۹.
- **هرگز auto-publish یا auto-repost نمی‌شود** — چک صریح
  `source_ref.origin == "telegram"` در distribute_service.
- idempotent: پیامِ قبلاً واردشده دوباره ثبت نمی‌شود.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import workflow
from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.logging import logger
from app.models.models import LibraryItem, User

from . import telethon_client as mtproto
from .connect_service import _telethon_creds, load_session

MAX_FLOOD_WAIT_S = 300
FLOOD_MAX_RETRIES = 3

# پسوند → kind کتابخانه (فاز ۹). عکس‌ها kind ندارند → صریحاً skip می‌شوند.
_EXT_KIND: dict[str, str] = {
    ".mp4": "video", ".webm": "video", ".mov": "video", ".mkv": "video",
    ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".m4a": "audio",
    ".flac": "audio",
    ".pdf": "pdf",
    ".mm": "mindmap", ".json": "mindmap", ".xmind": "mindmap",
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _detect_kind(file_name: str | None, mime_type: str | None) -> str | None:
    if file_name and "." in file_name:
        ext = "." + file_name.rsplit(".", 1)[-1].lower()
        if ext in _EXT_KIND:
            return _EXT_KIND[ext]
    if mime_type:
        mt = mime_type.lower()
        if mt.startswith("video/"):
            return "video"
        if mt.startswith("audio/"):
            return "audio"
        if mt == "application/pdf":
            return "pdf"
    return None


def _title_for(msg: mtproto.MtprotoMessage) -> str:
    if msg.text:
        first = msg.text.strip().splitlines()[0].strip()
        if first:
            return first[:200]
    if msg.file_name:
        return msg.file_name[:200]
    return f"Telegram message {msg.id}"


async def _already_imported(
    db: AsyncSession, channel: str, message_id: int
) -> bool:
    """آیا این پیام قبلاً وارد شده؟ — کوئری روی source_ref (سازگار SQLite/PG)."""
    stmt = (
        select(func.count())
        .select_from(LibraryItem)
        .where(LibraryItem.source_type == "telegram_import")
        .where(LibraryItem.source_ref["channel"].as_string() == channel)
        .where(
            cast(LibraryItem.source_ref["message_id"], Integer) == message_id
        )
    )
    return (await db.execute(stmt)).scalar_one() > 0


async def _iter_messages_with_backoff(client, channel: str, limit: int):
    """خواندن تاریخچه با backoff مناسب flood-wait."""
    retries = 0
    while True:
        try:
            async for msg in client.iter_messages(channel, limit):
                yield msg
            return
        except mtproto.FloodWait as exc:
            retries += 1
            wait = min(exc.retry_after + 1, MAX_FLOOD_WAIT_S)
            logger.warning(
                "telegram flood-wait: sleeping %ss (attempt %s/%s)",
                wait, retries, FLOOD_MAX_RETRIES,
            )
            if retries > FLOOD_MAX_RETRIES:
                raise APIError(
                    503, "telegram_flood_wait",
                    "محدودیت نرخ تلگرام؛ بعداً دوباره تلاش کنید",
                )
            await asyncio.sleep(wait)


async def run_import(
    db: AsyncSession,
    *,
    channel: str,
    limit: int,
    actor_id: uuid.UUID,
    client: mtproto.MtprotoClient | None = None,
) -> dict:
    """اجرای درون‌ریزی — هم از جاب ARQ، هم مستقیم در تست (client جعلی)."""
    from app.modules.library import service as library_service

    actor = await db.get(User, actor_id)
    if actor is None:
        raise APIError(404, "actor_not_found", "کاربر اجراکننده یافت نشد")

    owns_client = client is None
    if owns_client:
        api_id, api_hash = await _telethon_creds(db)
        session_str = await load_session(db)
        if not session_str:
            raise APIError(
                422, "telegram_not_connected",
                "حساب تلگرام متصل نیست؛ اول از /connect وارد شوید",
            )
        client = mtproto.create_client(session_str, api_id, api_hash)
        await client.connect()
        if not await client.is_user_authorized():
            raise APIError(401, "telegram_unauthorized", "session تلگرام نامعتبر است")

    stats = {
        "imported": 0, "duplicate": 0, "no_media": 0,
        "unsupported_kind": 0, "rejected_security": 0,
        "download_failed": 0, "failed": 0,
    }
    errors: list[dict] = []
    seen: set[int] = set()
    try:
        async for msg in _iter_messages_with_backoff(client, channel, limit):
            if msg.id in seen:
                continue
            seen.add(msg.id)
            outcome = await _process_message(
                db, library_service, client, channel, msg, actor
            )
            stats[outcome] = stats.get(outcome, 0) + 1
            if outcome == "failed":
                errors.append({"message_id": msg.id})
    finally:
        if owns_client:
            try:
                await client.disconnect()
            except Exception:  # noqa: BLE001
                pass

    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="telegram.import.completed",
        entity_type="telegram_import",
        entity_id=channel,
        new_values={"channel": channel, "limit": limit, **stats},
    )
    await db.commit()
    return {"channel": channel, **stats, "errors": errors}


async def _process_message(
    db: AsyncSession,
    library_service,
    client: mtproto.MtprotoClient,
    channel: str,
    msg: mtproto.MtprotoMessage,
    actor: User,
) -> str:
    """پردازش یک پیام؛ برمی‌گرداند: کلید شمارندهٔ stats."""
    if await _already_imported(db, channel, msg.id):
        return "duplicate"
    if not msg.has_media:
        return "no_media"
    kind = _detect_kind(msg.file_name, msg.mime_type)
    if kind is None:
        return "unsupported_kind"
    try:
        content = await client.download_media_bytes(msg)
    except Exception:  # noqa: BLE001
        logger.exception("telegram media download failed for %s", msg.id)
        return "download_failed"
    if not content:
        return "download_failed"

    filename = msg.file_name or f"telegram_{msg.id}"
    if "." not in filename:
        # پسوند حدسی از kind تا اعتبارسنج §۷ کار کند
        guess = next((e for e, k in _EXT_KIND.items() if k == kind), "")
        filename = f"{filename}{guess}"
    try:
        library_service.validate_upload_content(kind, filename, content)
    except APIError:
        return "rejected_security"

    title = _title_for(msg)
    try:
        await library_service.create_item(
            db,
            {
                "kind": kind,
                "title": {"fa": title, "ar": title, "en": title},
                "description": None,
                "visibility": "registered",
            },
            content,
            filename,
            actor=actor,
            initial_status=workflow.IN_REVIEW,
            source_type="telegram_import",
            source_ref={
                "origin": "telegram",
                "channel": channel,
                "message_id": msg.id,
            },
        )
    except APIError:
        logger.exception("telegram import: create_item failed for %s", msg.id)
        await db.rollback()
        return "failed"
    except Exception:  # noqa: BLE001
        logger.exception("telegram import: unexpected failure for %s", msg.id)
        await db.rollback()
        return "failed"
    return "imported"
