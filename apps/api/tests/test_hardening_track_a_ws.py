"""تست‌های WebSocket — Track A (hardening/audit-pass-1).

- بلیط یک‌بارمصرف: صدور، تک‌مصرفی، انقضا، نیاز به scope کامل
- حریم خصوصی کانال: `user.*` رویداد کاربر دیگر را لو نمی‌دهد
- کرسر بازپخش (created_at, event_id): timestamp یکسان → بدون جاافتادن/تکرار
- پیام resume زنده (که کلاینت CRM می‌فرستاد ولی سرور نادیده می‌گرفت)
- توکن محدود 2fa_setup در handshake رد می‌شود

سرور uvicorn واقعی در thread جدا (الگوی test_realtime.py).
"""
from __future__ import annotations

import asyncio
import json
import socket
import threading
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
import websockets
from sqlalchemy import update


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(maker, email: str):
    from app.core.security import hash_password
    from app.models.models import User

    async with maker() as db:
        user = User(
            full_name="کاربر تست WS",
            email=email,
            password_hash=hash_password("x" * 12),
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


def _token(user) -> str:
    from app.core.security import create_access_token

    return create_access_token(str(user.id))


async def _bound_token(maker, user) -> str:
    """توکن دسترسیِ گره‌خورده به نشست — شکل واقعی production.

    پس از سخت‌گیری final remediation (Track 2)، مسیر `POST /ws-ticket`
    توکنِ بدون `sid` را با 401 رد می‌کند؛ پس تست‌های بلیط باید با توکنِ
    نشست‌دار کار کنند (نشست واقعی در DB، مثل login).
    """
    from app.core.security import create_access_token
    from app.models.models import Session

    async with maker() as db:
        session = Session(user_id=user.id, device_info="ws-test", ip="127.0.0.1")
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return create_access_token(str(user.id), extra={"sid": str(session.id)})


async def _emit(
    maker,
    event_type: str,
    aggregate_type: str = "test",
    aggregate_id: str | None = None,
    payload: dict | None = None,
):
    from app.core.events import emit_event

    async with maker() as db:
        ev = await emit_event(
            db,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id or str(uuid.uuid4()),
            event_type=event_type,
            payload=payload or {},
        )
        await db.commit()
        return str(ev.event_id)


async def _wait_processed(maker, event_id: str, timeout: float = 20.0) -> None:
    from app.models.models import DomainEvent

    deadline = asyncio.get_running_loop().time() + timeout
    eid = uuid.UUID(event_id)
    while True:
        async with maker() as db:
            ev = await db.get(DomainEvent, eid)
            if ev is not None and ev.processed_at is not None:
                return
        if asyncio.get_running_loop().time() > deadline:
            raise TimeoutError(f"event {event_id} was not processed in time")
        await asyncio.sleep(0.1)


async def _recv_event(ws, timeout: float = 15.0) -> dict:
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        if msg.get("type") == "event":
            return msg


async def _recv_none(ws, timeout: float = 2.5) -> None:
    """هیچ رویدادی نباید برسد — اثبات عدم نشت."""
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            return
        try:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=remaining))
        except TimeoutError:
            return  # در پنجرهٔ انتظار هیچ پیامی نیامد — موفق
        assert msg.get("type") != "event", f"leaked event: {msg}"


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def ws_env(tc):
    import uvicorn

    from app.main import app

    app.state.session_factory = tc["maker"]

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    import httpx

    async with httpx.AsyncClient(trust_env=False) as client:
        for _ in range(200):
            try:
                resp = await client.get(f"http://127.0.0.1:{port}/health")
                if resp.status_code == 200:
                    break
            except Exception:
                pass
            await asyncio.sleep(0.05)
        else:
            raise RuntimeError("test websocket server did not start")

    from app.core.realtime import manager

    yield {
        "ws_url": f"ws://127.0.0.1:{port}/ws/events",
        "http": f"http://127.0.0.1:{port}",
        "maker": tc["maker"],
    }

    server.should_exit = True
    thread.join(timeout=15)
    manager.clear()
    if hasattr(app.state, "session_factory"):
        delattr(app.state, "session_factory")


