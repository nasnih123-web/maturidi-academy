"""تست‌های اسکن ویروس ClamAV — C-01 (ADR-0028).

- پروتکل INSTREAM واقعی علیه stub clamd کانف‌تست: پاک → OK،
  EICAR → FOUND با نام امضا
- سیاست fail-closed: اسکنر مرده → 503 antivirus_unavailable در dev و
  production هر دو؛ بای‌پس فقط dev + پرچم صریح (با لاگ CRITICAL)
- مسیر کامل آپلود کتابخانه: EICAR → 422 file_infected + ردیف ممیزی؛
  فایل پاک → 201 (همان stub، اسکن واقعی)
"""
from __future__ import annotations

import logging
import uuid

import pytest
from sqlalchemy import select

from app.core import antivirus
from app.core.config import get_settings
from app.core.errors import APIError

# امضای استاندارد EICAR — از دو تکه ساخته می‌شود تا اسکنرهای خودِ
# مخزن روی فایل تست آلارم ندهند؛ بایت نهایی همان رشتهٔ استاندارد است.
EICAR = (
    b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$"
    b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
)


async def test_scan_clean_file_ok():
    result = await antivirus.scan_bytes(b"hello clean world" * 100)
    assert result.clean is True
    assert result.signature is None


async def test_scan_eicar_detected():
    result = await antivirus.scan_bytes(b"prefix " + EICAR + b" suffix")
    assert result.clean is False
    assert result.signature and "Eicar" in result.signature


async def test_scan_unavailable_raises(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "clamav_port", 1)  # پورت مرده
    with pytest.raises(antivirus.AntivirusUnavailable):
        await antivirus.scan_bytes(b"data")


async def test_policy_fail_closed_when_scanner_down(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "clamav_port", 1)
    monkeypatch.setattr(s, "clamav_allow_insecure_dev_bypass", False)
    with pytest.raises(APIError) as ei:
        await antivirus.scan_upload_or_reject(b"data", filename="x.bin")
    assert ei.value.status_code == 503
    assert ei.value.code == "antivirus_unavailable"


async def test_policy_fail_closed_in_production_even_with_bypass_flag(monkeypatch):
    """پرچم بای‌پس در production هیچ اثری ندارد — fail-closed می‌ماند."""
    s = get_settings()
    monkeypatch.setattr(s, "clamav_port", 1)
    monkeypatch.setattr(s, "clamav_allow_insecure_dev_bypass", True)
    monkeypatch.setattr(s, "app_env", "production")
    assert antivirus.bypass_active() is False
    with pytest.raises(APIError) as ei:
        await antivirus.scan_upload_or_reject(b"data", filename="x.bin")
    assert ei.value.code == "antivirus_unavailable"


async def test_policy_dev_bypass_is_explicit_and_loud(monkeypatch, caplog):
    s = get_settings()
    monkeypatch.setattr(s, "clamav_port", 1)
    monkeypatch.setattr(s, "clamav_allow_insecure_dev_bypass", True)
    monkeypatch.setattr(s, "app_env", "dev")
    assert antivirus.bypass_active() is True
    with caplog.at_level(logging.CRITICAL, logger="app.core.antivirus"):
        result = await antivirus.scan_upload_or_reject(b"data", filename="x.bin")
    assert result.clean is True
    assert any("BYPASS ACTIVE" in r.message for r in caplog.records)


async def test_policy_infected_raises_422():
    with pytest.raises(APIError) as ei:
        await antivirus.scan_upload_or_reject(EICAR, filename="evil.bin")
    assert ei.value.status_code == 422
    assert ei.value.code == "file_infected"
    assert "Eicar" in (ei.value.details.get("signature") or "")


# ---------------------------------------------------------------------------
# مسیر کامل: آپلود کتابخانه با EICAR → رد + ممیزی؛ پاک → موفق
# ---------------------------------------------------------------------------


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _library_admin(tc):
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        role = Role(name=f"av_role_{suffix}", description="av test")
        db.add(role)
        await db.flush()
        perm = (
            await db.execute(
                select(Permission).where(Permission.key == "library.manage")
            )
        ).scalar_one_or_none()
        if perm is None:
            perm = Permission(key="library.manage", description="library.manage")
            db.add(perm)
            await db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
        user = User(
            full_name="مدیر کتابخانه",
            email=f"av-{suffix}@example.com",
            phone=f"+98912{_uid()[:7]}",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


async def test_library_upload_eicar_rejected_with_audit(tc):
    import json

    headers = await _library_admin(tc)
    meta = {
        "kind": "audio",
        "title": {"fa": "فایل آلوده"},
        "visibility": "registered",
    }
    # پسوند/محتوای صوتیِ ظاهراً معتبر ولی حاوی EICAR در میانهٔ بایت‌ها
    content = b"ID3" + b"\x00" * 32 + EICAR + b"\x00" * 32
    r = await tc["client"].post(
        "/api/v1/admin/library/items",
        headers=headers,
        data={"metadata": json.dumps(meta)},
        files={"file": ("lecture.mp3", content, "audio/mpeg")},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "file_infected"

    from app.models.models import AuditLog

    async with tc["maker"]() as db:
        rows = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.action == "library.upload_rejected_infected"
                )
            )
        ).scalars().all()
        assert rows, "ردِّ آلوده باید ممیزی شده باشد"
        assert rows[-1].new_values.get("signature")


async def test_library_upload_clean_passes_scan(tc):
    import json

    headers = await _library_admin(tc)
    meta = {
        "kind": "audio",
        "title": {"fa": "فایل پاک"},
        "visibility": "registered",
    }
    content = b"ID3" + b"\x00" * 64 + b"clean audio bytes"
    r = await tc["client"].post(
        "/api/v1/admin/library/items",
        headers=headers,
        data={"metadata": json.dumps(meta)},
        files={"file": ("lecture.mp3", content, "audio/mpeg")},
    )
    assert r.status_code == 201, r.text
