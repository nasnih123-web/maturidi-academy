"""final remediation — Track 2 / Finding 6: گره‌خوردگی بلیط WS به نشست، همهٔ مسیرها.

پوشش:
- مسیر صدور: `POST /api/v1/auth/ws-ticket` فقط با توکنِ نشست‌دار بلیط می‌دهد
  (توکن بدون `sid` → 401؛ پیش‌تر بی‌صدا بلیطِ بدون گره صادر می‌شد).
- مصرف بلیط: بلیطِ گره‌خورده به نشست A با ابطال A می‌میرد، حتی اگر نشست B
  همان کاربر زنده باشد (عدم امکان تطهیر بلیط از مسیر نشست دیگر).
- مصرف بلیط در handshake پس از logout واقعی → رد handshake.
- مصرف با هدر JWT پس از ابطال نشست → رد handshake (مسیر سازگاری عقب‌رو).
- `?token=<JWT>` هیچ‌جا پذیرفته نیست (تست موجود
  `test_ws_jwt_in_query_string_rejected` در test_realtime.py — تکرار نشده).

بخش handshake با سرور uvicorn واقعی (الگوی test_hardening_track_a_ws.py).
"""
from __future__ import annotations

import asyncio
import json
import socket
import threading
import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
import websockets
from sqlalchemy import select

