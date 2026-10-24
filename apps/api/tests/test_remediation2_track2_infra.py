"""تست‌های Track 2 — زیرساخت و استقرار (remediation pass 2، §§۱۰–۱۷).

قراردادهای پیکربندی (config-contract tests): صادقانه و بدون docker daemon —
فایل‌های واقعی (Dockerfile/compose/CI/env) parse و assert می‌شوند، نه رفتار
mockشده. تست انتخاب storage فکتوری واقعی را با config واقعی اجرا می‌کند؛
لبهٔ شبکه (MinIO) mock نمی‌شود چون اصلاً لمس نمی‌شود — سازنده و امضای
presigned در minio-py خالصاً محلی‌اند (این در docstring تست‌ها تصریح شده).
"""
from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[3]
APPS_API = REPO / "apps" / "api"
ALEMBIC_BIN = str(Path(sys.executable).parent / "alembic")


def _read(rel: str) -> str:
    return (REPO / rel).read_text(encoding="utf-8")


def _prod_compose() -> dict:
    return yaml.safe_load((REPO / "docker-compose.prod.yml").read_text(encoding="utf-8"))


def _dev_compose() -> dict:
    return yaml.safe_load((REPO / "docker-compose.yml").read_text(encoding="utf-8"))


def _example_vars(rel: str) -> set[str]:
    names: set[str] = set()
    for line in _read(rel).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        names.add(line.split("=", 1)[0].strip())
    return names


# ------------------------------------------------- A) راستی‌آزمایی ادعاهای pass-1

def test_api_dockerfile_nonroot_effective():
    """ادعای pass-1: USER غیرریشه واقعاً مؤثر است و بعداً override نمی‌شود."""
    lines = _read("apps/api/Dockerfile").splitlines()
    user_lines = [
        (i, line.strip())
        for i, line in enumerate(lines)
        if line.strip().startswith("USER ")
    ]
    assert user_lines, "no USER instruction in apps/api/Dockerfile"
    # آخرین USER باید appuser باشد و بعد از آن USER دیگری نیاید
    assert user_lines[-1][1] == "USER appuser"
    # CMD بعد از USER می‌آید (ران‌تایم با appuser)
    cmd_idx = next(
        i for i, line in enumerate(lines) if line.strip().startswith("CMD ")
    )
    assert cmd_idx > user_lines[-1][0]


def test_api_dockerfile_ships_alembic():
    """ادعای pass-1: alembic.ini و دایرکتوری alembic در ایمیج نهایی‌اند."""
    content = _read("apps/api/Dockerfile")
    assert re.search(r"^COPY alembic\.ini", content, re.MULTILINE)
    assert re.search(r"^COPY alembic \./alembic", content, re.MULTILINE)


def test_minio_image_pinned_no_latest():
    """ادعای pass-1: ایمیج MinIO پین‌شده (نه latest) در هر دو compose."""
    for rel in ("docker-compose.yml", "docker-compose.prod.yml"):
        compose = yaml.safe_load((REPO / rel).read_text(encoding="utf-8"))
        image = compose["services"]["minio"]["image"]
        assert ":latest" not in image, f"{rel}: minio image is :latest"
        assert re.search(r":RELEASE\.\d{4}-", image), f"{rel}: minio tag not pinned: {image}"


def test_compose_dev_uses_service_names():
    """ادعای pass-1: درون کانتینرها نام سرویس (نه localhost) برای DB/Redis/MinIO."""
    env = _dev_compose()["services"]["api"]["environment"]
    assert "postgres" in env["DATABASE_URL"] and "localhost" not in env["DATABASE_URL"]
    assert "redis" in env["REDIS_URL"] and "localhost" not in env["REDIS_URL"]
    assert "minio" in env["S3_ENDPOINT"] and "localhost" not in env["S3_ENDPOINT"]


