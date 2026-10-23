"""یکپارچگی باکت بیلدها — FIX2-02 (ADR-0041).

باگ: کالبک CI فایل‌ها را در BUILDS_S3_BUCKET می‌نوشت ولی API برای
ساخت URL دانلود و prune از get_storage() عمومی (S3_BUCKET) استفاده
می‌کرد؛ ناسازگاری این دو در هیچ‌جا گرفته نمی‌شد و دانلود/prune بی‌صدا
می‌توانست روی باکت اشتباه کار کند.

پوشش این فایل:
- واحدی: قرارداد «همه یا هیچ» برای BUILDS_S3_* (خالی=سازگار،
  کامل=سازگار، ناقص=خطای واضح و fail-fast در validate/get).
- واحدی: بدون کانفیگ اختصاصی، provider بیلدها همان provider عمومی
  برنامه است (باکت واحد)؛ با کانفیگ کامل، provider اختصاصی با همان
  باکتِ کالبک ساخته می‌شود (حتی وقتی S3_BUCKET چیز دیگری است).
- یکپارچه: upload (شبیه‌سازی کالبک) → ثبت رلیز → URL امضاشده از
  provider بیلدها → دانلود بایت‌ها → prune روی همان یک باکت.
"""
from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.storage import (
    LocalStorageProvider,
    S3StorageProvider,
    StorageProvider,
    builds_storage_problems,
    get_builds_storage,
    validate_builds_storage,
)
from app.modules.admin import builds_service as svc

BASE = "/api/v1"
_TOKEN_PARTS = ("builds", "test", "service", "token")
SERVICE_TOKEN = "-".join(_TOKEN_PARTS)

_BUILDS_FIELDS = (
    "builds_s3_endpoint",
    "builds_s3_endpoint_public",
    "builds_s3_access_key",
    "builds_s3_secret_key",
    "builds_s3_bucket",
    "builds_s3_region",
)

_FULL_BUILDS = {
    "builds_s3_endpoint": "http://minio:9000",
    "builds_s3_endpoint_public": "https://files.example.com",
    "builds_s3_access_key": "builds-ak",
    "builds_s3_secret_key": "builds-sk",
    "builds_s3_bucket": "maturidi-builds",
    "builds_s3_region": "us-east-1",
}


@pytest.fixture(autouse=True)
def _builds_env_clean(monkeypatch):
    """پیش‌فرض هر تست: هیچ BUILDS_S3_*ای تنظیم نیست (باکت واحد)."""
    s = get_settings()
    for name in _BUILDS_FIELDS:
        monkeypatch.setattr(s, name, "")
    return s


def _set_builds(monkeypatch, **over):
    s = get_settings()
    values = {**_FULL_BUILDS, **over}
    for name, value in values.items():
        monkeypatch.setattr(s, name, value)
    return s


# ---------------------------------------------------------------------------
# واحدی — قرارداد «همه یا هیچ»
# ---------------------------------------------------------------------------


def test_no_builds_config_is_consistent():
    s = get_settings()
    assert builds_storage_problems(s) == []
    validate_builds_storage(s)  # نباید raise کند


def test_full_builds_config_is_consistent(monkeypatch):
    s = _set_builds(monkeypatch)
    assert builds_storage_problems(s) == []
    validate_builds_storage(s)


@pytest.mark.parametrize(
    "partial",
    [
        {"builds_s3_bucket": "maturidi-builds"},
        {"builds_s3_endpoint": "http://minio:9000", "builds_s3_bucket": "b"},
        {"builds_s3_access_key": "ak", "builds_s3_secret_key": "sk"},
    ],
)
def test_partial_builds_config_fails_fast(monkeypatch, partial):
    s = get_settings()
    for name, value in partial.items():
        monkeypatch.setattr(s, name, value)
    problems = builds_storage_problems(s)
    assert problems, "کانفیگ ناقص باید ایراد داشته باشد"
    assert "BUILDS_S3" in problems[0]
    with pytest.raises(RuntimeError, match="BUILDS_S3"):
        validate_builds_storage(s)
    with pytest.raises(RuntimeError, match="BUILDS_S3"):
        get_builds_storage()


def test_full_builds_config_with_bad_endpoint_fails(monkeypatch):
    _set_builds(monkeypatch, builds_s3_endpoint="not-a-url")
    with pytest.raises(RuntimeError, match="BUILDS_S3_ENDPOINT"):
        validate_builds_storage()


