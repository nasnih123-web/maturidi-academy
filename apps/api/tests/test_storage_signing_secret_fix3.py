"""FIX3-02 — جداسازی راز امضای storage از JWT_SECRET (ADR-0049).

تا پیش از این fix ریشهٔ HMAC امضاهای دانلود همان jwt_secret بود:
نشت یکی از دو راز، هر دو سامانه را با هم می‌انداخت.

قرارداد جدید:
- امضا با راز اختصاصی STORAGE_SIGNING_SECRET؛ امضای ساخته‌شده با
  JWT_SECRET (با راز اختصاصی تنظیم‌شده) روی همهٔ endpointهای
  دانلود — از جمله certificates/download-by-ref — رد می‌شود.
- چرخش دوکلیده: STORAGE_SIGNING_SECRET_PREVIOUS در دورهٔ گذار فقط
  برای راستی‌آزمایی پذیرفته می‌شود؛ پس از حذفش، امضای قدیمی می‌میرد.
- نگهبان production: نبود/ضعف/برابری راز امضا با JWT یا ENCRYPTION
  یعنی امتناع از بوت؛ dev/test fallback انتقالی به JWT می‌ماند.
"""
from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import delete

from app.core.config import Settings, assert_production_secrets_ok, get_settings
from app.core.storage import (
    SIGNED_PURPOSE_CERTIFICATE,
    SIGNED_PURPOSE_LIBRARY,
    LocalStorageProvider,
)
from app.models.models import Certificate, Course, User

JWT = "jwt-secret-for-fix3-tests-0123456789abcdef"
DEDICATED = "storage-signing-secret-fix3-0123456789abcd"
DEDICATED_NEXT = "storage-signing-secret-fix3-next-012345678"
_PDF = b"%PDF-1.4 fix3 fake certificate bytes"
_KEY = "certificates/FIX3-CERT.pdf"


def _mint(secret: str, key: str, purpose: str, exp: int) -> str:
    msg = f"{purpose}:{key}:{exp}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


@pytest.fixture()
def _dedicated(monkeypatch, tmp_path):
    """provider محلی با راز اختصاصی تنظیم‌شده (و JWT معلوم و متفاوت)."""
    settings = get_settings()
    monkeypatch.setattr(settings, "storage_provider", "local")
    monkeypatch.setattr(settings, "storage_local_dir", str(tmp_path))
    monkeypatch.setattr(settings, "jwt_secret", JWT)
    monkeypatch.setattr(settings, "storage_signing_secret", DEDICATED)
    monkeypatch.setattr(settings, "storage_signing_secret_previous", "")
    return LocalStorageProvider(str(tmp_path))


async def _params(provider: LocalStorageProvider, key: str, purpose: str) -> dict:
    url = await provider.get_presigned_url(key, purpose=purpose)
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


# ------------------------------------------------------------ واحدی


async def test_sign_and_verify_with_dedicated_secret(_dedicated):
    params = await _params(_dedicated, _KEY, SIGNED_PURPOSE_CERTIFICATE)
    exp, sig = int(params["exp"]), params["sig"]
    assert _dedicated.verify_download_sig(
        _KEY, exp, sig, SIGNED_PURPOSE_CERTIFICATE
    )
    # امضا دقیقاً با راز اختصاصی ساخته شده، نه با JWT
    assert sig == _mint(DEDICATED, _KEY, SIGNED_PURPOSE_CERTIFICATE, exp)
    assert sig != _mint(JWT, _KEY, SIGNED_PURPOSE_CERTIFICATE, exp)


async def test_jwt_minted_signature_rejected(_dedicated):
    """تست منفی اصلی FIX3-02: ریشهٔ JWT دیگر هیچ اعتباری ندارد."""
    exp = int(time.time()) + 300
    sig = _mint(JWT, _KEY, SIGNED_PURPOSE_CERTIFICATE, exp)
    assert not _dedicated.verify_download_sig(
        _KEY, exp, sig, SIGNED_PURPOSE_CERTIFICATE
    )


