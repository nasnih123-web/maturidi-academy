"""سرویس نازک بات تلگرام — python-telegram-bot (فاز ۱۱، ADR-0008).

قوانین سخت:
- توکن فقط از platform_settings خوانده می‌شود (`telegram.bot_token` از نوع
  secret، رمزنگاری‌شده با کلید env — §۳)؛ هرگز هاردکد، هرگز در لاگ/خطا/ممیزی.
- همه‌چیز پشت `telegram.enabled` است؛ بدون توکن یا غیرفعال، فراخوانی‌ها
  صادقانه None/False برمی‌گردانند (graceful degradation).
- هیچ منطق کسب‌وکاری اینجا نیست — فقط ارسال/حذف پیام و ساخت کیبورد.
"""
from __future__ import annotations

import html

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.core.platform_settings import get_setting, get_typed_setting

# برچسب‌های دکمه‌ها از template سیاست می‌آیند؛ این‌ها فقط fallback هستند و
# ساختار LocalizedText دارند (§۱۵.۴ — قابل بازنویسی از CRM).
_DEFAULT_REVIEW_LABELS = {
    "fa": {"approve": "✅ تأیید", "reject": "❌ رد"},
    "ar": {"approve": "✅ اعتماد", "reject": "❌ رفض"},
    "en": {"approve": "✅ Approve", "reject": "❌ Reject"},
}


async def bot_enabled(db: AsyncSession) -> bool:
    """بات فعال است و توکن دارد؟"""
    enabled = await get_typed_setting(db, "telegram.enabled", False)
    if not enabled:
        return False
    token = await get_setting(db, "telegram.bot_token")
    return bool(token and token.strip())


async def _get_token(db: AsyncSession) -> str | None:
    token = await get_setting(db, "telegram.bot_token")
    if token and token.strip():
        return token.strip()
    return None


def _make_bot(token: str):
    from telegram import Bot  # noqa: PLC0415 — import سنگین فقط هنگام استفاده

    return Bot(token=token)


async def default_channel(db: AsyncSession) -> str | None:
    channel = await get_setting(db, "telegram.channel")
    return channel.strip() if channel and channel.strip() else None


async def send_message(
    db: AsyncSession,
    chat_id: str | int,
    text: str,
    *,
    reply_markup=None,
    parse_mode: str | None = None,
    disable_web_page_preview: bool = True,
) -> int | None:
    """ارسال پیام؛ برمی‌گرداند: message_id یا None (غیرفعال/خطا).

    خطاها لاگ می‌شوند ولی توکن هرگز در لاگ نمی‌آید.
    """
    token = await _get_token(db)
    if token is None:
        logger.info("telegram disabled or token missing — message not sent")
        return None
    try:
        bot = _make_bot(token)
        msg = await bot.send_message(
            chat_id=chat_id,
            text=text,
            reply_markup=reply_markup,
            parse_mode=parse_mode,
            disable_web_page_preview=disable_web_page_preview,
        )
        return int(msg.message_id)
    except Exception:  # noqa: BLE001 — خطای شبکه/توکن؛ صادقانه None
        logger.exception("telegram send_message failed")
        return None


async def delete_message(
    db: AsyncSession, chat_id: str | int, message_id: int
) -> bool:
    token = await _get_token(db)
    if token is None:
        return False
    try:
        bot = _make_bot(token)
        await bot.delete_message(chat_id=chat_id, message_id=message_id)
        return True
    except Exception:  # noqa: BLE001
        logger.exception("telegram delete_message failed")
        return False


async def answer_callback_query(
    db: AsyncSession, callback_query_id: str, text: str | None = None
) -> bool:
    """تأیید دریافت callback — چرخش لودینگ دکمه در تلگرام متوقف می‌شود."""
    token = await _get_token(db)
    if token is None:
        return False
    try:
        bot = _make_bot(token)
        await bot.answer_callback_query(
            callback_query_id=callback_query_id, text=text
        )
        return True
    except Exception:  # noqa: BLE001
        logger.exception("telegram answer_callback_query failed")
        return False


def build_review_keyboard(
    approve_nonce: str, reject_nonce: str, locale: str = "fa"
):
    """کیبورد inline تأیید/رد — callback_data کوتاه (سقف ۶۴ بایت تلگرام)."""
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup  # noqa: PLC0415

    labels = _DEFAULT_REVIEW_LABELS.get(locale, _DEFAULT_REVIEW_LABELS["fa"])
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    labels["approve"], callback_data=f"tg:{approve_nonce}"
                ),
                InlineKeyboardButton(
                    labels["reject"], callback_data=f"tg:{reject_nonce}"
                ),
            ]
        ]
    )


async def send_fatwa_review_request(
    db: AsyncSession,
    *,
    chat_id: str | int,
    title: str,
    excerpt: str,
    approve_nonce: str,
    reject_nonce: str,
    template: dict | None = None,
    locale: str = "fa",
) -> int | None:
    """اعلان بازبینی فتوا با دکمه‌های تأیید/رد — برمی‌گرداند: message_id.

    یافتهٔ امنیتی فاز ۱۷ (SEC-17-05): title/excerpt ورودیِ کاربرند و پیام با
    parse_mode=HTML ارسال می‌شود؛ بدون escape، تگ‌های <a>/<b>/… تزریق
    می‌شدند (فیشینگ/به‌هم‌ریختگی قالب). حالا escape می‌شوند.
    """
    title = html.escape(title or "", quote=False)
    excerpt = html.escape(excerpt or "", quote=False)
    tpl = (template or {}).get(locale) or (template or {}).get("fa")
    if tpl:
        text = tpl.format(title=title, excerpt=excerpt)
    else:
        text = (
            f"📝 درخواست بازبینی فتوا\n\n<b>{title}</b>\n\n{excerpt}\n\n"
            "لطفاً تأیید یا رد کنید:"
        )
    keyboard = build_review_keyboard(approve_nonce, reject_nonce, locale)
    return await send_message(
        db, chat_id, text, reply_markup=keyboard, parse_mode="HTML"
    )
