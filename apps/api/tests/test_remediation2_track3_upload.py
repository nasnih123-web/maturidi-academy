"""تست‌های Track 3 — remediation pass 2 (§۱۹): امنیت آپلود فایل کتابخانه.

- PDF با جاوااسکریپت جاسازی‌شده باید رد شود (قرارداد §۷: «بدون اجرای
  JavaScript جاسازی‌شده») — fail-before: پیش از اصلاح پذیرفته می‌شد.
- PDF سالم پذیرفته می‌شود (بدون false-positive روی محتوای عادی).
- سقف حجم پیش از بار کامل در RAM اعمال می‌شود (۴۱۳) — رگرسیون رفتار pass-1.
"""
from __future__ import annotations

import json
import uuid

from sqlalchemy import select

BASE = "/api/v1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_admin(tc):
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        p = (
            await db.execute(select(Permission).where(Permission.key == "library.manage"))
        ).scalar_one_or_none()
        if p is None:
            p = Permission(key="library.manage", description="library test")
            db.add(p)
            await db.flush()
        role = Role(name=f"t3_lib_role_{suffix}", description="t3")
        db.add(role)
        await db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="ادمین ترک۳",
            email=f"t3lib-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        token = create_access_token(str(user.id))
    return {"Authorization": f"Bearer {token}"}


def _meta(kind: str = "pdf") -> dict:
    return {
        "kind": kind,
        "title": {"fa": "سند تست", "ar": "مستند", "en": "Doc"},
        "description": {"fa": "توضیح", "ar": "وصف", "en": "Desc"},
        "topic_tags": ["test"],
        "visibility": "registered",
    }


async def _upload(client, headers, filename: str, content: bytes, kind: str = "pdf"):
    files = {"file": (filename, content, "application/octet-stream")}
    return await client.post(
        f"{BASE}/admin/library/items",
        data={"metadata": json.dumps(_meta(kind))},
        files=files,
        headers=headers,
    )


CLEAN_PDF = (
    b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\n"
    b"endobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n"
    b"trailer\n<< /Root 1 0 R >>\n%%EOF"
)

JS_PDF = (
    b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R "
    b"/OpenAction << /S /JavaScript /JS (app.alert('xss')) >> >>\nendobj\n"
    b"trailer\n<< /Root 1 0 R >>\n%%EOF"
)

JS_ABBR_PDF = (
    b"%PDF-1.4\n1 0 obj\n<< /S /JS /JS (this.print()) >>\nendobj\n"
    b"trailer\n<< /Root 1 0 R >>\n%%EOF"
)


async def test_clean_pdf_is_accepted(tc):
    """PDF سالم: پذیرفته می‌شود (بدون false-positive)."""
    headers = await _make_admin(tc)
    r = await _upload(tc["client"], headers, "book.pdf", CLEAN_PDF)
    assert r.status_code == 201, r.text


async def test_pdf_with_embedded_javascript_is_rejected(tc):
    """PDF با /JavaScript جاسازی‌شده: رد می‌شود (§۷) — نه ذخیره، نه ۲۰۱."""
    headers = await _make_admin(tc)
    r = await _upload(tc["client"], headers, "evil.pdf", JS_PDF)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "pdf_active_content"


async def test_pdf_with_js_abbreviation_is_rejected(tc):
    """/JS (مخفف JavaScript در PDF): رد می‌شود."""
    headers = await _make_admin(tc)
    r = await _upload(tc["client"], headers, "evil2.pdf", JS_ABBR_PDF)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "pdf_active_content"


async def test_oversize_upload_rejected_before_full_read(tc):
    """فایل بزرگ‌تر از سقف نوع: ۴۱۳ پیش از پردازش (رگرسیون pass-1)."""
    headers = await _make_admin(tc)
    big = b"%PDF-1.4\n" + b"x" * (101 * 1024 * 1024)  # ۱۰۱MB > سقف ۱۰۰MB نوع pdf
    r = await _upload(tc["client"], headers, "big.pdf", big)
    assert r.status_code == 413, r.text[:200]