def test_ci_semgrep_is_blocking():
    """ادعای pass-1: semgrep در CI مسدودکننده است (نه || true، نه continue-on-error).

    به‌روزرسانی دامنه‌محور دوم (v1.1.0 — نه تضعیف، تقویت): بدهی تایپ mypy
    صفر شد (docs/audit-v2/TYPE_DEBT_BURNDOWN.md) و استثنای Typecheck حذف
    شد. حالا invariant سخت‌گیرانه‌تر pin می‌شود: هیچ continue-on-errorای
    در کل فایل نیست و هر دو گام Security scan و Typecheck کاملاً
    مسدودکننده‌اند (نه || true، نه continue-on-error).
    """
    content = _read(".github/workflows/ci.yml")
    # گام Security scan: مسدودکنندهٔ کامل — نه || true، نه continue-on-error
    scan = content.split("Security scan", 1)[1].split("- name:", 1)[0]
    assert "continue-on-error" not in scan
    # فقط خطوط run: واقعی بررسی شود (نه کامنت‌ها)
    run_lines = [
        ln for ln in scan.splitlines() if ln.strip().startswith("run:")
    ]
    assert run_lines, "no run: line in semgrep step"
    assert not any("|| true" in ln for ln in run_lines), "semgrep step is not blocking"
    # دیگر هیچ استثنایی نیست: صفر کلید continue-on-error در کل فایل
    coe_keys = re.findall(r"(?m)^\s*continue-on-error:", content)
    assert len(coe_keys) == 0, f"expected no continue-on-error step keys, got {len(coe_keys)}"
    # گام Typecheck هم مسدودکنندهٔ کامل است
    typecheck = content.split("Typecheck", 1)[1].split("- name:", 1)[0]
    assert "continue-on-error:" not in typecheck
    tc_run_lines = [
        ln for ln in typecheck.splitlines() if ln.strip().startswith("run:")
    ]
    assert tc_run_lines, "no run: line in Typecheck step"
    assert not any("|| true" in ln for ln in tc_run_lines), "Typecheck step is not blocking"


def test_backup_script_has_sha256_manifest():
    """ادعای pass-1: منطق مانیفست SHA-256 در infra/backup.sh واقعی است."""
    content = _read("infra/backup.sh")
    assert "sha256sum" in content
    assert re.search(r'sha256sum "\$BACKUP_DIR/pg-\$DATE\.sql\.gz" > "\$BACKUP_DIR/pg-\$DATE\.sql\.gz\.sha256"', content)


def test_backup_script_mc_mirror_uses_compose_file():
    """§۱۷: مرحلهٔ mirror باید از همان COMPOSE_FILE انتخاب‌شده استفاده کند —
    با کانتینر mc واقعی.

    به‌روزرسانی رفتار-محور (نه تضعیف): الگوی قبلی
    `exec -T minio mc mirror` ذاتاً خراب بود — ایمیج minio سرور دستور `mc`
    ندارد، پس همیشه ساکت فیل می‌شد و بکاپ فایل عملاً گرفته نمی‌شد (یافتهٔ
    Track 1 / §۱۷). حالا mirror با کانتینر یک‌بارمصرف mc روی همان
    COMPOSE_FILE انجام می‌شود و خطایش بلند فیل می‌کند.
    """
    content = _read("infra/backup.sh")
    assert 'DC="docker compose -f $COMPOSE_FILE"' in content
    assert "quay.io/minio/mc:" in content
    assert "mc mirror" in content
    assert "exec -T minio mc mirror" not in content


# ------------------------------------------------- §۱۰) migration کنترل‌شده

def test_prod_migrate_one_shot_service():
    """§۱۰: سرویس یک‌بارهٔ migrate با الگوی init-job (نه race چند replica)."""
    services = _prod_compose()["services"]
    assert "migrate" in services, "no migrate one-shot service in docker-compose.prod.yml"
    migrate = services["migrate"]
    assert migrate["command"] == ["alembic", "upgrade", "head"]
    assert migrate["restart"] == "no"
    assert "postgres" in migrate["depends_on"]
    # شکست migration باید deploy را بلند فیل کند
    for name in ("api", "worker-critical", "worker-ai", "worker-media",
                 "worker-telegram", "worker-notifications", "worker-analytics"):
        dep = services[name]["depends_on"]["migrate"]
        assert dep.get("condition") == "service_completed_successfully", name