BASE = "/api/v1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _register_login(client, email: str, *, base: str = "") -> dict:
    r = await client.post(
        f"{base}{BASE}/auth/register",
        json={
            "full_name": "کاربر WS نهایی",
            "email": email,
            "password": "Str0ng!Pass1",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    r = await client.post(
        f"{base}{BASE}/auth/login", json={"identifier": email, "password": "Str0ng!Pass1"}
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# مسیر صدور (HTTP)
# ---------------------------------------------------------------------------


async def test_ws_ticket_issuance_requires_bound_session(tc):
    """توکن بدون `sid` → 401؛ توکنِ نشست‌دارِ login → 200 و بلیطِ گره‌خورده."""
    from app.core.security import create_access_token
    from app.models.models import User

    client = tc["client"]
    email = f"wst2-{_uid()}@example.com"
    pair = await _register_login(client, email)

    async with tc["maker"]() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        user_id = str(user.id)

    # مسیر واقعی: توکن login (نشست‌دار) → بلیط صادر می‌شود
    r = await client.post(
        f"{BASE}/auth/ws-ticket",
        headers={"Authorization": f"Bearer {pair['access_token']}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["expires_in"] == 60

    # توکنِ دست‌سازِ بدون sid → دیگر بلیطِ بدون گره صادر نمی‌شود
    naked = create_access_token(user_id)
    r = await client.post(
        f"{BASE}/auth/ws-ticket",
        headers={"Authorization": f"Bearer {naked}"},
    )
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "session_required"


async def test_ticket_bound_to_session_a_dies_with_a_while_b_lives(tc):
    """بلیطِ نشست A پس از ابطال A مرده است، حتی با زنده‌بودن نشست B؛
    بلیطِ نشست B همچنان معتبر است (عدم تطهیر میان‌نشستی)."""
    from app.models.models import Session, User
    from app.modules.auth.service import issue_ws_ticket, redeem_ws_ticket

    client = tc["client"]
    email = f"wst2ab-{_uid()}@example.com"
    await _register_login(client, email)

    async with tc["maker"]() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        # دو نشست واقعی برای یک کاربر
        now = datetime.now(UTC)
        sess_a = Session(user_id=user.id, device_info="dev-A", last_active_at=now)
        sess_b = Session(user_id=user.id, device_info="dev-B", last_active_at=now)
        db.add_all([sess_a, sess_b])
        await db.commit()
        await db.refresh(sess_a)
        await db.refresh(sess_b)
        ticket_a, _ = await issue_ws_ticket(db, user, sess_a.id)
        ticket_b, _ = await issue_ws_ticket(db, user, sess_b.id)

        # ابطال فقط نشست A
        sess_a.revoked = True
        await db.commit()

        assert await redeem_ws_ticket(db, ticket_a) is None
        got = await redeem_ws_ticket(db, ticket_b)
        assert got is not None and got.id == user.id


async def test_ticket_reuse_rejected_for_bound_ticket(tc):
    """بلیطِ گره‌خورده هم یک‌بارمصرف است: مصرف دوم → None."""
    from app.models.models import Session, User
    from app.modules.auth.service import issue_ws_ticket, redeem_ws_ticket

    client = tc["client"]
    email = f"wst2ru-{_uid()}@example.com"
    await _register_login(client, email)

    async with tc["maker"]() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        session = (
            await db.execute(select(Session).where(Session.user_id == user.id))
        ).scalars().first()
        ticket, _ = await issue_ws_ticket(db, user, session.id)
        assert (await redeem_ws_ticket(db, ticket)) is not None
        assert await redeem_ws_ticket(db, ticket) is None


# ---------------------------------------------------------------------------
# مصرف در handshake (سرور uvicorn واقعی)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def ws_env_final(tc):
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
    }

    server.should_exit = True
    thread.join(timeout=15)
    manager.clear()
    if hasattr(app.state, "session_factory"):
        delattr(app.state, "session_factory")


async def _http_ticket(http: str, access_token: str) -> str:
    import httpx

    async with httpx.AsyncClient(trust_env=False, timeout=30.0) as client:
        r = await client.post(
            f"{http}/api/v1/auth/ws-ticket",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    assert r.status_code == 200, r.text
    return r.json()["ticket"]


async def test_ws_handshake_ticket_dead_after_logout(ws_env_final):
    """بلیطِ صادرشده، پس از logout واقعی (ابطال نشست) در handshake رد می‌شود."""
    import httpx

    http = ws_env_final["http"]
    async with httpx.AsyncClient(trust_env=False, timeout=30.0) as client:
        pair = await _register_login(client, f"wst2lo-{_uid()}@example.com", base=http)
        access = pair["access_token"]
        ticket = await _http_ticket(http, access)

        r = await client.post(
            f"{http}/api/v1/auth/logout",
            json={"refresh_token": pair["refresh_token"]},
            headers={"Authorization": f"Bearer {access}"},
        )
        assert r.status_code == 200, r.text

    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(f"{ws_env_final['ws_url']}?ticket={ticket}"):
            pass  # pragma: no cover


async def test_ws_handshake_ticket_live_session_ok_then_single_use(ws_env_final):
    """بلیطِ نشستِ زنده در handshake پذیرفته می‌شود، ولی فقط یک‌بار."""
    import httpx

    http = ws_env_final["http"]
    async with httpx.AsyncClient(trust_env=False, timeout=30.0) as client:
        pair = await _register_login(client, f"wst2ok-{_uid()}@example.com", base=http)
        ticket = await _http_ticket(http, pair["access_token"])

    url = f"{ws_env_final['ws_url']}?ticket={ticket}&channels=test.final"
    async with websockets.connect(url) as ws:
        ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert ack["type"] == "subscribed"

    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(url):
            pass  # pragma: no cover


async def test_ws_handshake_header_jwt_revoked_session_rejected(ws_env_final, tc):
    """مسیر سازگاری عقب‌رو (هدر Authorization): JWTِ نشستِ باطل‌شده در
    handshake رد می‌شود — parity با get_current_user در HTTP."""
    import httpx

    from app.models.models import Session, User

    http = ws_env_final["http"]
    async with httpx.AsyncClient(trust_env=False, timeout=30.0) as client:
        email = f"wst2hdr-{_uid()}@example.com"
        pair = await _register_login(client, email, base=http)
        access = pair["access_token"]

    # ابطال مستقیم نشستِ همین توکن
    async with tc["maker"]() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        session = (
            await db.execute(select(Session).where(Session.user_id == user.id))
        ).scalars().first()
        assert session is not None
        session.revoked = True
        await db.commit()

    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(
            f"{ws_env_final['ws_url']}?channels=test.final",
            additional_headers={"Authorization": f"Bearer {access}"},
        ):
            pass  # pragma: no cover
