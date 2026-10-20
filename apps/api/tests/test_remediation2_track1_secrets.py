"""remediation-pass-2 Track 1 — §۶: اعتبارسنجی secrets در production.

- placeholder دقیق (CHANGE_ME/خالی) → خطا (رفتار قبلی — نگهبان رگرسیون)
- الگوی CHANGE_ME__... → خطا (یافتهٔ جدید)
- کلید کوتاه‌تر از ۳۲ کاراکتر → خطا (یافتهٔ جدید)
- jwt_secret == encryption_key → خطا (یافتهٔ جدید)
- مقادیر ضعیف شناخته‌شده → خطا
- app_base_url نامعتبر/localhost در production → خطا (§۸)
- مقادیر واقعی قوی → بدون خطا
- dev با placeholder → بدون خطا (توسعه سبک می‌ماند)
- پیام خطا هیچ secretی را لو نمی‌دهد
"""
from __future__ import annotations

import pytest

from app.core.config import Settings, assert_production_secrets_ok

STRONG_JWT = "a" * 64
STRONG_ENC = "b" * 64


def _prod(**kw):
    base = dict(
        app_env="production",
        jwt_secret=STRONG_JWT,
        encryption_key=STRONG_ENC,
        app_base_url="https://api.example.org",
    )
    base.update(kw)
    return Settings(**base)


def test_placeholder_rejected():
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(_prod(jwt_secret="CHANGE_ME"))
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(_prod(encryption_key=""))


def test_change_me_pattern_rejected():
    """یافتهٔ جدید: CHANGE_ME__generate_a_random_secret هم رد می‌شود."""
    with pytest.raises(RuntimeError) as ei:
        assert_production_secrets_ok(
            _prod(jwt_secret="CHANGE_ME__generate_a_random_secret")
        )
    assert "CHANGE_ME__generate_a_random_secret" not in str(ei.value)


def test_short_secret_rejected():
    """یافتهٔ جدید: کلید کوتاه‌تر از ۳۲ کاراکتر در production ممنوع."""
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(_prod(jwt_secret="short-secret-123"))
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(_prod(encryption_key="x" * 31))


def test_reused_secret_rejected():
    """یافتهٔ جدید: یک secret برای دو منظور (jwt == encryption_key) ممنوع."""
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(
            _prod(jwt_secret=STRONG_JWT, encryption_key=STRONG_JWT)
        )


def test_weak_default_rejected():
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(_prod(jwt_secret="password"))
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(_prod(encryption_key="minioadmin"))


def test_localhost_base_url_rejected_in_prod():
    """یافتهٔ جدید (§۸): لینک‌های بازیابی/تأیید در production باید عمومی باشند."""
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(_prod(app_base_url="http://localhost:8000"))
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(_prod(app_base_url="http://127.0.0.1:9000"))
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(_prod(app_base_url="not-a-url"))


def test_strong_values_pass():
    assert_production_secrets_ok(_prod()) is None


def test_dev_stays_silent_with_placeholders():
    """dev/test با placeholder بالا می‌آید — فقط production fail-fast است."""
    s = Settings(app_env="dev", jwt_secret="CHANGE_ME", encryption_key="")
    assert_production_secrets_ok(s) is None
    s = Settings(app_env="dev")  # مقادیر پیش‌فرض
    assert_production_secrets_ok(s) is None


def test_staging_also_guarded():
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(_prod(app_env="staging", jwt_secret="CHANGE_ME"))


def test_error_leaks_no_secret():
    evil = "CHANGE_ME__" + "z" * 40
    with pytest.raises(RuntimeError) as ei:
        assert_production_secrets_ok(_prod(jwt_secret=evil))
    assert evil not in str(ei.value)
    assert "z" * 40 not in str(ei.value)
