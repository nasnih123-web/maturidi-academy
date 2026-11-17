"""تست‌های انتخاب مسیر ارسال ایمیل (app.core.email) — Resend / SMTP / dev.

ترتیب مسیر: RESEND_API_KEY ست باشد → HTTPS API ریسند؛ وگرنه SMTP؛
وگرنه لاگ dev. شبکهٔ واقعی در هیچ تستی استفاده نمی‌شود: کلاینت httpx
با MockTransport stub می‌شود (الگوی test_captcha) و در مسیر dev هم
فکتوری کلاینت منفجر می‌شود تا ثابت شود هیچ درخواستی ساخته نمی‌شود.
"""
from __future__ import annotations

import json
import smtplib

import httpx
import pytest

from app.core import email as email_mod
from app.core.config import get_settings

_REAL_SEND_EMAIL = email_mod.send_email
_TEST_KEY = "test-resend-key"
_FROM = "Academy <noreply@academy.test>"


@pytest.fixture(autouse=True)
def _real_send_email(monkeypatch):
    """conftest در فیكسچر tc، send_email را با fake جایگزین می‌کند و
    برنمی‌گرداند؛ این تست‌ها تابع واقعی را می‌خواهند، پس برگردانده می‌شود."""
    monkeypatch.setattr(email_mod, "send_email", _REAL_SEND_EMAIL)


@pytest.fixture
def resend_settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "resend_api_key", _TEST_KEY)
    monkeypatch.setattr(s, "smtp_from", _FROM)
    monkeypatch.setattr(s, "smtp_host", "")
    return s


def _stub_client(monkeypatch, handler) -> None:
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        email_mod,
        "_make_client",
        lambda: httpx.AsyncClient(transport=transport, timeout=5.0),
    )


async def test_resend_posts_to_api_with_auth_and_payload(monkeypatch, resend_settings):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["payload"] = json.loads(request.read().decode())
        return httpx.Response(200, json={"id": "email-123"})

    _stub_client(monkeypatch, handler)

    ok = await email_mod.send_email(
        "user@example.com", "تأیید ایمیل", "متن ساده", "<p>متن html</p>"
    )
    assert ok is True
    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["auth"] == f"Bearer {_TEST_KEY}"
    assert captured["payload"] == {
        "from": _FROM,
        "to": ["user@example.com"],
        "subject": "تأیید ایمیل",
        "text": "متن ساده",
        "html": "<p>متن html</p>",
    }


async def test_resend_payload_omits_html_when_not_provided(monkeypatch, resend_settings):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.read().decode())
        return httpx.Response(200, json={"id": "email-124"})

    _stub_client(monkeypatch, handler)

    ok = await email_mod.send_email("user@example.com", "موضوع", "فقط متن")
    assert ok is True
    assert "html" not in captured["payload"]
    assert captured["payload"]["text"] == "فقط متن"


async def test_resend_takes_priority_over_smtp(monkeypatch, resend_settings):
    """با وجود smtp_host، وقتی کلید ریسند هست SMTP اصلاً صدا نمی‌شود."""
    monkeypatch.setattr(resend_settings, "smtp_host", "smtp.example.com")

    def _boom_smtp(*args, **kwargs):
        raise AssertionError("SMTP must not be used when Resend is configured")

    monkeypatch.setattr(smtplib, "SMTP", _boom_smtp)
    _stub_client(monkeypatch, lambda request: httpx.Response(200, json={"id": "e-1"}))

    assert await email_mod.send_email("user@example.com", "s", "b") is True


async def test_resend_non_2xx_raises_without_leaking_key(monkeypatch, resend_settings):
    _stub_client(
        monkeypatch,
        lambda request: httpx.Response(422, json={"message": "invalid from"}),
    )

    with pytest.raises(RuntimeError) as excinfo:
        await email_mod.send_email("user@example.com", "s", "b")
    assert "422" in str(excinfo.value)
    assert _TEST_KEY not in str(excinfo.value)


async def test_dev_log_path_without_key_or_smtp(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "resend_api_key", "")
    monkeypatch.setattr(s, "smtp_host", "")

    def _boom_client():
        raise AssertionError("no HTTP client may be created in dev mode")

    monkeypatch.setattr(email_mod, "_make_client", _boom_client)

    assert await email_mod.send_email("user@example.com", "s", "body") is True