async def _ticket(http: str, maker, user) -> str:
    """گرفتن بلیط با توکنِ نشست‌دار (شکل واقعی production)."""
    import httpx

    access_token = await _bound_token(maker, user)
    async with httpx.AsyncClient(trust_env=False, timeout=30.0) as client:
        r = await client.post(
            f"{http}/api/v1/auth/ws-ticket",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    assert r.status_code == 200, r.text
    return r.json()["ticket"]


# ---------------------------------------------------------------------------
# بلیط
# ---------------------------------------------------------------------------


async def test_ws_ticket_single_use(ws_env):
    """بلیط فقط یک‌بار مصرف می‌شود — مصرف دوم رد می‌شود."""
    maker = ws_env["maker"]
    user = await _make_user(maker, f"ws-t1-{_uid()}@test.local")
    t = await _ticket(ws_env["http"], maker, user)

    url = f"{ws_env['ws_url']}?ticket={t}&channels=test.t1"
    async with websockets.connect(url) as ws:
        ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert ack["type"] == "subscribed"

    # استفادهٔ مجدد از همان بلیط → handshake رد می‌شود
    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(url):
            pass  # pragma: no cover


async def test_ws_expired_ticket_rejected(ws_env):
    """بلیط منقضی رد می‌شود."""
    from app.core.security import hash_token
    from app.models.models import WsTicket

    maker = ws_env["maker"]
    user = await _make_user(maker, f"ws-t2-{_uid()}@test.local")
    t = await _ticket(ws_env["http"], maker, user)

    async with maker() as db:
        await db.execute(
            update(WsTicket)
            .where(WsTicket.ticket_hash == hash_token(t))
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await db.commit()

    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(f"{ws_env['ws_url']}?ticket={t}"):
            pass  # pragma: no cover


async def test_ws_ticket_requires_full_scope(ws_env):
    """توکن محدود 2fa_setup نمی‌تواند بلیط بگیرد (403)."""
    import httpx

    from app.core.security import SCOPE_2FA_SETUP, create_access_token

    maker = ws_env["maker"]
    user = await _make_user(maker, f"ws-t3-{_uid()}@test.local")
    limited = create_access_token(str(user.id), scope=SCOPE_2FA_SETUP)
    async with httpx.AsyncClient(trust_env=False, timeout=30.0) as client:
        r = await client.post(
            f"{ws_env['http']}/api/v1/auth/ws-ticket",
            headers={"Authorization": f"Bearer {limited}"},
        )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "requires_2fa"


async def test_ws_limited_jwt_token_rejected(ws_env):
    """توکن محدود 2fa_setup در handshake رد می‌شود (از هدر Authorization —
    remediation-pass-2 Track 1: `?token=` در query string دیگر پذیرفته نیست)."""
    from app.core.security import SCOPE_2FA_SETUP, create_access_token

    maker = ws_env["maker"]
    user = await _make_user(maker, f"ws-t4-{_uid()}@test.local")
    limited = create_access_token(str(user.id), scope=SCOPE_2FA_SETUP)
    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(
            f"{ws_env['ws_url']}?channels=test.t4",
            additional_headers={"Authorization": f"Bearer {limited}"},
        ):
            pass  # pragma: no cover


# ---------------------------------------------------------------------------
# حریم خصوصی کانال
# ---------------------------------------------------------------------------


async def test_ws_user_channel_scoped_to_owner(ws_env):
    """اشتراک user.* رویداد کاربر دیگر را تحویل نمی‌دهد (عدم نشت ایمیل)."""
    maker = ws_env["maker"]
    alice = await _make_user(maker, f"ws-a-{_uid()}@test.local")
    bob = await _make_user(maker, f"ws-b-{_uid()}@test.local")

    t = await _ticket(ws_env["http"], maker, alice)
    url = f"{ws_env['ws_url']}?ticket={t}&channels=user.*"
    async with websockets.connect(url) as ws:
        ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert ack["type"] == "subscribed"

        # رویداد باب — آلیس نباید ببیند
        eid_bob = await _emit(
            maker,
            "user.registered",
            aggregate_type="user",
            aggregate_id=str(bob.id),
            payload={"email": bob.email},
        )
        await _wait_processed(maker, eid_bob)
        await _recv_none(ws)

        # رویداد خودِ آلیس — باید برسد
        eid_alice = await _emit(
            maker,
            "user.profile_updated",
            aggregate_type="user",
            aggregate_id=str(alice.id),
            payload={"email": alice.email},
        )
        await _wait_processed(maker, eid_alice)
        msg = await _recv_event(ws)
        assert msg["event_id"] == eid_alice


# ---------------------------------------------------------------------------
# کرسر بازپخش و resume
# ---------------------------------------------------------------------------


async def test_ws_replay_cursor_same_timestamp_no_gap_no_dup(ws_env):
    """دو رویداد با created_at یکسان: بازپخش دقیقاً هر دو، به‌ترتیب، بدون تکرار."""
    from app.models.models import DomainEvent

    maker = ws_env["maker"]
    user = await _make_user(maker, f"ws-r-{_uid()}@test.local")

    eid0 = await _emit(maker, "test.cursor", payload={"seq": 0})
    eid1 = await _emit(maker, "test.cursor", payload={"seq": 1})
    eid2 = await _emit(maker, "test.cursor", payload={"seq": 2})
    # هر سه را هم‌زمان کن — بدترین حالت برای کرسر تک‌مؤلفه‌ای
    fixed = datetime.now(UTC)
    async with maker() as db:
        await db.execute(update(DomainEvent).values(created_at=fixed))
        await db.commit()
    for eid in (eid0, eid1, eid2):
        await _wait_processed(maker, eid)

    t = await _ticket(ws_env["http"], maker, user)
    # کرسر = کوچک‌ترین عنصر در ترتیب (created_at, event_id): چون هر سه
    # created_at یکسان دارند، ترتیب فقط با event_id (hex) تعیین می‌شود —
    # UUIDها تصادفی‌اند، پس کرسر را قطعی انتخاب می‌کنیم، نه eid0 را فرضی.
    eids = [eid0, eid1, eid2]
    cursor = min(eids)
    expected = sorted(e for e in eids if e != cursor)
    url = f"{ws_env['ws_url']}?ticket={t}&channels=test.cursor&last_event_id={cursor}"
    async with websockets.connect(url) as ws:
        await asyncio.wait_for(ws.recv(), timeout=10)  # subscribed ack
        m1 = await _recv_event(ws)
        m2 = await _recv_event(ws)
        # هر دو رویدادِ بعد از کرسر، دقیقاً یک‌بار، به‌ترتیب کرسر دومؤلفه‌ای
        assert [m1["event_id"], m2["event_id"]] == expected
        # سومی نباید باشد (تکراری/جاافتاده)
        await _recv_none(ws, timeout=2.0)


async def test_ws_resume_message_replays_missed(ws_env):
    """پیام زندهٔ resume (که کلاینت می‌فرستد) واقعاً بازپخش می‌کند."""
    maker = ws_env["maker"]
    user = await _make_user(maker, f"ws-rs-{_uid()}@test.local")

    eid0 = await _emit(maker, "test.resume", payload={"seq": 0})
    eid1 = await _emit(maker, "test.resume", payload={"seq": 1})
    await _wait_processed(maker, eid0)
    await _wait_processed(maker, eid1)

    t = await _ticket(ws_env["http"], maker, user)
    url = f"{ws_env['ws_url']}?ticket={t}&channels=test.resume"
    async with websockets.connect(url) as ws:
        await asyncio.wait_for(ws.recv(), timeout=10)  # subscribed ack
        await ws.send(json.dumps({"type": "resume", "last_event_id": eid0}))
        # ack + بازپخش دقیقاً eid1
        got_ack = False
        got_event = None
        deadline = asyncio.get_running_loop().time() + 10
        while asyncio.get_running_loop().time() < deadline and not (
            got_ack and got_event
        ):
            msg = json.loads(
                await asyncio.wait_for(
                    ws.recv(),
                    timeout=max(0.1, deadline - asyncio.get_running_loop().time()),
                )
            )
            if msg.get("type") == "resumed":
                got_ack = True
            elif msg.get("type") == "event":
                got_event = msg
        assert got_ack, "no resumed ack"
        assert got_event is not None and got_event["event_id"] == eid1