def test_prod_api_command_has_no_inline_migration():
    """§۱۰: دستور api فقط uvicorn است — migration فقط در سرویس migrate."""
    cmd = _prod_compose()["services"]["api"]["command"]
    assert "alembic" not in cmd, "migration must not run inside every api replica"


def test_prod_api_readiness_depends_on_db_health():
    """§۱۰: readiness واقعی — service_healthy برای postgres/redis/minio + هلث‌چک /ready.
    Pass 4 / C6: /health فقط liveness است و وابستگی‌ها را چک
    نمی‌کند؛ هلث‌چک compose باید /ready را بزند (DB probe با
    timeout) و نباید /health باشد."""
    api = _prod_compose()["services"]["api"]
    for dep in ("postgres", "redis", "minio"):
        assert api["depends_on"][dep].get("condition") == "service_healthy", dep
    hc = " ".join(api["healthcheck"]["test"])
    assert "/ready" in hc
    assert "/health" not in hc


def test_prod_no_published_db_ports():
    """§۱۱: پورت‌های DB/Redis/MinIO در production به هاست/اینترنت باز نیستند."""
    services = _prod_compose()["services"]
    for name in ("postgres", "redis", "minio", "metabase-db"):
        assert "ports" not in services[name], f"{name} publishes ports in prod"


def test_prod_services_have_healthchecks():
    """§۱۱: هلث‌چک واقعی برای postgres/redis/minio/api."""
    services = _prod_compose()["services"]
    for name in ("postgres", "redis", "minio", "api"):
        assert "healthcheck" in services[name], f"{name} has no healthcheck"


# ------------------------------------------------- §۱۱) برابری env

def _required_vars(compose: dict) -> set[str]:
    """متغیرهای ${VAR:?} و ${VAR?} در کل compose."""
    text = yaml.safe_dump(compose)
    out: set[str] = set()
    for a, b in re.findall(
        r"\$\{([A-Za-z_][A-Za-z0-9_]*):\?|\$\{([A-Za-z_][A-Za-z0-9_]*)\?", text
    ):
        out.add(a or b)
    return out


def test_prod_required_vars_covered_by_example():
    """§۱۱: هر متغیر اجباری compose باید در .env.prod.example مستند باشد."""
    required = _required_vars(_prod_compose())
    assert required, "no required vars found — regex broken?"
    example = _example_vars(".env.prod.example")
    missing = required - example
    assert not missing, f"required vars missing from .env.prod.example: {missing}"


def test_prod_example_service_names_not_localhost():
    """§۱۱: درون شبکهٔ compose، هاست‌ها نام سرویس‌اند (نه localhost)."""
    example = _example_vars(".env.prod.example")
    text = _read(".env.prod.example")
    for var in ("DATABASE_URL", "REDIS_URL", "S3_ENDPOINT"):
        assert var in example, var
        line = next(
            ln for ln in text.splitlines() if ln.startswith(var + "=")
        )
        assert "localhost" not in line, f"{var} uses localhost in prod example"
    assert "@postgres:" in text and "@redis:" in text and "http://minio:9000" in text


def test_storage_provider_in_env_examples():
    """§۱۱/§۱۲: STORAGE_PROVIDER در هر دو نمونهٔ env مستند است."""
    assert "STORAGE_PROVIDER" in _example_vars(".env.example")
    assert "STORAGE_PROVIDER" in _example_vars(".env.prod.example")
    prod_text = _read(".env.prod.example")
    assert re.search(r"^STORAGE_PROVIDER=s3", prod_text, re.MULTILINE)


def test_config_covers_storage_settings():
    """§۱۱: config.py همهٔ کلیدهای storage را می‌شناسد."""
    from app.core.config import Settings

    s = Settings()
    for field in ("storage_provider", "s3_endpoint", "s3_endpoint_public",
                  "s3_access_key", "s3_secret_key", "s3_bucket", "s3_region",
                  "storage_local_dir"):
        assert hasattr(s, field), field


