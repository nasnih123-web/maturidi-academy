"""تست‌های قالب ایمیل برنددار و انتخاب زبان بر اساس کشور.

سه لایه: (۱) resolver زبان از روی کشورِ شماره/زبان ذخیره‌شده،
(۲) رندر هر دو ایمیل (تأیید + بازنشانی) در هر سه زبان، (۳) اتصال
سرتاسری در سرویس auth: ایمیلی که هنگام ثبت‌نام/بازیابی واقعاً
فرستاده می‌شود باید موضوع و لینکِ هم‌زبانِ کشور کاربر را داشته باشد.
"""
from __future__ import annotations

import pytest

from app.core.mail_templates import (
    render_password_reset_email,
    render_verification_email,
    resolve_email_locale,
)

BASE = "/api/v1"

VERIFY_SUBJECTS = {
    "fa": "تأیید ایمیل — آکادمی ماتریدی",
    "ar": "تأكيد البريد الإلكتروني — أكاديمية ماتريدي",
    "en": "Verify your email — Maturidi Academy",
}
RESET_SUBJECTS = {
    "fa": "بازنشانی رمز عبور — آکادمی ماتریدی",
    "ar": "إعادة تعيين كلمة المرور — أكاديمية ماتريدي",
    "en": "Reset your password — Maturidi Academy",
}
VERIFY_CTAS = {"fa": "تأیید ایمیل", "ar": "تأكيد البريد الإلكتروني", "en": "Verify email"}
RESET_CTAS = {
    "fa": "بازنشانی رمز عبور",
    "ar": "إعادة تعيين كلمة المرور",
    "en": "Reset password",
}


# ---------- resolver ----------


@pytest.mark.parametrize(
    ("phone", "stored", "expected"),
    [
        ("+989123456789", None, "fa"),  # ایران → فارسی
        ("+989123456789", "en", "fa"),  # شماره بر زبان ذخیره‌شده مقدم است
        ("+966501234567", None, "ar"),  # عربستان → عربی
        ("+966501234567", "fa", "ar"),
        ("+971501234567", None, "ar"),  # امارات → عربی
        ("+201012345678", None, "ar"),  # مصر → عربی
        ("+9647701234567", None, "ar"),  # عراق → عربی
        ("+4915123456789", None, "en"),  # آلمان → انگلیسی
        ("+12125550123", None, "en"),  # آمریکا → انگلیسی
        ("+442071234567", None, "en"),  # بریتانیا → انگلیسی
        ("+905301234567", None, "en"),  # ترکیه عربی نیست → انگلیسی
        (None, "ar", "ar"),  # بدون شماره: زبان ذخیره‌شده
        (None, "fa", "fa"),
        (None, "en", "en"),
        (None, "de", "en"),  # زبان ذخیره‌شدهٔ پشتیبانی‌نشده → انگلیسی
        (None, None, "en"),
        (None, "", "en"),
        ("", "ar", "ar"),  # شمارهٔ خالی مثل نبودن شماره است
    ],
)
def test_resolve_email_locale(phone, stored, expected):
    assert resolve_email_locale(phone, stored) == expected


# ---------- rendering ----------


def _url(locale: str, kind: str) -> str:
    page = "verify-email" if kind == "verify" else "reset-password"
    return f"https://academy.example/{locale}/{page}?token=tok-123_ABC"


@pytest.mark.parametrize("locale", ["fa", "ar", "en"])
def test_render_verification_email(locale):
    url = _url(locale, "verify")
    msg = render_verification_email(
        locale=locale,
        action_url=url,
        token="tok-123_ABC",
        logo_url="https://academy.example/logo.jpg",
        name="کاربر نمونه",
    )
    assert msg.subject == VERIFY_SUBJECTS[locale]
    # متن ساده: لینک خام + خط نشانگر توکن (قرارداد قدیمی تست‌ها/کلاینت)
    assert url in msg.text
    assert "verify_token=tok-123_ABC" in msg.text
    # HTML: دکمهٔ CTA با همان لینک، جهت و زبان درست، لوگو
    assert f'href="{url}"' in msg.html
    assert VERIFY_CTAS[locale] in msg.html
    assert f'lang="{locale}"' in msg.html
    expected_dir = "rtl" if locale in ("fa", "ar") else "ltr"
    assert f'dir="{expected_dir}"' in msg.html
    assert '<img src="https://academy.example/logo.jpg"' in msg.html
    # هیچ جای‌گذاری حل‌نشده‌ای نمانده باشد
    for placeholder in ("{name}", "{token}", "{action_url}"):
        assert placeholder not in msg.html
        assert placeholder not in msg.text


