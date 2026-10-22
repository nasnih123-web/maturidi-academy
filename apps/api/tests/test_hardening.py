"""تست‌های سخت‌افزاری امنیتی — رفتارهای پورت‌شده از turbo + میدل‌ویرها/متریک.

پوشش:
- reuse detection رفرش‌توکن → ابطال کل نشست (الگوی turbo)
- گره‌خوردن access token به نشست (sid) — logout/logout-all بی‌درنگ اثر می‌کند
- پرچم must_enroll_2fa برای نقش‌های مدیریتی (قرارداد §۲)
- هدرهای امنیتی، request-id، /metrics، نگهبان secrets در production
"""
from __future__ import annotations

import uuid
from datetime import UTC

import pytest

BASE = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _register(client, email: str, password: str = "TestPass123") -> dict:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست",
            "email": email,
            "password": password,
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, identifier: str, password: str = "TestPass123") -> dict:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": identifier, "password": password}
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_refresh_reuse_revokes_whole_session(tc):
    """الگوی turbo، سخت‌گیرانه (B-02 — ADR-0024، جانشین اغماض ADR-0020).

    استفادهٔ مجدد از رفرش‌توکن چرخش‌خورده — حتی بلافاصله (≈ثانیهٔ ۱) —
    سرقت است: 401 و کل نشست (از جمله جفت‌توکن تازه) باطل می‌شود.
    """
    client = tc["client"]
    await _register(client, "reuse@example.com")
    tokens = await _login(client, "reuse@example.com")

    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 200
    fresh = r.json()

    # replay فوری توکن قدیمی (≈۱ ثانیه بعد از چرخش): بدون اغماض → 401
    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "invalid_token"

    # نشست باطل شده: توکن جدید همان نشست هم مرده است
    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": fresh["refresh_token"]}
    )
    assert r.status_code == 401
    r = await client.get(f"{BASE}/users/me", headers=_auth(fresh["access_token"]))
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "session_revoked"


async def test_refresh_reuse_at_59_seconds_still_revokes(tc):
    """B-02: reuse در ثانیهٔ ۵۹ (داخل پنجرهٔ اغماض قدیمی) هم سرقت است."""
    from datetime import datetime, timedelta

    from sqlalchemy import update

    from app.models.models import RefreshToken

    client = tc["client"]
    await _register(client, "reuse59@example.com")
    tokens = await _login(client, "reuse59@example.com")

    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 200
    fresh = r.json()

    # شبیه‌سازی گذر ۵۹ ثانیه از چرخش (دقیقاً داخل پنجرهٔ اغماض حذف‌شده)
    async with tc["maker"]() as db:
        past = datetime.now(UTC) - timedelta(seconds=59)
        await db.execute(update(RefreshToken).values(created_at=past))
        await db.commit()

    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "invalid_token"

    # نشست مرده است
    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": fresh["refresh_token"]}
    )
    assert r.status_code == 401
    r = await client.get(f"{BASE}/users/me", headers=_auth(fresh["access_token"]))
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "session_revoked"


