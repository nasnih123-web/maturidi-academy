"""remediation-pass-2 Track 1 — §۹: چرخهٔ حیات توکن.

- رفرش واقعاً هم‌زمان (threadها + HTTP واقعی): دقیقاً یک برنده با ادعای
  اتمیک در سطح DB؛ بقیه reuse سخت‌گیرانه (B-02/ADR-0024) و نشست باطل.
- reset رمز عبور → همهٔ نشست‌ها/رفرش‌توکن‌ها باطل (قبلاً بود — نگهبان رگرسیون).
- مصرف هم‌زمان یک کد بازیابی → فقط یکی موفق (UPDATE مشروط اتمیک).
- مصرف هم‌زمان یک توکن reset → فقط یکی موفق.
"""
from __future__ import annotations

import asyncio
import threading
import uuid

from sqlalchemy import func, select

BASE = "/api/v1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _register(client, email, password="Str0ng!Pass1"):
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست R2",
            "email": email,
            "password": password,
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_concurrent_refresh_threads_strict_reuse(tc):
    """۸ thread هم‌زمان با یک رفرش‌توکن → دقیقاً یک برنده؛ بقیه reuse.

    قرارداد جدید (B-02 — ADR-0024، جانشین رفتار اغماض قبلی): ارائهٔ
    چندبارهٔ یک توکن — حتی واقعاً هم‌زمان — قابل اغماض نیست؛ ادعای
    اتمیک (UPDATE ... WHERE revoked=FALSE) فقط یک برنده می‌سازد و هر
    ارائهٔ دیگر «استفادهٔ مجدد» است: 401 + ابطال کل نشست. race مشروع
    با قفل رفرش سمت کلاینت حل می‌شود، نه در سرور.
    """
    import httpx
    from httpx import ASGITransport

    from app.main import app
    from app.models.models import RefreshToken, Session

    client = tc["client"]
    email = f"race9-{_uid()}@example.com"
    await _register(client, email)
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "Str0ng!Pass1"}
    )
    assert r.status_code == 200, r.text
    refresh_token = r.json()["refresh_token"]

    results: list[tuple[int, dict]] = []
    lock = threading.Lock()

    def _worker():
        async def _one():
            async with httpx.AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as c:
                resp = await c.post(
                    f"{BASE}/auth/refresh", json={"refresh_token": refresh_token}
                )
                with lock:
                    results.append((resp.status_code, resp.json()))

        asyncio.run(_one())

    threads = [threading.Thread(target=_worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    assert len(results) == 8, results
    statuses = sorted(s for s, _ in results)
    # دقیقاً یک برندهٔ چرخش؛ هفت ارائهٔ دیگر = reuse سخت‌گیرانه
    assert statuses == [200] + [401] * 7, statuses

    # پیامد reuse: کل نشست مرده است — صفر توکن زنده و نشست باطل
    # (DB بین فایل‌های تست مشترک است؛ پس per-session می‌شماریم)
    from app.models.models import User as _User

    async with tc["maker"]() as db:
        me = (
            await db.execute(select(_User).where(_User.email == email))
        ).scalar_one()
        my_session_id = (
            await db.execute(select(Session.id).where(Session.user_id == me.id))
        ).scalar_one()
        live = (
            await db.execute(
                select(func.count())
                .select_from(RefreshToken)
                .where(
                    RefreshToken.session_id == my_session_id,
                    RefreshToken.revoked.is_(False),
                )
            )
        ).scalar()
        assert live == 0, f"expected dead session after reuse, got {live} live"
        sess = await db.get(Session, my_session_id)
        assert sess is not None and sess.revoked, "session must be revoked"

    # حتی جفت‌توکن برنده هم مرده است (نشست باطل شده)
    winner = next(body for s, body in results if s == 200)
    r2 = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": winner["refresh_token"]}
    )
    assert r2.status_code == 401, r2.text
    r3 = await client.get(
        f"{BASE}/users/me",
        headers={"Authorization": f"Bearer {winner['access_token']}"},
    )
    assert r3.status_code == 401, r3.text
    assert r3.json()["error"]["code"] == "session_revoked"


async def test_password_reset_revokes_all_sessions(tc):
    """reset رمز → همهٔ نشست‌ها/رفرش‌توکن‌ها باطل می‌شوند (نگهبان رگرسیون §۹)."""
    import re

    client = tc["client"]
    email = f"reset9-{_uid()}@example.com"
    await _register(client, email)
    n_before = len(tc["sent"]["emails"])

    r1 = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "Str0ng!Pass1"}
    )
    r2 = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "Str0ng!Pass1"}
    )
    a1, rf1 = r1.json()["access_token"], r1.json()["refresh_token"]
    a2, rf2 = r2.json()["access_token"], r2.json()["refresh_token"]

    r = await client.post(
        f"{BASE}/auth/password-reset/request", json={"email": email}
    )
    assert r.status_code == 200, r.text
    assert len(tc["sent"]["emails"]) == n_before + 1
    body = tc["sent"]["emails"][-1]["body"]
    m = re.search(r"reset_token=([A-Za-z0-9_\-]+)", body)
    assert m, "reset token not found in email body"
    token = m.group(1)

    r = await client.post(
        f"{BASE}/auth/password-reset/confirm",
        json={"token": token, "new_password": "N3w!Str0ngPass"},
    )
    assert r.status_code == 200, r.text

    for at in (a1, a2):
        rr = await client.get(
            f"{BASE}/users/me", headers={"Authorization": f"Bearer {at}"}
        )
        assert rr.status_code == 401, rr.text
    for rt in (rf1, rf2):
        rr = await client.post(f"{BASE}/auth/refresh", json={"refresh_token": rt})
        assert rr.status_code == 401, rr.text

    # با رمز جدید لاگین ممکن است
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "N3w!Str0ngPass"}
    )
    assert r.status_code == 200, r.text


