"""تست‌های فاز ۱۲ حفاظ — رگرسیون و اصلاح‌های امنیتیِ بازِ فاز ۱۱.

پوشش:
- سقف بدنهٔ سراسری در برابر ۳۲MB حفاظ (P1-2): میدل‌ویر فقط چهار مسیر
  آپلود صوت حفاظ را از گیت Content-Length معاف می‌کند؛ بقیهٔ مسیرها
  همان ۴۱۳ عمومی را می‌گیرند.
- پاک‌سازی بلیط‌های WS منقضی/مصرف‌شده (P1-6): `purge_expired_ws_tickets`.
- ابطال نشست وسط جریان زنده (P1-1): `authenticate_ws_with_session`
  نشستِ گره‌خورده را برمی‌گرداند؛ `session_still_valid` با SELECT
  تازه؛ `serve_stream` هر ۵ دقیقه بررسی می‌کند و نشستِ باطل‌شده را
  با ۴۴۰۱ می‌بندد، بدون ذخیره.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.core.realtime import (
    _HandshakeRejected,
    authenticate_ws_with_session,
    session_still_valid,
)
from app.models.models import Session, User, WsTicket
from app.modules.quran import hifz_service
from app.modules.quran.hifz_stream import LiveSession

BASE = "/api/v1"
HIFZ = f"{BASE}/quran/hifz"


# ---------------------------------------------------------------------------
# P1-2 — میدل‌ویر سقف بدنه: معافیتِ مسیرهای آپلود صوت حفاظ
# ---------------------------------------------------------------------------


def test_body_size_limit_exempts_hifz_audio_uploads():
    """چهار مسیر آپلود صوت حفاظ با Content-Length بزرگ‌تر از سقف سراسری،
    از گیت میدل‌ویر رد می‌شوند (سقف ۳۲MB خودِ endpoint اعمال می‌شود)؛
    بقیهٔ مسیرها همان ۴۱۳ عمومی را می‌گیرند."""
    from starlette.applications import Starlette
    from starlette.responses import PlainTextResponse
    from starlette.routing import Route
    from starlette.testclient import TestClient

    from app.core.middleware import BodySizeLimitMiddleware

    async def _ok(request):
        return PlainTextResponse("ok")

    routes = [
        Route("/api/v1/quran/hifz/attempts/{attempt_id}/grade", _ok, methods=["POST"]),
        Route("/api/v1/quran/hifz/attempts/{attempt_id}/grade-word", _ok, methods=["POST"]),
        Route(
            "/api/v1/quran/hifz/tests/{test_id}/questions/{question_id}/answer",
            _ok,
            methods=["POST"],
        ),
        Route("/api/v1/quran/hifz/voice-search", _ok, methods=["POST"]),
        Route("/api/v1/quran/hifz/attempts", _ok, methods=["POST"]),
    ]
    app = Starlette(routes=routes)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=16)
    client = TestClient(app, raise_server_exceptions=False)

    big = b"x" * 17
    attempt = str(uuid.uuid4())
    assert client.post(f"/api/v1/quran/hifz/attempts/{attempt}/grade", content=big).status_code == 200
    assert client.post(f"/api/v1/quran/hifz/attempts/{attempt}/grade-word", content=big).status_code == 200
    assert (
        client.post(
            f"/api/v1/quran/hifz/tests/{attempt}/questions/{attempt}/answer",
            content=big,
        ).status_code
        == 200
    )
    assert client.post("/api/v1/quran/hifz/voice-search", content=big).status_code == 200
    # مسیر غیرصوتیِ حفاظ، معاف نیست.
    other = client.post("/api/v1/quran/hifz/attempts", content=big)
    assert other.status_code == 413
    assert other.json()["error"]["code"] == "request_body_too_large"


# ---------------------------------------------------------------------------
# کمک‌ها: کاربر + نشستِ واقعی در دیتابیس تست
# ---------------------------------------------------------------------------


async def _register_and_login(tc, db_session, email: str) -> tuple[str, uuid.UUID]:
    """ثبت‌نام + ورود با کلاینت تست؛ برمی‌گرداند: (توکن، شناسهٔ کاربر)."""
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")
    client = tc["client"]
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر فاز ۱۲",
            "email": email,
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    rate_limiter.reset("login:127.0.0.1")
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": email, "password": "TestPass123"},
    )
    assert r.status_code == 200, r.text
    user = (
        await db_session.execute(select(User).where(User.email == email))
    ).scalars().first()
    assert user is not None
    return r.json()["access_token"], user.id


async def _latest_session_id(db_session, user_id: uuid.UUID) -> uuid.UUID:
    row = (
        await db_session.execute(
            select(Session).where(Session.user_id == user_id).order_by(Session.created_at.desc())
        )
    ).scalars().first()
    assert row is not None
    return row.id


# ---------------------------------------------------------------------------
# P1-6 — پاک‌سازی بلیط‌های WS
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_purge_expired_ws_tickets(db_session):
    """منقضی (مصرف‌شده یا نه) + مصرف‌شدهٔ قدیمی پاک می‌شوند؛ معتبر و
    مصرف‌شدهٔ تازه می‌مانند."""
    from app.modules.auth.service import purge_expired_ws_tickets

    user_id = uuid.uuid4()
    now = datetime.now(UTC)

    def _ticket(expires, used):
        row = WsTicket(
            user_id=user_id,
            session_id=None,
            ticket_hash=f"hash-{uuid.uuid4()}",
            expires_at=expires,
            used_at=used,
        )
        db_session.add(row)
        return row

    expired_unused = _ticket(now - timedelta(seconds=1), None)
    expired_used = _ticket(now - timedelta(seconds=1), now - timedelta(hours=2))
    used_old = _ticket(now + timedelta(hours=1), now - timedelta(hours=2))
    used_recent = _ticket(now + timedelta(hours=1), now - timedelta(minutes=10))
    valid = _ticket(now + timedelta(minutes=1), None)
    await db_session.commit()

    n = await purge_expired_ws_tickets(db_session)
    # شمارش سراسری است و دیتابیس تست session-scoped و مشترک است:
    # تست‌های قبلی هم بلیط منقضی به‌جا می‌گذارند (در اجرای کامل ۸
    # ردیف پاک شد، نه ۳). پس شمارش دقیق فقط روی ردیف‌های خودِ این
    # تست انجام می‌شود؛ n سراسری دست‌کم ۳ است.
    assert n >= 3

    remaining = set(
        (
            await db_session.execute(
                select(WsTicket.id).where(WsTicket.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    assert remaining == {used_recent.id, valid.id}
    assert expired_unused.id not in remaining
    assert expired_used.id not in remaining
    assert used_old.id not in remaining


# ---------------------------------------------------------------------------
# P1-1 — نشستِ گره‌خورده + اعتبارسنجی دوره‌ای
# ---------------------------------------------------------------------------


class _FakeWebSocket:
    """سوکت ساختگی برای handshake (فقط هدر/کوئری/بستن)."""

    def __init__(self, *, headers=None, query_params=None):
        self.headers = headers or {}
        self.query_params = query_params or {}
        self.close_code = None
        self.close_reason = None

    async def close(self, code=1000, reason=""):
        self.close_code = code
        self.close_reason = reason


@pytest.mark.asyncio
async def test_authenticate_ws_with_session_jwt_returns_sid(tc, db_session):
    """مسیر JWT: کاربر + sid توکن برگردانده می‌شود."""
    token, user_id = await _register_and_login(tc, db_session, "p12-jwt@example.com")
    sid = await _latest_session_id(db_session, user_id)
    ws = _FakeWebSocket(headers={"authorization": f"Bearer {token}"})
    user, session_id = await authenticate_ws_with_session(ws, db_session)
    assert user.id == user_id
    assert session_id == sid


@pytest.mark.asyncio
async def test_authenticate_ws_with_session_ticket_returns_bound_session(tc, db_session):
    """مسیر بلیط: کاربر + نشستِ صادرکنندهٔ بلیط برگردانده می‌شود."""
    token, user_id = await _register_and_login(tc, db_session, "p12-ticket@example.com")
    client = tc["client"]
    r = await client.post(
        f"{BASE}/auth/ws-ticket", headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 200, r.text
    ticket = r.json()["ticket"]
    ws = _FakeWebSocket(query_params={"ticket": ticket})
    user, session_id = await authenticate_ws_with_session(ws, db_session)
    assert user.id == user_id
    assert session_id == await _latest_session_id(db_session, user_id)


@pytest.mark.asyncio
async def test_authenticate_ws_rejects_invalid_ticket(tc, db_session):
    """بلیط نامعتبر → رد handshake با ۴۴۰۱."""
    ws = _FakeWebSocket(query_params={"ticket": "no-such-ticket"})
    with pytest.raises(_HandshakeRejected):
        await authenticate_ws_with_session(ws, db_session)
    assert ws.close_code == 4401


@pytest.mark.asyncio
async def test_session_still_valid(tc, db_session):
    """نشستِ سالم True؛ پس از ابطال False؛ نشستِ ناپیدا False."""
    _token, user_id = await _register_and_login(tc, db_session, "p12-valid@example.com")
    sid = await _latest_session_id(db_session, user_id)
    assert await session_still_valid(db_session, sid) is True
    assert await session_still_valid(db_session, uuid.uuid4()) is False
    row = await db_session.get(Session, sid)
    assert row is not None
    row.revoked = True
    await db_session.commit()
    assert await session_still_valid(db_session, sid) is False


# ---------------------------------------------------------------------------
# P1-1 — serve_stream: بستن ۴۴۰۱ وقتی نشست وسط جریان باطل می‌شود
# ---------------------------------------------------------------------------


class _FakeMapping:
    def segments_for(self, surah, ayah):
        return None


class _FakeStreamWebSocket:
    """سوکت ساختگیِ حلقهٔ جریان (پیام‌ها + ثبت رویدادها/بستن)."""

    def __init__(self, messages):
        self._messages = list(messages)
        self.sent = []
        self.close_code = None
        self.close_reason = None

    async def receive(self):
        if not self._messages:
            from starlette.websockets import WebSocketDisconnect

            raise WebSocketDisconnect()
        await asyncio.sleep(0.01)
        return self._messages.pop(0)

    async def send_json(self, event):
        self.sent.append(event)

    async def close(self, code=1000, reason=""):
        self.close_code = code
        self.close_reason = reason


class _FakeRecognizer:
    def __init__(self):
        self.calls = 0

    def feed(self, pcm16: bytes):
        self.calls += 1
        return []

    def flush(self):
        return []


async def _live_session(monkeypatch, db, start_ayah=1):
    async def fake_store(db_, attempt, surah, ayah, aligned, extra):
        return [SimpleNamespace(status=w.status) for w in aligned]

    async def _fake_ayah_words(db_, s, a):
        return ["قُلْ"] if a == 1 else ["x"]

    monkeypatch.setattr(hifz_service, "_ayah_words", _fake_ayah_words)
    monkeypatch.setattr(hifz_service, "_store_grade", fake_store)
    session = LiveSession(
        db=db,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=112,
        start_ayah=start_ayah,
        green=0.8,
        amber=0.5,
        sender=None,
        mapping=_FakeMapping(),
    )
    session._ayah = start_ayah
    session._words = ["قُلْ"]
    session._index = 0
    session._touch(start_ayah)
    return session


@pytest.mark.asyncio
async def test_serve_stream_revoked_session_closes_4401(tc, db_session, monkeypatch):
    """نشستِ باطل‌شده وسط جریان → رویداد hifz_session_revoked + بستن
    ۴۴۰۱؛ قاب هرگز به بازشناس نمی‌رسد (ذخیره‌ای هم نمی‌شود)."""
    from app.modules.quran import hifz_router
    from app.modules.quran.hifz_router import serve_stream

    _token, user_id = await _register_and_login(tc, db_session, "p12-revoke@example.com")
    sid = await _latest_session_id(db_session, user_id)
    row = await db_session.get(Session, sid)
    assert row is not None
    row.revoked = True
    await db_session.commit()

    # زمانِ حلقه را جلو نبر: patch کردنِ سراسریِ time.monotonic ساعت
    # asyncio را منجمد می‌کند (loop.time همان monotonic است) و
    # sleep/wait_for هرگز بیدار نمی‌شوند. به‌جایش بازهٔ اعتبارسنجی را
    # صفر می‌کنیم تا بررسی در نخستین تکرارِ حلقه — پیش از خوراندنِ
    # هر قاب — انجام شود.
    monkeypatch.setattr(hifz_router, "LIVE_SESSION_REVALIDATION_SECONDS", 0)
    session = await _live_session(monkeypatch, db_session)
    recognizer = _FakeRecognizer()
    ws = _FakeStreamWebSocket([{"bytes": b"\x00\x00" * 100}])
    queue: asyncio.Queue = asyncio.Queue()
    await serve_stream(ws, session, recognizer, queue, auth_session_id=sid)

    assert ws.close_code == 4401
    assert ws.close_reason == "session revoked"
    assert any(
        e.get("code") == "hifz_session_revoked" for e in ws.sent
    ), ws.sent
    assert recognizer.calls == 0


@pytest.mark.asyncio
async def test_serve_stream_valid_session_keeps_flowing(tc, db_session, monkeypatch):
    """نشستِ سالم: اعتبارسنجی دوره‌ای رد نمی‌کند و قاب به بازشناس می‌رسد."""
    from app.modules.quran import hifz_router
    from app.modules.quran.hifz_router import serve_stream

    _token, user_id = await _register_and_login(tc, db_session, "p12-ok@example.com")
    sid = await _latest_session_id(db_session, user_id)

    # بازهٔ اعتبارسنجی صفر: بررسی در نخستین تکرار حلقه انجام می‌شود
    # (نشست سالم است → جریان ادامه می‌یابد). patch کردنِ سراسریِ
    # time.monotonic ممنوع است — ساعت asyncio را منجمد می‌کند و
    # sleep/wait_for هرگز بیدار نمی‌شوند.
    monkeypatch.setattr(hifz_router, "LIVE_SESSION_REVALIDATION_SECONDS", 0)
    session = await _live_session(monkeypatch, db_session)
    recognizer = _FakeRecognizer()
    ws = _FakeStreamWebSocket([{"bytes": b"\x00\x00" * 100}])
    queue: asyncio.Queue = asyncio.Queue()
    await serve_stream(ws, session, recognizer, queue, auth_session_id=sid)

    assert recognizer.calls == 1
    assert ws.close_code == 1000
