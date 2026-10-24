"""تست‌های کپچای Turnstile روی ثبت‌نام — C-02 (ADR-0029).

siteverify واقعی کلودفلر با MockTransport stub می‌شود (توکن خوب/بد)؛
ماشین وضعیت کامل پوشش داده می‌شود:
- active + بدون توکن → 403 captcha_failed
- active + توکن بد → 403
- active + توکن خوب → 201
- enabled ولی secret نیست → 503 captcha_not_configured (fail-closed)
- صریحاً خاموش → 201 بدون توکن
"""
from __future__ import annotations

import uuid

import httpx
import pytest

from app.core import captcha
from app.core.config import get_settings

BASE = "/api/v1"


def _payload(**over):
    suffix = uuid.uuid4().hex[:8]
    body = {
        "full_name": "کاربر کپچا",
        "email": f"captcha-{suffix}@example.com",
        "password": "Str0ng!Pass1",
        "locale": "fa",
        "accept_terms": True,
    }
    body.update(over)
    return body


@pytest.fixture
def captcha_active(monkeypatch):
    """کپچا روشن + secret تنظیم‌شده؛ siteverify: فقط توکن good قبول است."""
    s = get_settings()
    monkeypatch.setattr(s, "captcha_enabled", True)
    monkeypatch.setattr(s, "turnstile_secret_key", "test-secret")
    monkeypatch.setattr(s, "turnstile_site_key", "test-site-key")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "challenges.cloudflare.com"
        form = httpx.QueryParams(request.read().decode())
        assert form.get("secret") == "test-secret"
        ok = form.get("response") == "good-token"
        return httpx.Response(200, json={"success": ok})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        captcha, "_make_client",
        lambda: httpx.AsyncClient(transport=transport, timeout=5.0),
    )
    return s


async def test_register_without_token_is_403(tc, captcha_active):
    r = await tc["client"].post(f"{BASE}/auth/register", json=_payload())
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "captcha_failed"


async def test_register_with_bad_token_is_403(tc, captcha_active):
    r = await tc["client"].post(
        f"{BASE}/auth/register", json=_payload(captcha_token="bad-token")
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "captcha_failed"


async def test_register_with_good_token_passes(tc, captcha_active):
    r = await tc["client"].post(
        f"{BASE}/auth/register", json=_payload(captcha_token="good-token")
    )
    assert r.status_code == 201, r.text
    assert r.json()["email"]


async def test_register_enabled_but_unconfigured_is_503(tc, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "captcha_enabled", True)
    monkeypatch.setattr(s, "turnstile_secret_key", "")
    assert captcha.captcha_state() == "misconfigured"
    r = await tc["client"].post(f"{BASE}/auth/register", json=_payload())
    assert r.status_code == 503, r.text
    assert r.json()["error"]["code"] == "captcha_not_configured"


async def test_register_disabled_passes_without_token(tc):
    # conftest پیش‌فرض harness را خاموش کرده است
    assert captcha.captcha_state() == "disabled"
    r = await tc["client"].post(f"{BASE}/auth/register", json=_payload())
    assert r.status_code == 201, r.text


async def test_public_settings_expose_site_key_only(tc, captcha_active):
    r = await tc["client"].get(f"{BASE}/settings/public")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["turnstile_site_key"] == "test-site-key"
    assert "test-secret" not in r.text  # secret هرگز عمومی نمی‌شود
