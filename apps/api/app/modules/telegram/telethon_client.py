"""لایهٔ انتزاع Telethon (MTProto) — فاز ۱۱ (ADR-0008).

چرا انتزاع؟ تست‌ها باید با «MTProto جعلی» (fake client درون‌حافظه‌ای) بدون
هیچ شبکه‌ای اجرا شوند؛ در مسیر عملیاتی همیشه Telethon واقعی به کار می‌رود
(§۱۶: هیچ mock در مسیر عملیاتی).

- `set_client_factory` فقط برای تست است.
- خطاهای Telethon به استثناهای دامنه‌ای همین ماژول ترجمه می‌شوند تا
  سرویس‌ها به `telethon` وابسته نباشند.
"""
from __future__ import annotations

from typing import Any, Protocol


class SessionPasswordNeeded(Exception):
    """ورود نیازمند رمز دومرحله‌ای است."""


class FloodWait(Exception):
    """محدودیت نرخ تلگرام — `retry_after` ثانیه صبر کن."""

    def __init__(self, retry_after: int):
        super().__init__(f"flood wait: retry after {retry_after}s")
        self.retry_after = retry_after


class NotAuthorized(Exception):
    """session نامعتبر/منقضی است."""


class MtprotoMessage:
    """نمای حداقلی پیام برای درون‌ریزی — واقعی و جعلی همین شکل را دارند."""

    def __init__(
        self,
        *,
        message_id: int,
        text: str | None,
        file_name: str | None,
        mime_type: str | None,
        file_size: int | None,
        media_bytes: bytes | None,
    ):
        self.id = message_id
        self.text = text
        self.file_name = file_name
        self.mime_type = mime_type
        self.file_size = file_size
        self.media_bytes = media_bytes

    @property
    def has_media(self) -> bool:
        return self.media_bytes is not None


class MtprotoClient(Protocol):
    """قرارداد حداقلی موردنیاز سرویس‌های اتصال و درون‌ریزی."""

    async def connect(self) -> None: ...
    async def disconnect(self) -> None: ...
    async def is_user_authorized(self) -> bool: ...
    async def send_code_request(self, phone: str) -> Any: ...
    async def sign_in_with_code(
        self, phone: str, code: str, phone_code_hash: str
    ) -> None: ...
    async def sign_in_with_password(self, password: str) -> None: ...
    def save_session(self) -> str: ...
    def iter_messages(self, channel: str, limit: int) -> Any: ...
    async def download_media_bytes(self, message: MtprotoMessage) -> bytes: ...


class _RealTelethonClient:
    """آداپتور Telethon واقعی — lazy import تا بدون telethon هم import شود."""

    def __init__(self, session_str: str | None, api_id: int, api_hash: str):
        from telethon.sessions import StringSession  # noqa: PLC0415

        from telethon import TelegramClient  # noqa: PLC0415

        self._client = TelegramClient(
            StringSession(session_str or ""), api_id, api_hash
        )

    async def connect(self) -> None:
        await self._client.connect()

    async def disconnect(self) -> None:
        await self._client.disconnect()

    async def is_user_authorized(self) -> bool:
        return await self._client.is_user_authorized()

    async def send_code_request(self, phone: str) -> Any:
        return await self._client.send_code_request(phone)

    async def sign_in_with_code(
        self, phone: str, code: str, phone_code_hash: str
    ) -> None:
        from telethon.errors import SessionPasswordNeededError  # noqa: PLC0415

        try:
            await self._client.sign_in(
                phone, code, phone_code_hash=phone_code_hash
            )
        except SessionPasswordNeededError as exc:
            raise SessionPasswordNeeded() from exc

    async def sign_in_with_password(self, password: str) -> None:
        await self._client.sign_in(password=password)

    def save_session(self) -> str:
        from telethon.sessions import StringSession  # noqa: PLC0415

        return StringSession.save(self._client.session)

    def iter_messages(self, channel: str, limit: int) -> Any:
        return self._iter(channel, limit)

    async def _iter(self, channel: str, limit: int):
        from telethon.errors import FloodWaitError  # noqa: PLC0415

        entity = await self._client.get_entity(channel)
        try:
            async for msg in self._client.iter_messages(entity, limit=limit):
                yield _from_telethon_message(msg)
        except FloodWaitError as exc:
            raise FloodWait(exc.seconds) from exc

    async def download_media_bytes(self, message: MtprotoMessage) -> bytes:
        # آداپتور واقعی پیام اصلی telethon را نگه می‌دارد
        raw = getattr(message, "_raw", None)
        if raw is None:
            raise ValueError("real adapter requires the raw telethon message")
        data = await self._client.download_media(raw, file=bytes)
        if not data:
            raise ValueError("empty media download")
        return bytes(data)


def _from_telethon_message(msg: Any) -> MtprotoMessage:
    file_name = None
    mime_type = None
    file_size = None
    media_bytes = None
    file = getattr(msg, "file", None)
    if file is not None:
        file_name = getattr(file, "name", None)
        mime_type = getattr(file, "mime_type", None)
        file_size = getattr(file, "size", None)
        media_bytes = b""  # علامت «مدیا دارد»؛ دانلود جدا انجام می‌شود
    text = getattr(msg, "message", None) or getattr(msg, "text", None)
    wrapped = MtprotoMessage(
        message_id=int(msg.id),
        text=text,
        file_name=file_name,
        mime_type=mime_type,
        file_size=file_size,
        media_bytes=media_bytes,
    )
    wrapped._raw = msg  # noqa: SLF001 — فقط آداپتور واقعی
    return wrapped


def _default_factory(
    session_str: str | None, api_id: int, api_hash: str
) -> MtprotoClient:
    return _RealTelethonClient(session_str, api_id, api_hash)


_factory = _default_factory


def set_client_factory(factory) -> None:
    """تزریق factory جعلی — فقط برای تست."""
    global _factory
    _factory = factory


def reset_client_factory() -> None:
    global _factory
    _factory = _default_factory


def create_client(
    session_str: str | None, api_id: int, api_hash: str
) -> MtprotoClient:
    return _factory(session_str, api_id, api_hash)