@pytest.mark.parametrize("locale", ["fa", "ar", "en"])
def test_render_password_reset_email(locale):
    url = _url(locale, "reset")
    msg = render_password_reset_email(
        locale=locale, action_url=url, token="tok-123_ABC"
    )
    assert msg.subject == RESET_SUBJECTS[locale]
    assert url in msg.text
    assert "reset_token=tok-123_ABC" in msg.text
    assert f'href="{url}"' in msg.html
    assert RESET_CTAS[locale] in msg.html
    expected_dir = "rtl" if locale in ("fa", "ar") else "ltr"
    assert f'dir="{expected_dir}"' in msg.html
    # بدون لوگو هم پوسته کامل است
    assert "<img" not in msg.html


def test_render_greeting_uses_name_and_escapes_html():
    msg = render_verification_email(
        locale="fa",
        action_url=_url("fa", "verify"),
        token="t1",
        name="حسین <b>تست</b>",
    )
    assert msg.text.startswith("سلام حسین <b>تست</b>،")
    assert "سلام حسین &lt;b&gt;تست&lt;/b&gt;،" in msg.html
    assert "<b>تست</b>" not in msg.html


def test_render_unknown_locale_falls_back_to_english():
    msg = render_verification_email(
        locale="de", action_url=_url("en", "verify"), token="t1"
    )
    assert msg.subject == VERIFY_SUBJECTS["en"]
    assert 'lang="en"' in msg.html
    assert 'dir="ltr"' in msg.html


# ---------- wiring در سرویس auth ----------


async def _register_passwordless(client, email, phone=None, locale="fa"):
    body = {
        "full_name": "کاربر وب",
        "email": email,
        "locale": locale,
        "accept_terms": True,
    }
    if phone:
        body["phone"] = phone
    r = await client.post(f"{BASE}/auth/register", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _sent_to(sent, email):
    return [e for e in sent["emails"] if e["to"] == email]


async def test_register_email_language_saudi_phone_is_arabic(tc):
    client, sent = tc["client"], tc["sent"]
    email = "sa-user@example.com"
    await _register_passwordless(client, email, phone="+966501234567")
    (msg,) = _sent_to(sent, email)
    assert msg["subject"] == VERIFY_SUBJECTS["ar"]
    assert "/ar/verify-email?token=" in msg["body"]
    assert "verify_token=" in msg["body"]


async def test_register_email_language_iranian_phone_is_persian(tc):
    client, sent = tc["client"], tc["sent"]
    email = "ir-user@example.com"
    await _register_passwordless(client, email, phone="+989120007531")
    (msg,) = _sent_to(sent, email)
    assert msg["subject"] == VERIFY_SUBJECTS["fa"]
    assert "/fa/verify-email?token=" in msg["body"]


async def test_register_email_language_german_phone_beats_fa_locale(tc):
    client, sent = tc["client"], tc["sent"]
    email = "de-user@example.com"
    await _register_passwordless(
        client, email, phone="+4915112345678", locale="fa"
    )
    (msg,) = _sent_to(sent, email)
    assert msg["subject"] == VERIFY_SUBJECTS["en"]
    assert "/en/verify-email?token=" in msg["body"]


async def test_register_email_language_no_phone_uses_stored_locale(tc):
    client, sent = tc["client"], tc["sent"]
    email = "ar-locale@example.com"
    await _register_passwordless(client, email, locale="ar")
    (msg,) = _sent_to(sent, email)
    assert msg["subject"] == VERIFY_SUBJECTS["ar"]
    assert "/ar/verify-email?token=" in msg["body"]


async def test_password_reset_email_language_emirati_phone(tc):
    client, sent = tc["client"], tc["sent"]
    email = "ae-user@example.com"
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر اماراتی",
            "email": email,
            "phone": "+971509876543",
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text

    r = await client.post(
        f"{BASE}/auth/password-reset/request", json={"email": email}
    )
    assert r.status_code == 200
    resets = [e for e in _sent_to(sent, email) if "reset_token=" in e["body"]]
    (msg,) = resets
    assert msg["subject"] == RESET_SUBJECTS["ar"]
    assert "/ar/reset-password?token=" in msg["body"]
