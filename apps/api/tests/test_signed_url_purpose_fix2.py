"""FIX2-08 — امضای URL دانلود باید به منظور (purpose) گره بخورد.

باگ: HMAC فقط روی (key, exp) بود و endpoint گواهی
(/lms/certificates/download-by-ref) هر امضای معتبر را برای هر کلیدی
می‌پذیرفت — بدون بررسی رکورد دیتابیس. URL صادرشده برای فایل
کتابخانه، دانلود «گواهی» می‌شد و هر کلیدی با یک امضای معتبر از هر
جریانی قابل خواندن بود.

قرارداد جدید (ADR-0047):
- امضا روی (purpose, key, exp)؛ هر endpoint فقط هم‌منظور خودش را
  می‌پذیرد (library ≠ lms-certificate ≠ generic).
- endpoint گواهی علاوه بر امضا، وجود رکورد Certificate با همان
  pdf_storage_ref را هم بررسی می‌کند.
"""
from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import delete

from app.core.config import get_settings
from app.core.storage import (
    SIGNED_PURPOSE_CERTIFICATE,
    SIGNED_PURPOSE_GENERIC,
    SIGNED_PURPOSE_LIBRARY,
    LocalStorageProvider,
)
from app.models.models import Certificate, Course, User

_PDF = b"%PDF-1.4 fix2 fake certificate bytes"
_KEY = "certificates/FIX2-CERT.pdf"


@pytest.fixture()
def _local_storage(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "storage_provider", "local")
    monkeypatch.setattr(settings, "storage_local_dir", str(tmp_path))
    return LocalStorageProvider(str(tmp_path))


async def _params(provider: LocalStorageProvider, key: str, purpose: str) -> dict:
    url = await provider.get_presigned_url(key, purpose=purpose)
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


async def test_verify_accepts_only_matching_purpose(_local_storage):
    provider = _local_storage
    params = await _params(provider, _KEY, SIGNED_PURPOSE_LIBRARY)
    exp, sig = int(params["exp"]), params["sig"]
    assert provider.verify_download_sig(_KEY, exp, sig, SIGNED_PURPOSE_LIBRARY)
    assert not provider.verify_download_sig(
        _KEY, exp, sig, SIGNED_PURPOSE_CERTIFICATE
    )
    assert not provider.verify_download_sig(_KEY, exp, sig, SIGNED_PURPOSE_GENERIC)
    assert not provider.verify_download_sig(_KEY, exp, sig, "library2")
    # دست‌کاری purpose در URL امضا را باطل می‌کند، چون داخل HMAC است
    assert params["purpose"] == SIGNED_PURPOSE_LIBRARY


async def _make_certificate(tc, key: str = _KEY) -> str:
    suffix = uuid.uuid4().hex[:8]
    async with tc["maker"]() as db:
        user = User(
            full_name="دارندهٔ گواهی تست",
            email=f"fix2-{suffix}@example.com",
            phone=f"+98911{suffix[:7]}",
            password_hash="x",
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        course = Course(title={"fa": "دورهٔ تست گواهی"})
        db.add(course)
        await db.flush()
        code = f"FIX2-{suffix.upper()}"
        cert = Certificate(
            user_id=user.id, course_id=course.id, code=code,
            pdf_storage_ref=key,
        )
        db.add(cert)
        await db.commit()
    return code


@pytest.fixture(autouse=True)
async def _cleanup(tc):
    yield
    async with tc["maker"]() as db:
        await db.execute(
            delete(Certificate).where(Certificate.code.like("FIX2-%"))
        )
        await db.commit()


async def test_certificate_download_by_ref_happy_path(tc, _local_storage):
    await _make_certificate(tc)
    await _local_storage.put_object(_KEY, _PDF, "application/pdf")
    params = await _params(_local_storage, _KEY, SIGNED_PURPOSE_CERTIFICATE)
    r = await tc["client"].get(
        "/api/v1/lms/certificates/download-by-ref", params=params
    )
    assert r.status_code == 200, r.text
    assert r.content == _PDF


async def test_certificate_endpoint_rejects_library_purpose_signature(
    tc, _local_storage
):
    """تست منفی اصلی FIX2-08: امضای معتبرِ منظور دیگر این‌جا کار نمی‌کند."""
    await _make_certificate(tc)
    await _local_storage.put_object(_KEY, _PDF, "application/pdf")
    params = await _params(_local_storage, _KEY, SIGNED_PURPOSE_LIBRARY)
    r = await tc["client"].get(
        "/api/v1/lms/certificates/download-by-ref", params=params
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "invalid_signature"


async def test_certificate_endpoint_rejects_unrecorded_key(tc, _local_storage):
    """امضای هم‌منظور برای کلیدی که گواهیِ ثبت‌شده نیست → ۴۰۴."""
    ghost = "certificates/GHOST.pdf"
    await _local_storage.put_object(ghost, _PDF, "application/pdf")
    params = await _params(_local_storage, ghost, SIGNED_PURPOSE_CERTIFICATE)
    r = await tc["client"].get(
        "/api/v1/lms/certificates/download-by-ref", params=params
    )
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "certificate_not_found"


async def test_library_endpoint_rejects_certificate_purpose(tc, _local_storage):
    lib_key = "library/fix2/book.pdf"
    await _local_storage.put_object(lib_key, _PDF, "application/pdf")
    params = await _params(_local_storage, lib_key, SIGNED_PURPOSE_CERTIFICATE)
    r = await tc["client"].get("/api/v1/library/download-by-ref", params=params)
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "invalid_signature"