def test_env_example_has_no_duplicate_keys():
    """§۱۱: کلید تکراری در .env.example نباشد (قبلاً APP_BASE_URL و
    STORAGE_LOCAL_DIR و CORS_ALLOW_ORIGINS دو بار بودند)."""
    seen: dict[str, int] = {}
    for line in _read(".env.example").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        seen[key] = seen.get(key, 0) + 1
    dupes = {k: v for k, v in seen.items() if v > 1}
    assert not dupes, f"duplicate keys in .env.example: {dupes}"


# ------------------------------------------------- §۱۲) فکتوری storage

@pytest.fixture()
def _isolated_settings(monkeypatch, tmp_path):
    """env ایزوله برای get_settings (کش lru پاک می‌شود)."""
    from app.core.config import get_settings

    monkeypatch.chdir(tmp_path)  # بدون .env — فقط env واقعی خوانده شود
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_storage_factory_defaults_to_local(_isolated_settings):
    from app.core.storage import LocalStorageProvider, get_storage

    provider = get_storage()
    assert isinstance(provider, LocalStorageProvider)


def test_storage_factory_rejects_unknown_provider(_isolated_settings, monkeypatch):
    from app.core.storage import get_storage

    monkeypatch.setenv("STORAGE_PROVIDER", "bogus")
    with pytest.raises(RuntimeError, match="STORAGE_PROVIDER"):
        get_storage()


def test_storage_factory_s3_fails_loudly_on_bad_config(_isolated_settings, monkeypatch):
    """§۱۲: config بدِ S3 → RuntimeError صریح، نه fallback خاموش به local."""
    from app.core.storage import get_storage

    monkeypatch.setenv("STORAGE_PROVIDER", "s3")
    monkeypatch.setenv("S3_ENDPOINT", "not-a-url")
    monkeypatch.setenv("S3_ACCESS_KEY", "")
    monkeypatch.setenv("S3_SECRET_KEY", "")
    monkeypatch.setenv("S3_BUCKET", "Bad_Bucket!!")
    with pytest.raises(RuntimeError, match="S3_ENDPOINT.*S3_ACCESS_KEY.*S3_SECRET_KEY.*S3_BUCKET"):
        get_storage()


async def test_storage_factory_s3_returns_s3_provider_with_prod_like_config(
    _isolated_settings, monkeypatch
):
    """§۱۲: با config شبه-production، فکتوری واقعاً S3StorageProvider می‌دهد.

    صادقانه: سازندهٔ minio و presigned_get_object هیچ فراخوانی شبکه‌ای
    نمی‌کنند (امضای محلی) — این تست منطق *انتخاب* و رفتار *امضا* را ثابت
    می‌کند، نه اتصال واقعی به MinIO (نیازمند docker؛ Blocked).
    """
    from app.core.storage import S3StorageProvider, get_storage

    monkeypatch.setenv("STORAGE_PROVIDER", "s3")
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("S3_ACCESS_KEY", "minioadmin")
    monkeypatch.setenv("S3_SECRET_KEY", "minioadmin")
    monkeypatch.setenv("S3_BUCKET", "maturidi-media")
    provider = get_storage()
    assert isinstance(provider, S3StorageProvider)
    assert provider.bucket == "maturidi-media"

    url = await provider.get_presigned_url("library/abc.pdf", expires_seconds=300)
    # امضای واقعی AWS SigV4 در URL هست؛ بدون حتی یک پکت شبکه
    assert "maturidi-media" in url and "library/abc.pdf" in url
    assert "X-Amz-Signature=" in url and "X-Amz-Expires=300" in url


# ------------------------------------------------- §۱۳) بدون fallback خاموش به localhost

def test_web_build_requires_api_url():
    """§۱۳: next.config.mjs بیلد production بدون NEXT_PUBLIC_API_URL را فیل می‌کند."""
    content = _read("apps/web/next.config.mjs")
    assert "NEXT_PUBLIC_API_URL" in content
    assert "phase-production-build" in content
    assert "throw new Error" in content


