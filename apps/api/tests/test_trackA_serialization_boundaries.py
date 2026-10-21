"""تست‌های مرزی Track A (§۵.۹) — نشت secrets در پاسخ‌های API.

قرارداد: هیچ Out-schemaای نباید فیلدهای حساس (password_hash، totp_secret،
key_hash، سکرت‌های پیکربندی) را expose کند؛ serializing از ORM با
from_attributes فقط فیلدهای اعلان‌شده را می‌خواند. این تست‌ها آن قرارداد را
در سطح schema و unit می‌بندند.
"""
from __future__ import annotations

import importlib
import inspect
import pkgutil
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from pydantic import BaseModel

import app.modules


def _out_schemas():
    """همهٔ کلاس‌های *Out / پاسخ‌ها از همهٔ ماژول‌ها (شامل control_schemas)."""
    for _, mod_name, _ in pkgutil.walk_packages(
        app.modules.__path__, prefix="app.modules."
    ):
        try:
            module = importlib.import_module(mod_name)
        except Exception:  # noqa: BLE001
            continue
        for _, obj in inspect.getmembers(module, inspect.isclass):
            if getattr(obj, "__module__", None) != mod_name:
                continue
            if not issubclass(obj, BaseModel):
                continue
            name = obj.__name__
            if name.endswith(("Out", "Page", "Summary")):
                yield name, obj


FORBIDDEN_FIELDS = {
    "password_hash",
    "totp_secret",
    "key_hash",
    "jwt_secret",
    "encryption_key",
    "s3_secret_key",
    "webhook_secret",
    "merchant_key",
    "totp_last_step",
}


def test_no_out_schema_declares_secret_fields():
    offenders = []
    for name, schema in _out_schemas():
        bad = FORBIDDEN_FIELDS & set(schema.model_fields)
        if bad:
            offenders.append(f"{name}: {sorted(bad)}")
    assert not offenders, f"out schemas with secret fields: {offenders}"


def _user_stub():
    return SimpleNamespace(
        id=uuid4(),
        full_name="کاربر تست",
        email="u@example.com",
        phone=None,
        locale="fa",
        is_active=True,
        is_verified=True,
        created_at=datetime.now(UTC),
        password_hash="HASH-MUST-NOT-LEAK",
        totp_secret="TOTP-MUST-NOT-LEAK",
    )


def test_user_out_hides_secrets():
    from app.modules.users.schemas import UserOut

    out = UserOut.model_validate(_user_stub()).model_dump(mode="json")
    assert set(out) == {
        "id",
        "full_name",
        "email",
        "phone",
        "locale",
        "is_active",
        "is_verified",
        "created_at",
        # فاز ۲: نقش‌ها/مجوزهای RBAC عمداً expose می‌شوند (نام نقش و کلید
        # مجوز secret نیستند — گیتینگ UI روی همان‌ها سوار است). مقادیر
        # پیش‌فرض خالی‌اند و هیچ دادهٔ حساسی از این مسیر نشت نمی‌کند.
        "roles",
        "permissions",
    }
    blob = str(out)
    assert "HASH-MUST-NOT-LEAK" not in blob
    assert "TOTP-MUST-NOT-LEAK" not in blob


def test_user_summary_hides_secrets():
    from app.modules.auth.schemas import UserSummary

    out = UserSummary.model_validate(_user_stub()).model_dump(mode="json")
    blob = str(out)
    assert "HASH-MUST-NOT-LEAK" not in blob
    assert "TOTP-MUST-NOT-LEAK" not in blob
    assert "password_hash" not in out
    assert "totp_secret" not in out


def test_api_key_out_exposes_prefix_only():
    from app.modules.api_keys.schemas import ApiKeyOut

    stub = SimpleNamespace(
        id=uuid4(),
        name="widget",
        key_prefix="mk_test1",
        scopes=["ayah-of-day"],
        rate_limit_per_min=60,
        quota_monthly=1000,
        used_this_month=0,
        quota_period="2026-10",
        is_active=True,
        abuse_flag=False,
        last_used_at=None,
        created_at=datetime.now(UTC),
        revoked_at=None,
        key_hash="HASH-OF-RAW-KEY-MUST-NOT-LEAK",
    )
    out = ApiKeyOut.model_validate(stub).model_dump(mode="json")
    assert out["key_prefix"] == "mk_test1"
    assert "HASH-OF-RAW-KEY-MUST-NOT-LEAK" not in str(out)


def test_admin_settings_items_mask_sensitive():
    """کلیدهای حساس تنظیمات همیشه «***» برمی‌گردند (service.py:209)."""
    from app.modules.admin.schemas import SettingItem

    item = SettingItem(key="s3.secret_key", value="***", masked=True, type="secret")
    assert item.value == "***" and item.masked is True