async def test_reuse_detection_writes_audit_and_event(tc, db_session):
    """تشخیص reuse هم audit log و هم domain event تولید می‌کند (قانون لایه‌بندی)."""
    from sqlalchemy import select

    from app.models.models import AuditLog, DomainEvent

    client = tc["client"]
    await _register(client, "reuse-audit@example.com")
    tokens = await _login(client, "reuse-audit@example.com")

    await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )

    audits = (
        (
            await db_session.execute(
                select(AuditLog).where(AuditLog.action == "token.reuse_detected")
            )
        )
        .scalars()
        .all()
    )
    assert len(audits) >= 1
    # scrubber قرارداد §۱۴ کلید حاوی session را mask می‌کند — فقط «تغییر کرد» می‌ماند
    assert audits[-1].new_values == {
        "session_revoked": {"field": "session_revoked", "changed": True}
    }

    events = (
        (
            await db_session.execute(
                select(DomainEvent).where(
                    DomainEvent.event_type == "token.reuse_detected"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(events) >= 1


async def test_single_logout_kills_access_token(tc):
    """logout تکی نشست را می‌بندد — access token بی‌درنگ می‌میرد (الگوی turbo)."""
    client = tc["client"]
    await _register(client, "logout1@example.com")
    tokens = await _login(client, "logout1@example.com")

    r = await client.post(
        f"{BASE}/auth/logout",
        json={"refresh_token": tokens["refresh_token"]},
        headers=_auth(tokens["access_token"]),
    )
    assert r.status_code == 200

    r = await client.get(f"{BASE}/users/me", headers=_auth(tokens["access_token"]))
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "session_revoked"
    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 401


async def test_logout_all_kills_all_access_tokens(tc):
    """الگوی turbo: بعد از logout-all هیچ access tokenی کار نمی‌کند."""
    client = tc["client"]
    await _register(client, "logoutall@example.com")
    t1 = await _login(client, "logoutall@example.com")
    t2 = await _login(client, "logoutall@example.com")

    r = await client.post(f"{BASE}/auth/logout-all", headers=_auth(t1["access_token"]))
    assert r.status_code == 200

    for t in (t1, t2):
        r = await client.get(f"{BASE}/users/me", headers=_auth(t["access_token"]))
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "session_revoked"


async def test_must_enroll_2fa_flag(tc, db_session):
    """قرارداد §۲ (الگوی turbo): ادمین بدون TOTP پرچم must_enroll_2fa می‌گیرد."""
    from sqlalchemy import select

    from app.models.models import Role, UserRole

    client = tc["client"]

    # کاربر عادی → پرچم False
    await _register(client, "plain2fa@example.com")
    tokens = await _login(client, "plain2fa@example.com")
    assert tokens["must_enroll_2fa"] is False

    # نقش مدیریتی (get-or-create — ممکن است تست دیگری ساخته باشدش)
    role = (
        await db_session.execute(select(Role).where(Role.name == "super_admin"))
    ).scalar_one_or_none()
    if role is None:
        role = Role(name="super_admin", description="test")
        db_session.add(role)
        await db_session.flush()
    await db_session.commit()  # قفل SQLite: کامیت پیش از نوشتن‌های HTTP
    me = await _register(client, "admin2fa@example.com")
    db_session.add(UserRole(user_id=uuid.UUID(me["id"]), role_id=role.id))
    await db_session.commit()

    tokens = await _login(client, "admin2fa@example.com")
    assert tokens["must_enroll_2fa"] is True


async def test_security_headers_present(tc):
    client = tc["client"]
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "permissions-policy" in r.headers


async def test_request_id_echo(tc):
    client = tc["client"]
    r = await client.get("/health", headers={"X-Request-ID": "probe-123"})
    assert r.headers["x-request-id"] == "probe-123"
    r = await client.get("/health")
    assert r.headers["x-request-id"]  # تولید خودکار


async def test_metrics_endpoint(tc):
    client = tc["client"]
    await client.get("/health")
    r = await client.get("/metrics")
    assert r.status_code == 200
    assert "text/plain" in r.headers["content-type"]
    assert "http_requests_total" in r.text
    assert "process_uptime_seconds" in r.text


def test_metrics_path_normalization():
    from app.core.metrics import normalize_path

    assert (
        normalize_path(
            "/api/v1/admin/events/dead-letter/123e4567-e89b-12d3-a456-426614174000/retry"
        )
        == "/api/v1/admin/events/dead-letter/{id}/retry"
    )
    assert normalize_path("/api/v1/users/me") == "/api/v1/users/me"


def test_production_secret_guard():
    from app.core.config import Settings, assert_production_secrets_ok

    # dev: سکوت
    assert_production_secrets_ok(Settings(app_env="dev"))

    # staging با placeholder → خطا (متن جدید نگهبان: insecure setting)
    with pytest.raises(RuntimeError, match="insecure setting"):
        assert_production_secrets_ok(
            Settings(
                app_env="staging", jwt_secret="CHANGE_ME", encryption_key="real-key"
            )
        )
    with pytest.raises(RuntimeError, match="insecure setting"):
        assert_production_secrets_ok(
            Settings(
                app_env="production",
                jwt_secret="real-jwt",
                encryption_key="CHANGE_ME",
            )
        )

    # staging با secret واقعی → سبز (کلیدهای ≥۳۲ کاراکتری و base_url عمومی)
    assert_production_secrets_ok(
        Settings(
            app_env="production",
            jwt_secret="s" * 64,
            encryption_key="k" * 64,
            app_base_url="https://api.example.org",
        )
    )

    # remediation-pass-2 Track 1 (§۶): کلید کوتاه در production هم رد می‌شود
    with pytest.raises(RuntimeError, match="too short"):
        assert_production_secrets_ok(
            Settings(
                app_env="production",
                jwt_secret="s" * 64,
                encryption_key="short",
                app_base_url="https://api.example.org",
            )
        )


async def test_access_log_middleware(tc, caplog):
    client = tc["client"]
    with caplog.at_level("INFO", logger="maturidi"):
        await client.get("/health")
    assert "http_access" in caplog.text
    assert "method=GET" in caplog.text
    assert "request_id=" in caplog.text