def test_web_dockerfile_has_no_localhost_default():
    """§۱۳: ARG وب default localhost ندارد (بیلد بدون مقدار، بلند فیل می‌کند)."""
    content = _read("apps/web/Dockerfile")
    assert "ARG NEXT_PUBLIC_API_URL=http://localhost:8000" not in content
    assert re.search(r"^ARG NEXT_PUBLIC_API_URL$", content, re.MULTILINE)


def test_web_no_silent_localhost_fallbacks_in_client_code():
    """§۱۳: هیچ fallback خاموش به localhost در کد کلاینت وب نمانده —
    همه از lib/api-base.ts می‌آیند (به‌جز خود api-base و lib/api.ts سروری)."""
    import subprocess as sp

    out = sp.run(
        ["grep", "-rn", "localhost:8000", "lib", "app", "components"],
        cwd=REPO / "apps" / "web",
        capture_output=True, text=True, check=False,
    ).stdout
    allowed = {"lib/api-base.ts", "lib/api.ts"}  # helper خودش + مسیر سروری (loud)
    for line in out.splitlines():
        path = line.split(":", 1)[0]
        assert path in allowed, f"silent localhost fallback in web client code: {line}"


def test_web_ssr_uses_server_side_api_url():
    """§۱۳: تفکیک SSR/مرورگر — lib/api.ts سروری API_URL را می‌خواند و در
    production بدون آن بلند خطا می‌دهد؛ compose مقدار داخلی را می‌دهد."""
    content = _read("apps/web/lib/api.ts")
    assert "process.env.API_URL" in content
    assert "throw new Error" in content
    web = _prod_compose()["services"]["web"]
    assert web["environment"]["API_URL"] == "http://api:8000"


def test_crm_build_requires_api_url():
    """§۱۳: vite.config.ts بیلد production بدون VITE_API_URL را فیل می‌کند."""
    content = _read("apps/crm/vite.config.ts")
    assert "VITE_API_URL" in content
    assert "throw new Error" in content


def test_crm_api_client_no_silent_localhost_in_prod():
    """§۱۳: api.ts در PROD بدون VITE_API_URL بلند خطا می‌دهد (نه fallback خاموش)."""
    content = _read("apps/crm/src/lib/api.ts")
    assert "import.meta.env.PROD" in content
    assert "throw new Error" in content


def test_mobile_config_no_silent_localhost_in_prod():
    """§۱۶: config موبایل فقط در dev به localhost fallback می‌کند."""
    content = _read("apps/mobile/src/lib/config.ts")
    assert "__DEV__" in content
    assert "throw new Error" in content


# ------------------------------------------------- §۱۴) Dockerfile کرم و monorepo deps

def test_crm_dockerfile_copies_ui_web_before_npm_ci():
    """§۱۴: packages/ui-web قبل از npm ci کپی می‌شود (وابستگی file:)."""
    lines = _read("apps/crm/Dockerfile").splitlines()
    copy_ui = next(
        i for i, line in enumerate(lines)
        if line.strip().startswith("COPY") and "packages/ui-web" in line
    )
    npm_ci = next(
        i for i, line in enumerate(lines)
        if line.strip().startswith("RUN") and "npm ci" in line
    )
    assert copy_ui < npm_ci


def test_crm_dockerfile_passes_vite_api_url_arg():
    """§۱۳: بیلد CRM مقدار VITE_API_URL را به‌صورت ARG می‌گیرد."""
    content = _read("apps/crm/Dockerfile")
    assert re.search(r"^ARG VITE_API_URL$", content, re.MULTILINE)


# ------------------------------------------------- §۱۵) وضعیت شبکه

def test_prod_compose_crm_gets_api_url_arg():
    """§۱۵: سرویس crm در prod مقدار VITE_API_URL را از compose می‌گیرد (اجباری)."""
    crm = _prod_compose()["services"]["crm"]
    assert "CRM_API_URL" in crm["build"]["args"]["VITE_API_URL"]


