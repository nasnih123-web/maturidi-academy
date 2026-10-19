"""remediation-pass-2 Track 1 — بلیط WS: گره‌خوردن به نشست + حذف ?token=.

- بلیطِ گره‌خورده به نشستِ باطل‌شده → redeem ناموفق (None)
- بلیط بدون نشست (سازگاری عقب‌رو) → redeem موفق
- مصرف دوباره → None (تک‌مصرفی، نگهبان رگرسیون)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

BASE = "/api/v1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _register_login(client, email):
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر WS",
            "email": email,
            "password": "Str0ng!Pass1",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "Str0ng!Pass1"}
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_ticket_bound_to_revoked_session_fails(tc):
    """بلیطِ صادرشده برای نشست، پس از logout (ابطال نشست) دیگر redeem نمی‌شود."""
    from app.models.models import Session, User
    from app.modules.auth.service import issue_ws_ticket, redeem_ws_ticket

    client = tc["client"]
    email = f"wsb-{_uid()}@example.com"
    pair = await _register_login(client, email)

    async with tc["maker"]() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        session = (
            await db.execute(select(Session).where(Session.user_id == user.id))
        ).scalars().first()
        assert session is not None
        ticket, _ = await issue_ws_ticket(db, user, session.id)

    # logout → نشست باطل می‌شود
    r = await client.post(
        f"{BASE}/auth/logout", json={"refresh_token": pair["refresh_token"]},
        headers={"Authorization": f"Bearer {pair['access_token']}"},
    )
    assert r.status_code == 200, r.text

    async with tc["maker"]() as db:
        assert await redeem_ws_ticket(db, ticket) is None


async def test_ticket_without_session_still_works(tc):
    """سازگاری عقب‌رو: بلیطِ بدون session_id (توکن‌های قدیمیِ بدون sid) معتبر است."""
    from app.models.models import User
    from app.modules.auth.service import issue_ws_ticket, redeem_ws_ticket

    client = tc["client"]
    email = f"wsn-{_uid()}@example.com"
    await _register_login(client, email)

    async with tc["maker"]() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        ticket, ttl = await issue_ws_ticket(db, user, None)
        assert ttl == 60
        got = await redeem_ws_ticket(db, ticket)
        assert got is not None and got.id == user.id
        # مصرف دوباره → None
        assert await redeem_ws_ticket(db, ticket) is None


async def test_ticket_for_live_session_redeems(tc):
    """بلیطِ گره‌خورده به نشستِ زنده → redeem موفق و یک‌بارمصرف."""
    from app.models.models import Session, User
    from app.modules.auth.service import issue_ws_ticket, redeem_ws_ticket

    client = tc["client"]
    email = f"wsl-{_uid()}@example.com"
    await _register_login(client, email)

    async with tc["maker"]() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        session = (
            await db.execute(select(Session).where(Session.user_id == user.id))
        ).scalars().first()
        ticket, _ = await issue_ws_ticket(db, user, session.id)
        got = await redeem_ws_ticket(db, ticket)
        assert got is not None and got.id == user.id


async def test_expired_ticket_rejected(tc):
    from app.core.security import hash_token
    from app.models.models import User, WsTicket
    from app.modules.auth.service import issue_ws_ticket, redeem_ws_ticket

    client = tc["client"]
    email = f"wse-{_uid()}@example.com"
    await _register_login(client, email)

    async with tc["maker"]() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        ticket, _ = await issue_ws_ticket(db, user, None)
        await db.execute(
            update(WsTicket)
            .where(WsTicket.ticket_hash == hash_token(ticket))
            .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        )
        await db.commit()
        assert await redeem_ws_ticket(db, ticket) is None
