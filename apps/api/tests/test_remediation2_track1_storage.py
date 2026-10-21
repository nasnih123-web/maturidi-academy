"""تست‌های Track 1 (final remediation) — ذخیره‌سازی و فایل‌ها (§۱۲، §§۱۷).

یافته‌ها: ۱) endpoint عمومی/داخلی MinIO برای presigned URL، ۲) ساخت bucket
در deploy تازه، ۳) اسکریپت backup.sh و مستندات restore، ۴) enforcement
provider در startup، ۷) صداقت اعتبارسنجی PDF، ۸) نگهبان S3/secrets.

قرارداد صداقت: امضای presigned در minio-py وقتی region داده شده باشد
خالصاً محلی است (بدون حتی یک پکت شبکه) — این تست‌ها منطق انتخاب endpoint
و رفتار امضا را ثابت می‌کنند، نه اتصال واقعی به MinIO (نیازمند docker؛
Blocked). لبهٔ شبکه (bucket_exists/make_bucket) با stub در سطح کلاینت
پوشش داده می‌شود؛ منطق idempotency و ترجمهٔ خطا واقعی تست می‌شود.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from urllib.parse import urlparse

import pytest

REPO = Path(__file__).resolve().parents[3]

GOOD_JWT = "x7K9mQ2vT5pL8nR4sW6uY3zA1bC0dEf2"
GOOD_ENC = "k4M8nB2vC6xZ1aS5dF9gH3jK7lP0oQwE"
GOOD_S3_SECRET = "unit-test-only-fake-secret-00000"


@pytest.fixture()
def _isolated_settings(monkeypatch, tmp_path):
    """env ایزوله برای get_settings (کش lru پاک می‌شود)."""
    from app.core.config import get_settings

    monkeypatch.chdir(tmp_path)  # بدون .env — فقط env واقعی خوانده شود
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _prod_s3_env(monkeypatch, **overrides):
    """env شبه-production معتبر برای S3؛ overrideها برای کیس‌های منفی."""
    from app.core.config import get_settings

    env = {
        "APP_ENV": "production",
        "APP_BASE_URL": "https://api.example.com",
        "JWT_SECRET": GOOD_JWT,
        "ENCRYPTION_KEY": GOOD_ENC,
        "STORAGE_PROVIDER": "s3",
        "S3_ENDPOINT": "http://minio:9000",
        "S3_ENDPOINT_PUBLIC": "https://files.maturidi.academy",
        "S3_ACCESS_KEY": "maturidi-app",
        "S3_SECRET_KEY": GOOD_S3_SECRET,
        "S3_BUCKET": "maturidi-media",
        "S3_REGION": "us-east-1",
    }
    env.update(overrides)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    return get_settings()


# ------------------------------------------------- یافتهٔ ۱: endpoint عمومی/داخلی

async def test_presigned_url_uses_public_endpoint(_isolated_settings, monkeypatch):
    """هاست presigned URL باید endpoint عمومی باشد، نه داخلی (minio:9000)."""
    from app.core.storage import S3StorageProvider

    provider = S3StorageProvider(
        endpoint="http://minio:9000",
        endpoint_public="https://files.example.com",
        access_key="user",
        secret_key="secret",
        bucket="maturidi-media",
        region="us-east-1",
    )
    url = await provider.get_presigned_url("library/abc.pdf", expires_seconds=300)
    host = urlparse(url).hostname
    assert host == "files.example.com", f"presigned host leaked internal address: {url}"
    assert "minio" not in url
    assert "X-Amz-Signature=" in url and "X-Amz-Expires=300" in url


async def test_presigned_url_never_contains_internal_hostname(
    _isolated_settings, monkeypatch
):
    """تضمین صریح: هیچ‌وقت هاست داخلی (minio/localhost/...) به مرورگر نشت نمی‌کند."""
    from app.core.storage import S3StorageProvider

    for internal in ("http://minio:9000", "http://localhost:9000"):
        provider = S3StorageProvider(
            endpoint=internal,
            endpoint_public="https://cdn.example.net",
            access_key="user",
            secret_key="secret",
            bucket="bkt",
            region="us-east-1",
        )
        url = await provider.get_presigned_url("k/x.pdf")
        parsed = urlparse(url)
        assert parsed.hostname == "cdn.example.net"
        assert "minio" not in url and "localhost" not in url


async def test_internal_only_config_preserves_dev_behavior(_isolated_settings):
    """بدون endpoint_public (dev/تک‌هاست): رفتار قبلی حفظ می‌شود."""
    from app.core.storage import S3StorageProvider

    provider = S3StorageProvider(
        endpoint="http://localhost:9000",
        access_key="user",
        secret_key="secret",
        bucket="bkt",
        region="us-east-1",
    )
    url = await provider.get_presigned_url("k/x.pdf")
    assert urlparse(url).hostname == "localhost"
    assert provider.endpoint_public == "http://localhost:9000"


def test_prod_rejects_internal_presigned_host_without_public(
    _isolated_settings, monkeypatch
):
    """production + S3_ENDPOINT داخلی + بدون S3_ENDPOINT_PUBLIC → فیل بلند."""
    from app.core.storage import get_storage

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("STORAGE_PROVIDER", "s3")
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.delenv("S3_ENDPOINT_PUBLIC", raising=False)
    monkeypatch.setenv("S3_ACCESS_KEY", "maturidi-app")
    monkeypatch.setenv("S3_SECRET_KEY", GOOD_S3_SECRET)
    monkeypatch.setenv("S3_BUCKET", "maturidi-media")
    with pytest.raises(RuntimeError, match="S3_ENDPOINT_PUBLIC"):
        get_storage()


def test_prod_accepts_public_endpoint(_isolated_settings, monkeypatch):
    """production + public صریح و مرورگر-قابل‌دسترس → OK."""
    from app.core.storage import S3StorageProvider, get_storage

    _prod_s3_env(monkeypatch)
    provider = get_storage()
    assert isinstance(provider, S3StorageProvider)
    assert provider.endpoint_public == "https://files.maturidi.academy"


def test_get_storage_accepts_minio_alias(_isolated_settings, monkeypatch):
    """STORAGE_PROVIDER=minio نام مستعار s3 است."""
    from app.core.storage import S3StorageProvider, get_storage

    monkeypatch.setenv("STORAGE_PROVIDER", "minio")
    monkeypatch.setenv("S3_ENDPOINT", "http://localhost:9000")
    monkeypatch.setenv("S3_ACCESS_KEY", "user")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_BUCKET", "bkt")
    assert isinstance(get_storage(), S3StorageProvider)


# ------------------------------------------------- یافتهٔ ۲: ساخت bucket

class _StubClient:
    """stub در سطح کلاینت minio — منطق ensure_bucket واقعی تست می‌شود؛
    خودِ HTTP به MinIO واقعی نیاز دارد (Blocked: بدون docker daemon)."""

    def __init__(self, exists: bool = False, error: Exception | None = None):
        self._exists = exists
        self._error = error
        self.make_bucket_calls: list[str] = []

    def bucket_exists(self, bucket: str) -> bool:
        if self._error is not None:
            raise self._error
        return self._exists

    def make_bucket(self, bucket: str) -> None:
        self.make_bucket_calls.append(bucket)


def _s3_provider_with_stub(monkeypatch, stub) -> object:
    from app.core.storage import S3StorageProvider

    provider = S3StorageProvider(
        endpoint="http://minio:9000",
        endpoint_public="https://files.example.com",
        access_key="user",
        secret_key="secret",
        bucket="maturidi-media",
        region="us-east-1",
    )
    monkeypatch.setattr(provider, "_client", stub)
    return provider


def test_ensure_bucket_creates_when_missing(_isolated_settings, monkeypatch):
    stub = _StubClient(exists=False)
    provider = _s3_provider_with_stub(monkeypatch, stub)
    provider.ensure_bucket()
    assert stub.make_bucket_calls == ["maturidi-media"]


def test_ensure_bucket_skips_when_exists(_isolated_settings, monkeypatch):
    stub = _StubClient(exists=True)
    provider = _s3_provider_with_stub(monkeypatch, stub)
    provider.ensure_bucket()
    assert stub.make_bucket_calls == []


def test_ensure_bucket_loud_failure_on_unreachable(
    _isolated_settings, monkeypatch
):
    """خطای اتصال → RuntimeError صریح با endpoint؛ بدون نشت secret."""
    stub = _StubClient(error=ConnectionError("refused"))
    provider = _s3_provider_with_stub(monkeypatch, stub)
    with pytest.raises(RuntimeError, match="http://minio:9000") as exc_info:
        provider.ensure_bucket()
    assert "maturidi-media" in str(exc_info.value)
    assert "secret" not in str(exc_info.value).lower()


async def test_ensure_storage_ready_prod_fails_loud_on_unreachable(
    _isolated_settings, monkeypatch
):
    """یافتهٔ ۴: در production با MinIOِ در دسترس‌نبودن، startup فیل می‌شود."""
    from app.core import storage as storage_mod

    settings = _prod_s3_env(monkeypatch)
    stub = _StubClient(error=ConnectionError("refused"))
    provider = _s3_provider_with_stub(monkeypatch, stub)
    monkeypatch.setattr(storage_mod, "get_storage", lambda: provider)
    # مسیر شبکه‌ای ensure_storage_ready در تست skip می‌شود؛ برای این تست
    # صریحاً فعالش می‌کنیم تا رفتار production واقعی تست شود.
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    with pytest.raises(RuntimeError, match="[Ss]torage backend unreachable|unreachable"):
        await storage_mod.ensure_storage_ready(settings)


async def test_ensure_storage_ready_dev_skips_network(_isolated_settings, monkeypatch):
    """در dev بدون MinIO هم startup نباید به شبکه دست بزند."""
    from app.core import storage as storage_mod
    from app.core.config import get_settings

    monkeypatch.setenv("STORAGE_PROVIDER", "s3")
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("S3_ACCESS_KEY", "user")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_BUCKET", "bkt")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.is_dev

    stub = _StubClient(error=ConnectionError("must not be called in dev"))
    provider = _s3_provider_with_stub(monkeypatch, stub)
    monkeypatch.setattr(storage_mod, "get_storage", lambda: provider)
    result = await storage_mod.ensure_storage_ready(settings)
    assert result is provider  # بدون هیچ فراخوانی شبکه‌ای


def test_lifespan_calls_ensure_storage_ready():
    """قرارداد استاتیک: lifespan اپ چک storage را در startup اجرا می‌کند."""
    text = (REPO / "apps" / "api" / "app" / "main.py").read_text(encoding="utf-8")
    assert "await ensure_storage_ready(" in text
    assert "from app.core.storage import" in text and "ensure_storage_ready" in text


# ------------------------------------------------- یافتهٔ ۳: backup.sh و restore

def test_backup_script_bash_syntax():
    assert subprocess.run(
        ["bash", "-n", str(REPO / "infra" / "backup.sh")],
        capture_output=True,
        check=False,  # returncode در همان assert بررسی می‌شود
    ).returncode == 0


def _backup_text() -> str:
    return (REPO / "infra" / "backup.sh").read_text(encoding="utf-8")


def test_backup_script_requires_env_credentials():
    """هیچ هاردکدی نیست؛ نبود هر اعتبار = فیل بلند با پیام روشن."""
    text = _backup_text()
    for var in (
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_DB",
        "MINIO_ROOT_USER",
        "MINIO_ROOT_PASSWORD",
        "S3_BUCKET",
    ):
        assert f': "${{{var}:?' in text, f"{var} is not a required env var"
    assert "POSTGRES_USER:-maturidi" not in text
    assert "POSTGRES_DB:-maturidi" not in text


def test_backup_script_uses_compose_file_everywhere():
    """هر فراخوانی docker compose باید همان COMPOSE_FILE انتخاب‌شده را بگیرد."""
    text = _backup_text()
    # همهٔ فراخوانی‌ها از متغیر DC می‌آیند که -f "$COMPOSE_FILE" را دارد؛
    # هیچ فراخوانی مستقیمی نباید باشد.
    assert 'DC="docker compose -f $COMPOSE_FILE"' in text
    for i, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("#") or "DC=" in line:
            continue
        assert "docker compose" not in line, f"line {i}: bare docker compose call"


def test_backup_script_no_swallowed_failures():
    """هیچ مرحله‌ای نباید با || echo/|| true ساکت رد شود."""
    text = _backup_text()
    assert "|| echo" not in text
    assert "|| true" not in text
    assert "2>/dev/null" not in text
    assert text.count("|| fail") >= 4, "every step must fail loudly on error"


def test_backup_minio_mirror_uses_real_mc():
    """mirror باید با کانتینر mc واقعی باشد، نه exec روی ایمیج سرور minio
    (که دستور mc ندارد و همیشه ساکت فیل می‌شد)."""
    text = _backup_text()
    assert "quay.io/minio/mc:" in text
    assert "run --rm" in text
    assert "mc mirror" in text
    assert "exec -T minio" not in text


def test_backup_pg_dump_passes_password():
    """pg_dump باید رمز را بگیرد (بدون آن روی postgres واقعی فیل می‌شود)."""
    assert 'PGPASSWORD="$POSTGRES_PASSWORD"' in _backup_text() or \
        "PGPASSWORD=$POSTGRES_PASSWORD" in _backup_text()


def test_dr_doc_minio_restore_uses_mc_container():
    """مستندات restore نباید الگوی خراب exec روی سرویس minio را داشته باشد."""
    for rel in ("docs/ops/disaster-recovery.md", "docs/operations/runbook.md"):
        text = (REPO / rel).read_text(encoding="utf-8")
        assert "exec -T minio" not in text, f"{rel}: broken mc pattern still present"
        assert "quay.io/minio/mc:" in text, f"{rel}: no real mc container"


def test_backup_success_reported_only_on_success():
    """پیام موفقیت نهایی فقط در انتهای مسیر موفق معنا دارد."""
    text = _backup_text()
    assert "all 4 steps succeeded" in text
    # set -euo pipefail: هر خطای چک‌نشده = خروج غیرصفر
    assert text.startswith("#!") and "set -euo pipefail" in text


# ------------------------------------------------- یافتهٔ ۴: enforcement در startup (مستندسازی)

def test_storage_doc_documents_startup_contract():
    text = (REPO / "docs" / "ops" / "storage.md").read_text(encoding="utf-8")
    assert "ensure_storage_ready" in text
    assert "S3_ENDPOINT_PUBLIC" in text
    assert "fail-fast" in text or "فیل" in text


# ------------------------------------------------- یافتهٔ ۷: صداقت اعتبارسنجی PDF

def _minimal_pdf(extra: bytes = b"") -> bytes:
    return b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" + extra + b"\n%%EOF"


def test_pdf_js_rejected_without_scan_claims():
    """PDF حاوی /JavaScript → 422؛ پیام هیچ ادعای «اسکن کامل» ندارد."""
    from app.core.errors import APIError
    from app.modules.library.service import _validate_upload

    evil = _minimal_pdf(b"<< /S /JavaScript /JS (alert(1)) >>")
    with pytest.raises(APIError) as exc_info:
        _validate_upload("pdf", "evil.pdf", evil)
    err = exc_info.value
    assert err.status_code == 422
    assert err.code == "pdf_active_content"
    assert "اسکن" not in err.message  # هیچ ادعای اسکنی در پیام نیست


def test_pdf_openaction_limitation_is_documented():
    """محدودهٔ صادقانه: /OpenAction بدون /JavaScript پذیرفته می‌شود (عمداً،
    برای جلوگیری از false-positive) — این محدودیت در کد و مستندات تصریح
    شده، نه پنهان."""
    from app.modules.library.service import _validate_upload

    ext, mime = _validate_upload("pdf", "doc.pdf", _minimal_pdf(b"/OpenAction 1 0 R"))
    assert ext == ".pdf" and mime == "application/pdf"


def test_pdf_limitation_stated_in_code():
    text = (
        REPO / "apps" / "api" / "app" / "modules" / "library" / "service.py"
    ).read_text(encoding="utf-8")
    assert "ClamAV" in text
    assert "EmbeddedFiles" in text or "فایل‌های جاسازی‌شده" in text


# ------------------------------------------------- یافتهٔ ۸: نگهبان S3/secrets

def test_prod_rejects_placeholder_s3_settings(_isolated_settings, monkeypatch):
    """هرکدام از این‌ها در production باید بوت را فیل کند."""
    from app.core.config import assert_production_secrets_ok

    cases = {
        "changeme-pattern secret": {"S3_SECRET_KEY": "CHANGE_ME__generate_a_random_secret"},
        "short secret key": {"S3_SECRET_KEY": "tooshort123"},
        "weak access key": {"S3_ACCESS_KEY": "minioadmin"},
        "localhost endpoint": {"S3_ENDPOINT": "http://localhost:9000"},
        "example.com endpoint": {"S3_ENDPOINT": "https://files.example.com"},
        "placeholder bucket": {"S3_BUCKET": "example-bucket"},
        "internal host leaking to browser": {
            "S3_ENDPOINT": "http://minio:9000",
            "S3_ENDPOINT_PUBLIC": "",
        },
    }
    for overrides in cases.values():
        _prod_s3_env(monkeypatch, **overrides)
        with pytest.raises(RuntimeError):
            assert_production_secrets_ok()


def test_prod_accepts_sane_s3_settings(_isolated_settings, monkeypatch):
    """کنترل مثبت: config سالم production نباید فیل شود."""
    from app.core.config import assert_production_secrets_ok

    _prod_s3_env(monkeypatch)
    assert_production_secrets_ok()  # raise نکند


def test_dev_skips_s3_guard(_isolated_settings, monkeypatch):
    """در dev همان مقادیر نمایشی نباید مانع بوت شوند."""
    from app.core.config import assert_production_secrets_ok, get_settings

    monkeypatch.setenv("STORAGE_PROVIDER", "s3")  # APP_ENV پیش‌فرض dev است
    get_settings.cache_clear()
    assert_production_secrets_ok()  # raise نکند
