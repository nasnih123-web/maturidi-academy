"""remediation-pass-2 Track 1 — §۸: بازیابی ایمیل/پیامک.

- لینک‌ها از app_base_urlِ اعتبارسنجی‌شده ساخته می‌شوند (نه example.com)
- توکن/OTP در لاگ نمی‌آید (حتی در dev) — redact_secrets
- پاسخ یکنواخت برای ایمیل ناشناس (anti-enumeration) + ایمیلی ارسال نمی‌شود
- ضد اسپم: سقف درخواست روی IP و ایمیل
- public_url هاست نامعتبر/userinfo را رد می‌کند (بدون host-header poisoning)
"""
from __future__ import annotations

import logging
import uuid

import pytest

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


async def test_reset_link_uses_configured_base_url(tc):
    """یافته: لینک بازیابی قبلاً https://example.com بود — حالا app_base_url."""
    client = tc["client"]
    email = f"link8-{_uid()}@example.com"
    await _register(client, email)
    n_before = len(tc["sent"]["emails"])
    r = await client.post(f"{BASE}/auth/password-reset/request", json={"email": email})
    assert r.status_code == 200, r.text
    assert len(tc["sent"]["emails"]) == n_before + 1
    body = tc["sent"]["emails"][-1]["body"]
    assert "example.com" not in body, body
    # app_base_url پیش‌فرض تست: http://localhost:8000
    assert "http://localhost:8000/reset-password?token=" in body, body


async def test_verify_email_link_uses_configured_base_url(tc):
    client = tc["client"]
    email = f"vlink8-{_uid()}@example.com"
    n_before = len(tc["sent"]["emails"])
    await _register(client, email)
    bodies = [m["body"] for m in tc["sent"]["emails"][n_before:]]
    assert bodies, "expected verification email"
    assert "example.com" not in bodies[0], bodies[0]
    assert "http://localhost:8000/verify-email?token=" in bodies[0], bodies[0]


async def test_unknown_email_uniform_response_no_email(tc):
    """anti-enumeration: ایمیل ناشناس هم ۲۰۰ با همان پیام؛ ایمیلی ارسال نمی‌شود."""
    client = tc["client"]
    n_before = len(tc["sent"]["emails"])
    r = await client.post(
        f"{BASE}/auth/password-reset/request",
        json={"email": f"nobody-{_uid()}@example.com"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "اگر این ایمیل ثبت شده باشد، لینک بازیابی ارسال شد"
    assert len(tc["sent"]["emails"]) == n_before


async def test_password_reset_request_throttled(tc):
    """ضد اسپم (§۸): بیش از ۳ درخواست در ساعت برای یک ایمیل → 429."""
    client = tc["client"]
    email = f"spam8-{_uid()}@example.com"
    await _register(client, email)
    codes = []
    for _ in range(5):
        r = await client.post(
            f"{BASE}/auth/password-reset/request", json={"email": email}
        )
        codes.append(r.status_code)
    assert codes[:3] == [200, 200, 200], codes
    assert 429 in codes[3:], codes


def test_redact_secrets_masks_tokens_and_codes():
    from app.core.email import redact_secrets

    body = (
        "برای تعیین رمز جدید:\n"
        "http://localhost:8000/reset-password?token=abcDEF123_xyz\n"
        "reset_token=abcDEF123_xyz\n"
        "کد تأیید: 482916"
    )
    out = redact_secrets(body)
    assert "abcDEF123_xyz" not in out
    assert "482916" not in out
    assert "[REDACTED]" in out
    assert "[CODE]" in out


def test_dev_email_log_contains_no_token(caplog):
    """لاگ dev ایمیل نباید توکن را چاپ کند (یافتهٔ §۸) — مسیر واقعی send_email."""
    import asyncio
    import importlib

    import app.core.email as email_mod

    fake = email_mod.send_email  # fake جلسه‌ای conftest — بعداً برمی‌گردد
    try:
        importlib.reload(email_mod)  # بازگرداندن پیاده‌سازی واقعی
        token = "tok_" + "q" * 40
        with caplog.at_level(logging.INFO, logger="maturidi.email"):
            asyncio.run(
                email_mod.send_email(
                    "u@example.com",
                    "بازیابی",
                    f"لینک: http://localhost:8000/reset-password?token={token}",
                )
            )
        text = caplog.text
        assert token not in text, text
        assert "[REDACTED]" in text
    finally:
        email_mod.send_email = fake


def test_dev_sms_log_contains_no_code(caplog):
    """لاگ dev پیامک نباید کد را چاپ کند — مستقیم روی LogSmsProvider."""
    import asyncio

    from app.core.sms import LogSmsProvider

    with caplog.at_level(logging.INFO, logger="maturidi.sms"):
        asyncio.run(
            LogSmsProvider().send("+989001234567", "کد تأیید آکادمی ماتریدی: 482916")
        )
    assert "482916" not in caplog.text
    assert "[CODE]" in caplog.text


def test_public_url_rejects_bad_base(monkeypatch):
    """هاست لینک از تنظیمات می‌آید و اعتبارسنجی می‌شود — بدون poisoning."""
    from app.core import config as config_mod
    from app.core.errors import APIError
    from app.modules.auth.service import public_url

    # public_url در هر فراخوانی get_settings را از ماژول config می‌خواند،
    # پس monkeypatch روی همان attribute اثر می‌کند.
    for bad in ["javascript:alert(1)", "http://user:pass@evil.test/", "notaurl", ""]:
        monkeypatch.setattr(
            config_mod,
            "get_settings",
            lambda bad=bad: config_mod.Settings(app_env="dev", app_base_url=bad),
        )
        with pytest.raises(APIError) as ei:
            public_url("/reset-password?token=x")
        assert ei.value.code == "bad_base_url"


def test_kavenegar_api_error_body_not_fake_success():
    """§۸: HTTP 200 با return.status غیر 200 → خطا (نه «موفقیت جعلی»)."""
    import asyncio

    import httpx

    from app.core.sms import KavenegarProvider

    class _FakeResp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"return": {"status": 411, "message": "invalid receptor"}}

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            return _FakeResp()


    orig = httpx.AsyncClient
    httpx.AsyncClient = _FakeClient
    try:
        with __import__("pytest").raises(RuntimeError, match="kavenegar delivery failed"):
            asyncio.run(KavenegarProvider(api_key="k").send("+98900", "سلام"))
    finally:
        httpx.AsyncClient = orig

    class _FakeRespOk(_FakeResp):
        def json(self):
            return {"return": {"status": 200, "message": "ok"}}

    class _FakeClientOk(_FakeClient):
        async def post(self, *a, **kw):
            return _FakeRespOk()

    httpx.AsyncClient = _FakeClientOk
    try:
        assert asyncio.run(KavenegarProvider(api_key="k").send("+98900", "سلام")) is True
    finally:
        httpx.AsyncClient = orig


def test_public_url_ok():
    from app.modules.auth.service import public_url

    url = public_url("/reset-password?token=abc")
    assert url == "http://localhost:8000/reset-password?token=abc"