async def test_expired_and_tampered_rejected(_dedicated):
    exp = int(time.time()) - 5
    sig = _mint(DEDICATED, _KEY, SIGNED_PURPOSE_CERTIFICATE, exp)
    assert not _dedicated.verify_download_sig(
        _KEY, exp, sig, SIGNED_PURPOSE_CERTIFICATE
    )
    exp = int(time.time()) + 300
    sig = _mint(DEDICATED, _KEY, SIGNED_PURPOSE_CERTIFICATE, exp)
    tampered = sig[:-1] + ("0" if sig[-1] != "0" else "1")
    assert not _dedicated.verify_download_sig(
        _KEY, exp, tampered, SIGNED_PURPOSE_CERTIFICATE
    )


# ------------------------------------------------- HTTP روی endpointها


async def _make_certificate(tc, key: str = _KEY) -> str:
    suffix = uuid.uuid4().hex[:8]
    async with tc["maker"]() as db:
        user = User(
            full_name="دارندهٔ گواهی تست ۳",
            email=f"fix3-{suffix}@example.com",
            phone=f"+98913{suffix[:7]}",
            password_hash="x",
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        course = Course(title={"fa": "دورهٔ تست گواهی ۳"})
        db.add(course)
        await db.flush()
        code = f"FIX3-{suffix.upper()}"
        db.add(
            Certificate(
                user_id=user.id, course_id=course.id, code=code,
                pdf_storage_ref=key,
            )
        )
        await db.commit()
    return code


@pytest.fixture(autouse=True)
async def _cleanup(tc):
    yield
    async with tc["maker"]() as db:
        await db.execute(
            delete(Certificate).where(Certificate.code.like("FIX3-%"))
        )
        await db.commit()


async def test_http_certificate_happy_path_dedicated_key(tc, _dedicated):
    await _make_certificate(tc)
    await _dedicated.put_object(_KEY, _PDF, "application/pdf")
    params = await _params(_dedicated, _KEY, SIGNED_PURPOSE_CERTIFICATE)
    r = await tc["client"].get(
        "/api/v1/lms/certificates/download-by-ref", params=params
    )
    assert r.status_code == 200, r.text
    assert r.content == _PDF


async def test_http_certificate_rejects_jwt_minted(tc, _dedicated):
    """امضای ساخته‌شده با JWT_SECRET روی endpoint گواهی → 403."""
    await _make_certificate(tc)
    await _dedicated.put_object(_KEY, _PDF, "application/pdf")
    exp = int(time.time()) + 300
    params = {
        "key": _KEY,
        "exp": exp,
        "sig": _mint(JWT, _KEY, SIGNED_PURPOSE_CERTIFICATE, exp),
        "purpose": SIGNED_PURPOSE_CERTIFICATE,
    }
    r = await tc["client"].get(
        "/api/v1/lms/certificates/download-by-ref", params=params
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "invalid_signature"


async def test_http_certificate_rejects_expired_and_tampered(tc, _dedicated):
    await _make_certificate(tc)
    await _dedicated.put_object(_KEY, _PDF, "application/pdf")
    past = int(time.time()) - 5
    r = await tc["client"].get(
        "/api/v1/lms/certificates/download-by-ref",
        params={
            "key": _KEY,
            "exp": past,
            "sig": _mint(DEDICATED, _KEY, SIGNED_PURPOSE_CERTIFICATE, past),
            "purpose": SIGNED_PURPOSE_CERTIFICATE,
        },
    )
    assert r.status_code == 403, r.text

    exp = int(time.time()) + 300
    good = _mint(DEDICATED, _KEY, SIGNED_PURPOSE_CERTIFICATE, exp)
    bad = good[:-1] + ("0" if good[-1] != "0" else "1")
    r = await tc["client"].get(
        "/api/v1/lms/certificates/download-by-ref",
        params={
            "key": _KEY, "exp": exp, "sig": bad,
            "purpose": SIGNED_PURPOSE_CERTIFICATE,
        },
    )
    assert r.status_code == 403, r.text


async def test_http_certificate_rejects_cross_purpose_dedicated(tc, _dedicated):
    """binding منظور (FIX2-08) زیر کلید تازه هم سر جایش است."""
    await _make_certificate(tc)
    await _dedicated.put_object(_KEY, _PDF, "application/pdf")
    params = await _params(_dedicated, _KEY, SIGNED_PURPOSE_LIBRARY)
    r = await tc["client"].get(
        "/api/v1/lms/certificates/download-by-ref", params=params
    )
    assert r.status_code == 403, r.text


async def test_http_library_rejects_jwt_minted(tc, _dedicated):
    lib_key = "library/fix3/book.pdf"
    await _dedicated.put_object(lib_key, _PDF, "application/pdf")
    exp = int(time.time()) + 300
    r = await tc["client"].get(
        "/api/v1/library/download-by-ref",
        params={
            "key": lib_key,
            "exp": exp,
            "sig": _mint(JWT, lib_key, SIGNED_PURPOSE_LIBRARY, exp),
            "purpose": SIGNED_PURPOSE_LIBRARY,
        },
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "invalid_signature"


# ------------------------------------------------------ چرخش دوکلیده


async def test_rotation_grace_then_reject(tc, _dedicated, monkeypatch):
    """URL صادرشده با کلید A: در پنجرهٔ گذار (B جاری، A قبلی) زنده
    می‌ماند؛ پس از حذف قبلی رد می‌شود. امضای تازه همیشه با جاری است."""
    await _make_certificate(tc)
    await _dedicated.put_object(_KEY, _PDF, "application/pdf")
    params = await _params(_dedicated, _KEY, SIGNED_PURPOSE_CERTIFICATE)

    settings = get_settings()
    monkeypatch.setattr(settings, "storage_signing_secret", DEDICATED_NEXT)
    monkeypatch.setattr(settings, "storage_signing_secret_previous", DEDICATED)

    r = await tc["client"].get(
        "/api/v1/lms/certificates/download-by-ref", params=params
    )
    assert r.status_code == 200, r.text  # پنجرهٔ گذار: قبلی پذیرفته می‌شود

    fresh = await _params(_dedicated, _KEY, SIGNED_PURPOSE_CERTIFICATE)
    exp = int(fresh["exp"])
    assert fresh["sig"] == _mint(
        DEDICATED_NEXT, _KEY, SIGNED_PURPOSE_CERTIFICATE, exp
    ), "امضای تازه باید با کلید جاری باشد، نه قبلی"

    monkeypatch.setattr(settings, "storage_signing_secret_previous", "")
    r = await tc["client"].get(
        "/api/v1/lms/certificates/download-by-ref", params=params
    )
    assert r.status_code == 403, r.text  # پایان گذار: امضای قدیمی مرده است


# ------------------------------------------------------- نگهبان بوت


def _prod_settings(**kw) -> Settings:
    base = {
        "app_env": "production",
        "jwt_secret": "j" * 64,
        "encryption_key": "k" * 64,
        "storage_signing_secret": "s" * 64,
        "app_base_url": "https://api.example.org",
    }
    base.update(kw)
    return Settings(**base)


def test_guard_requires_dedicated_signing_secret():
    with pytest.raises(RuntimeError) as ei:
        assert_production_secrets_ok(_prod_settings(storage_signing_secret=""))
    assert "storage_signing_secret" in str(ei.value)


def test_guard_rejects_signing_secret_reuse():
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(
            _prod_settings(storage_signing_secret="j" * 64)  # == jwt_secret
        )
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(
            _prod_settings(storage_signing_secret="k" * 64)  # == encryption_key
        )


def test_guard_rejects_weak_previous_and_accepts_strong():
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(
            _prod_settings(storage_signing_secret_previous="short")
        )
    with pytest.raises(RuntimeError):
        assert_production_secrets_ok(
            _prod_settings(storage_signing_secret_previous="s" * 64)
        )
    assert (
        assert_production_secrets_ok(
            _prod_settings(storage_signing_secret_previous="p" * 64)
        )
        is None
    )


def test_guard_dev_silent_without_signing_secret():
    s = Settings(app_env="dev")
    assert assert_production_secrets_ok(s) is None