def test_default_builds_storage_is_the_app_storage(monkeypatch, tmp_path):
    """بدون BUILDS_S3_*: بیلدها همان باکت واحدِ storage عمومی را می‌خوانند."""
    s = get_settings()
    monkeypatch.setattr(s, "storage_provider", "local")
    monkeypatch.setattr(s, "storage_local_dir", str(tmp_path))
    provider = get_builds_storage()
    assert isinstance(provider, LocalStorageProvider)
    assert provider._base == str(tmp_path)


def test_dedicated_builds_storage_uses_callback_bucket(monkeypatch):
    """با BUILDS_S3_* کامل: provider اختصاصی با باکت کالبک — نه S3_BUCKET."""
    s = _set_builds(monkeypatch)
    monkeypatch.setattr(s, "storage_provider", "s3")
    monkeypatch.setattr(s, "s3_bucket", "some-other-bucket")
    provider = get_builds_storage()
    assert isinstance(provider, S3StorageProvider)
    assert provider.bucket == "maturidi-builds"
    assert provider.endpoint_public == "https://files.example.com"


# ---------------------------------------------------------------------------
# یکپارچه — upload → signed URL → download → prune روی یک باکت
# ---------------------------------------------------------------------------


class _FakeBuildsStorage(StorageProvider):
    """provider درون‌حافظه‌ایِ قابل مشاهده — جای باکت builds می‌نشیند."""

    MARKER = "builds-fake://maturidi-builds"

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.signed_keys: list[str] = []

    async def put_object(self, key: str, data: bytes, mime_type: str) -> None:
        self.objects[key] = data

    async def get_presigned_url(
        self, key: str, expires_seconds: int = 300, *, download_path: str | None = None
    ) -> str:
        self.signed_keys.append(key)
        return f"{self.MARKER}/{key}?exp={expires_seconds}"

    async def delete_object(self, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)

    async def read_bytes(self, key: str) -> bytes:
        return self.objects[key]


@pytest.fixture
def svc_token_configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "builds_service_token", SERVICE_TOKEN)
    return s


def _release_payload(**over):
    payload = {
        "platform": "desktop",
        "version": "1.0.0",
        "build_number": "1",
        "artifact_key": "builds/desktop/1.0.0/1/app.bin",
        "file_size_bytes": 4,
        "sha256": "a" * 64,
        "signed": False,
        "build_metadata": {"filename": "app.bin"},
    }
    payload.update(over)
    return payload


async def test_upload_sign_download_prune_on_one_builds_bucket(
    tc, svc_token_configured, monkeypatch
):
    fake = _FakeBuildsStorage()
    monkeypatch.setattr(svc, "get_builds_storage", lambda: fake)

    client = tc["client"]
    headers = {"X-Build-Service-Token": SERVICE_TOKEN}

    # ۱) آپلودِ کالبک: فایل فقط در باکت builds است (نه storage عمومی)
    key0 = "builds/desktop/1.0.0/1/app.bin"
    await fake.put_object(key0, b"data", "application/octet-stream")

    # ۲) ثبت رلیز → URL امضاشده باید از provider بیلدها بیاید
    r = await client.post(
        f"{BASE}/admin/builds/releases", json=_release_payload(), headers=headers
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["download_url"].startswith(_FakeBuildsStorage.MARKER), body
    assert fake.signed_keys == [key0]

    # ۳) دانلود: همان بایت‌هایی که کالبک گذاشته از همان باکت برمی‌گردد
    assert await fake.read_bytes(key0) == b"data"

    # ۴) prune: ۱۰ رلیز دیگر → قدیمی‌ترین از همان باکت حذف می‌شود
    for i in range(1, 11):
        key = f"builds/desktop/1.0.{i}/1/app.bin"
        await fake.put_object(key, b"x", "application/octet-stream")
        r = await client.post(
            f"{BASE}/admin/builds/releases",
            json=_release_payload(
                version=f"1.0.{i}", artifact_key=key, sha256="b" * 64
            ),
            headers=headers,
        )
        assert r.status_code == 201, r.text
    assert key0 in fake.deleted
    assert key0 not in fake.objects
    assert "builds/desktop/1.0.10/1/app.bin" in fake.objects