async def test_concurrent_recovery_code_single_use(tc):
    """دو درخواست هم‌زمان با یک کد بازیابی → فقط یکی 200، دیگری 400."""
    import json

    import pyotp

    from app.core.secrets import encrypt_value
    from app.core.security import generate_recovery_codes, hash_token
    from app.models.models import RecoveryCode, User

    client = tc["client"]
    email = f"rc9-{_uid()}@example.com"
    await _register(client, email)
    secret = pyotp.random_base32()
    codes = generate_recovery_codes(n=4)
    async with tc["maker"]() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        user.totp_secret = json.dumps(encrypt_value(secret))
        for c in codes:
            db.add(RecoveryCode(user_id=user.id, code_hash=hash_token(c)))
        await db.commit()

    async def _recover():
        return await client.post(
            f"{BASE}/auth/2fa/recover",
            json={
                "email": email,
                "password": "Str0ng!Pass1",
                "recovery_code": codes[0],
            },
        )

    r1, r2 = await asyncio.gather(_recover(), _recover())
    statuses = sorted([r1.status_code, r2.status_code])
    assert statuses == [200, 400], [r1.text, r2.text]

    # کد دوم هنوز سالم است و یک‌بار مصرف می‌شود
    r3 = await client.post(
        f"{BASE}/auth/2fa/recover",
        json={
            "email": email,
            "password": "Str0ng!Pass1",
            "recovery_code": codes[1],
        },
    )
    # بعد از مصرف کد اول، TOTP غیرفعال شده → کد دوم دیگر معنا ندارد (400)
    assert r3.status_code == 400, r3.text


async def test_concurrent_password_reset_token_single_use(tc):
    """دو confirm هم‌زمان با یک توکن reset → فقط یکی 200، دیگری 400."""
    import re

    client = tc["client"]
    email = f"rst9-{_uid()}@example.com"
    await _register(client, email)
    n_before = len(tc["sent"]["emails"])
    r = await client.post(f"{BASE}/auth/password-reset/request", json={"email": email})
    assert r.status_code == 200, r.text
    body = tc["sent"]["emails"][-1]["body"]
    assert len(tc["sent"]["emails"]) == n_before + 1
    token = re.search(r"reset_token=([A-Za-z0-9_\-]+)", body).group(1)

    async def _confirm(pw: str):
        return await client.post(
            f"{BASE}/auth/password-reset/confirm",
            json={"token": token, "new_password": pw},
        )

    r1, r2 = await asyncio.gather(_confirm("N3w!PassOne1"), _confirm("N3w!PassTwo2"))
    statuses = sorted([r1.status_code, r2.status_code])
    assert statuses == [200, 400], [r1.text, r2.text]
