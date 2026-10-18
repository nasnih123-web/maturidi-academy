"""دروازهٔ بلادرنگ WebSocket — فاز ۲ (`/ws/events`).

پروتکل:
- احراز هویت در handshake: `?token=<JWT>` یا هدر `Authorization: Bearer <JWT>`
  (با همان `decode_access_token` فاز ۱)؛ توکن نامعتبر/غایب → رد handshake با
  HTTP 403 (در Starlette بستنِ سوکتِ acceptنشده به 403 ترجمه می‌شود).
- اشتراک اولیه با `?channels=a.b,c.*`؛ بعداً با پیام‌های JSON:
  `{"type":"subscribe","channel":"..."}` / `{"type":"unsubscribe","channel":"..."}`.
- تطبیق کانال: تطبیق دقیق، یا wildcard به‌شکل `prefix.*`، یا `*` برای همه.
- کانال‌های `admin.*` نیازمند مجوز `realtime.admin` هستند — با همان join
  `user_roles → role_permissions → permissions` مثل `require_permission` فاز ۱.
- heartbeat: سرور هر `ws_heartbeat_interval` ثانیه `{"type":"ping"}` می‌فرستد؛
  کلاینت باید `{"type":"pong"}` برگرداند؛ بعد از `ws_heartbeat_timeout` ثانیه
  بی‌پاسخی، اتصال با کد 4400 بسته می‌شود.
- اتصال مجدد: `?last_event_id=<uuid>` + `?channels=...` → رویدادهای ازدست‌رفته
  (created_at بزرگ‌تر از رویداد مرجع) از **دیتابیس** به‌ترتیب بازپخش می‌شوند.
- `broadcast_event(event)` نقطهٔ ورود fan-out است: dispatcher از طریق bus
  رویداد را می‌رساند و listener دروازه آن را به کلاینت‌های مشترک می‌فرستد.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

from fastapi import Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import ensure_aware, get_db
from app.core.errors import APIError
from app.core.logging import logger
from app.core.security import decode_access_token
from app.models.models import DomainEvent, Permission, RolePermission, User, UserRole

ADMIN_CHANNEL_PREFIX = "admin."
ADMIN_CHANNEL_PERMISSION = "realtime.admin"

_CLOSE_UNAUTHORIZED = 4401
_CLOSE_HEARTBEAT_TIMEOUT = 4400


class _HandshakeRejected(Exception):
    """احراز هویت ناموفق — اتصال قبلاً بسته شده است."""


def channel_matches(subscription: str, event_type: str) -> bool:
    """تطبیق اشتراک با نوع رویداد: دقیق، `prefix.*` یا `*`."""
    if subscription == "*" or subscription == event_type:
        return True
    if subscription.endswith(".*"):
        return event_type.startswith(subscription[:-1])
    return False


@dataclass
class _Client:
    websocket: WebSocket
    user_id: uuid.UUID
    permissions: set[str] = field(default_factory=set)
    subscriptions: set[str] = field(default_factory=set)
    last_pong: float = field(default_factory=time.monotonic)


class ConnectionManager:
    """ثبت کلاینت‌ها و fan-out رویدادها بر اساس اشتراک."""

    def __init__(self) -> None:
        self._clients: dict[int, _Client] = {}
        self._lock = asyncio.Lock()

    def can_subscribe(self, client: _Client, channel: str) -> bool:
        if channel.startswith(ADMIN_CHANNEL_PREFIX):
            return ADMIN_CHANNEL_PERMISSION in client.permissions
        return True

    async def register(self, websocket: WebSocket, user_id: uuid.UUID, permissions: set[str]) -> _Client:
        client = _Client(websocket=websocket, user_id=user_id, permissions=permissions)
        async with self._lock:
            self._clients[id(websocket)] = client
        return client

    async def unregister(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._clients.pop(id(websocket), None)

    async def subscribe(self, websocket: WebSocket, channel: str) -> bool:
        """False یعنی مجوز کافی نیست."""
        async with self._lock:
            client = self._clients.get(id(websocket))
            if client is None:
                return False
            if not self.can_subscribe(client, channel):
                return False
            client.subscriptions.add(channel)
            return True

    async def unsubscribe(self, websocket: WebSocket, channel: str) -> None:
        async with self._lock:
            client = self._clients.get(id(websocket))
            if client is not None:
                client.subscriptions.discard(channel)

    def clear(self) -> None:
        """فقط برای تست — همهٔ اتصالات ثبت‌شده را فراموش می‌کند."""
        self._clients.clear()

    async def broadcast_event(self, event: dict) -> None:
        """ارسال رویداد به همهٔ کلاینت‌هایی که اشتراک منطبق دارند."""
        event_type = event.get("event_type", "")
        async with self._lock:
            targets = [
                c for c in self._clients.values()
                if any(channel_matches(s, event_type) for s in c.subscriptions)
            ]
        if not targets:
            return
        message = {"type": "event", **event}
        dead: list[_Client] = []
        for client in targets:
            try:
                await client.websocket.send_json(message)
            except Exception:
                dead.append(client)
        for client in dead:
            await self.unregister(client.websocket)


manager = ConnectionManager()


async def broadcast_event(event: dict) -> None:
    """نقطهٔ ورود dispatcher — پخش رویداد سریالایزشده به کلاینت‌های WebSocket.

    dispatcher رویداد را روی bus منتشر می‌کند؛ listener دروازه (در lifespan)
    آن را تحویل می‌گیرد و این تابع fan-out را انجام می‌دهد.
    """
    await manager.broadcast_event(event)


async def _authenticate(websocket: WebSocket, db: AsyncSession) -> User:
    token = websocket.query_params.get("token")
    if not token:
        auth = websocket.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
    if not token:
        await websocket.close(code=_CLOSE_UNAUTHORIZED, reason="missing token")
        raise _HandshakeRejected()
    try:
        payload = decode_access_token(token)
        user = await db.get(User, uuid.UUID(payload["sub"]))
    except (APIError, KeyError, ValueError, AttributeError):
        await websocket.close(code=_CLOSE_UNAUTHORIZED, reason="invalid token")
        raise _HandshakeRejected()
    if not user or not user.is_active:
        await websocket.close(code=_CLOSE_UNAUTHORIZED, reason="inactive user")
        raise _HandshakeRejected()
    return user


async def _load_permissions(db: AsyncSession, user_id: uuid.UUID) -> set[str]:
    """همان join مجوزدهی require_permission — بدون enum."""
    stmt = (
        select(Permission.key)
        .select_from(UserRole)
        .join(RolePermission, RolePermission.role_id == UserRole.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(UserRole.user_id == user_id)
    )
    return set((await db.execute(stmt)).scalars().all())


async def _missed_events(db: AsyncSession, last_event_id: str) -> list[DomainEvent]:
    """رویدادهای بعد از رویداد مرجع، مرتب از قدیم به جدید (از دیتابیس)."""
    try:
        ref_id = uuid.UUID(last_event_id)
    except (ValueError, AttributeError):
        return []
    ref = await db.get(DomainEvent, ref_id)
    if ref is None:
        return []
    ref_ts = ensure_aware(ref.created_at)
    stmt = (
        select(DomainEvent)
        .where(DomainEvent.created_at >= ref_ts, DomainEvent.event_id != ref.event_id)
        .order_by(DomainEvent.created_at.asc())
    )
    return list((await db.execute(stmt)).scalars().all())


def _client_message(event: DomainEvent) -> dict:
    ts = ensure_aware(event.created_at)
    return {
        "type": "event",
        "event_id": str(event.event_id),
        "event_type": event.event_type,
        "aggregate_type": event.aggregate_type,
        "aggregate_id": event.aggregate_id,
        "payload": event.payload,
        "schema_version": event.schema_version,
        "created_at": ts.isoformat(),
    }


def _parse_channels(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [c.strip() for c in raw.split(",") if c.strip()]


async def _handle_client_message(websocket: WebSocket, client: _Client, msg: dict) -> None:
    msg_type = msg.get("type")
    if msg_type == "pong":
        client.last_pong = time.monotonic()
        return
    if msg_type == "subscribe":
        channel = str(msg.get("channel", "")).strip()
        if not channel:
            await websocket.send_json({"type": "error", "code": "bad_channel", "message": "channel خالی است"})
            return
        if await manager.subscribe(websocket, channel):
            await websocket.send_json({"type": "subscribed", "channel": channel})
        else:
            await websocket.send_json({"type": "error", "code": "forbidden", "message": "مجوز اشتراک این کانال را ندارید"})
        return
    if msg_type == "unsubscribe":
        await manager.unsubscribe(websocket, str(msg.get("channel", "")).strip())
        await websocket.send_json({"type": "unsubscribed", "channel": msg.get("channel")})
        return
    await websocket.send_json({"type": "error", "code": "unknown_message", "message": "پیام ناشناخته"})


async def websocket_endpoint(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db),
) -> None:
    """نقطهٔ اتصال `/ws/events` — احراز هویت، اشتراک، heartbeat، بازپخش."""
    settings = get_settings()
    try:
        user = await _authenticate(websocket, db)
    except _HandshakeRejected:
        return
    permissions = await _load_permissions(db, user.id)
    await websocket.accept()
    client = await manager.register(websocket, user.id, permissions)

    # اشتراک‌های اولیه از query param
    for channel in _parse_channels(websocket.query_params.get("channels")):
        if await manager.subscribe(websocket, channel):
            await websocket.send_json({"type": "subscribed", "channel": channel})
        else:
            await websocket.send_json({"type": "error", "code": "forbidden",
                                       "message": f"مجوز اشتراک کانال {channel} را ندارید"})

    # بازپخش رویدادهای ازدست‌رفته — فقط برای کانال‌های مشترک‌شده در handshake
    last_event_id = websocket.query_params.get("last_event_id")
    if last_event_id and client.subscriptions:
        for event in await _missed_events(db, last_event_id):
            if any(channel_matches(s, event.event_type) for s in client.subscriptions):
                try:
                    await websocket.send_json(_client_message(event))
                except Exception:
                    break

    interval = settings.ws_heartbeat_interval
    timeout = settings.ws_heartbeat_timeout
    try:
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_json(), timeout=interval)
            except asyncio.TimeoutError:
                try:
                    await websocket.send_json({"type": "ping", "ts": time.time()})
                except Exception:
                    break
                if time.monotonic() - client.last_pong > timeout:
                    logger.info("websocket heartbeat timeout user=%s", user.id)
                    try:
                        await websocket.close(code=_CLOSE_HEARTBEAT_TIMEOUT, reason="heartbeat timeout")
                    except Exception:
                        pass
                    break
                continue
            except (WebSocketDisconnect, RuntimeError):
                break
            except ValueError:
                # پیام JSON نامعتبر — اتصال را نمی‌بندیم، فقط خطا می‌فرستیم
                try:
                    await websocket.send_json({"type": "error", "code": "bad_json",
                                               "message": "پیام باید JSON معتبر باشد"})
                except Exception:
                    break
                continue
            if isinstance(msg, dict):
                await _handle_client_message(websocket, client, msg)
    finally:
        await manager.unregister(websocket)