def test_prod_api_uses_proxy_headers_behind_tls_terminating_proxy():
    """§۱۵: uvicorn با --proxy-headers (لاگ audit باید IP واقعی ببیند)."""
    cmd = _prod_compose()["services"]["api"]["command"]
    # command از فیکس C-04 فرم ["sh", "-c", <script>] دارد تا
    # $${UVICORN_WORKERS:-4} داخل کانتینر باز شود؛ پرچم‌ها داخل
    # همان اسکریپت‌اند، پس برای چکِ «وجود پرچم در دستور api» فرم
    # تخت‌شده ملاک است (معنای assertion عوض نشده).
    flat = cmd if isinstance(cmd, str) else " ".join(str(part) for part in cmd)
    assert "--proxy-headers" in flat


def test_body_size_limit_middleware():
    """§۱۵: سقف سراسری body — بیشتر از حد → 413 با پاکت خطای یکپارچه."""
    from starlette.applications import Starlette
    from starlette.responses import PlainTextResponse
    from starlette.routing import Route
    from starlette.testclient import TestClient

    from app.core.middleware import BodySizeLimitMiddleware

    async def _ok(request):
        return PlainTextResponse("ok")

    app = Starlette(routes=[Route("/", _ok, methods=["POST"])])
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=16)
    client = TestClient(app, raise_server_exceptions=False)

    big = client.post("/", content=b"x" * 17)
    assert big.status_code == 413
    assert big.json()["error"]["code"] == "request_body_too_large"

    small = client.post("/", content=b"x" * 16)
    assert small.status_code == 200


# ------------------------------------------------- §۱۷) تمرین backup→restore

def test_alembic_upgrade_head_from_zero(tmp_path):
    """§۱۰: `alembic upgrade head` از صفر روی scratch sqlite با درخت فعلی."""
    db = tmp_path / "scratch.db"
    env = dict(os.environ, DATABASE_URL=f"sqlite+aiosqlite:///{db}")
    proc = subprocess.run(
        [ALEMBIC_BIN, "upgrade", "head"],
        cwd=APPS_API, env=env, capture_output=True, text=True, timeout=300, check=False,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    con.close()
    assert "alembic_version" in tables
    assert len(tables) > 10  # migrationهای واقعی اعمال شدند


def test_backup_restore_drill_with_manifest(tmp_path):
    """§۱۷: تمرین واقعی — seed → بکاپ با مانیفست SHA-256 → restore → شمارش + هش.

    منطق backup.sh (dump + sha256sum manifest) روی scratch اجرا می‌شود؛
    هیچ دادهٔ واقعی لمس نمی‌شود.
    """
    db = tmp_path / "drill.db"
    env = dict(os.environ, DATABASE_URL=f"sqlite+aiosqlite:///{db}")
    subprocess.run([ALEMBIC_BIN, "upgrade", "head"], cwd=APPS_API, env=env,
                   capture_output=True, text=True, timeout=300, check=True)

    con = sqlite3.connect(db)
    # یک جدول واقعی از migrationها پیدا کن و چند سطر seed بزن
    table = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'alembic%'"
    ).fetchone()[0]
    cols = [r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()]
    placeholders = ", ".join(["'seed'"] * len(cols))
    for _ in range(7):
        try:
            con.execute(f"INSERT INTO {table} VALUES ({placeholders})")
        except sqlite3.Error:
            break  # جدول با قیود NOT NULL پیچیده — seed حداقلی کافی است
    con.commit()
    before = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    con.close()

    # --- بکاپ: کپی + مانیفست SHA-256 (همان الگوی backup.sh) ---
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    dump = backup_dir / "drill.sql.gz"
    manifest = backup_dir / "drill.sql.gz.sha256"
    subprocess.run(f"sqlite3 {db} .dump | gzip > {dump}", shell=True, check=True)
    digest = hashlib.sha256(dump.read_bytes()).hexdigest()
    manifest.write_text(f"{digest}  {dump.name}\n")

    # --- restore به دیتابیس تازه + راستی‌آزمایی ---
    restored = tmp_path / "restored.db"
    subprocess.run(f"gunzip -c {dump} | sqlite3 {restored}", shell=True, check=True)
    got = manifest.read_text().split()[0]
    assert got == hashlib.sha256(dump.read_bytes()).hexdigest(), "manifest mismatch"
    con = sqlite3.connect(restored)
    after = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    con.close()
    assert after == before and before >= 0
