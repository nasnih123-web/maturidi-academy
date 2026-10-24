"""سرویس مرکز بیلدها — فاز ۱۴ + dispatch واقعی (F-05 remediation).

- GET /releases: نسخه‌های منتشرشدهٔ هر پلتفرم با download URL (امضاشده).
- POST /releases: ثبت انتشار — یا کاربرِ دارای مجوز builds.manage یا
  callback سرویس CI با توکن اختصاصی (B-01 — ADR-0025): workflow فایل را
  به باکت builds در MinIO می‌فرستد و کلید آبجکت را ثبت می‌کند؛ پاسخ
  download_url تازه و کوتاه‌عمر از StorageProvider می‌سازد و نگهداری
  «۱۰ گروه انتشار آخر هر پلتفرم» (FIX2-11) همین‌جا اعمال می‌شود.
- POST /rebuild: ساخت درخواست + dispatch واقعی به GitHub Actions
  (workflow_dispatch روی mobile.yml / desktop.yml). اگر ارائه‌دهندهٔ بیلد
  پیکربندی نشده باشد (GITHUB_DISPATCH_TOKEN/GITHUB_REPO خالی)، صادقانه
  503 build_provider_not_configured برمی‌گردد و هیچ ردیف «queued»ای
  ساخته نمی‌شود — صفِ به‌هیچ‌جا دیگر وجود ندارد.
- وضعیت درخواست از روی workflow run واقعی همگام می‌شود
  (sync_build_requests — کرون ARQ در builds_tasks) — هرگز دستی حدس زده
  نمی‌شود.
- GET /prereqs: کدام secretهای امضا حاضرند + وضعیت ارائه‌دهندهٔ بیلد —
  صادقانه؛ هرگز ادعای بیلد امضاشده‌ای که وجود ندارد نمی‌شود (§۱۵.۹).

امنیت dispatch: هیچ ورودی کاربر به shell نمی‌رسد (اصلاً shellای در کار
نیست)؛ همهٔ فراخوانی‌ها قالب‌های ثابت GitHub API + ورودی‌های اعتبارسنجی‌شده‌اند
و توکن هرگز در دیتابیس/audit/پاسخ ذخیره یا چاپ نمی‌شود (§۱۴).
"""
from __future__ import annotations

import hmac
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.config import get_settings
from app.core.errors import APIError
from app.core.platform_settings import get_setting
from app.core.storage import StorageProvider, get_builds_storage
from app.models.models import BuildRelease, BuildRequest, User

logger = logging.getLogger(__name__)

PLATFORMS = ("android", "ios", "desktop")

# ---------------------------------------------------------------------------
# Callback بیلدها از CI (B-01 — ADR-0025)
# ---------------------------------------------------------------------------

#: توکن سرویس CI فقط وقتی معتبر است که در محیط API تنظیم شده باشد؛
#: مقایسه ثابت-زمان است و توکن هرگز لاگ/ذخیره نمی‌شود.
SERVICE_TOKEN_HEADER = "x-build-service-token"

#: نگهداری انتشارها: فقط ۱۰ گروه انتشار آخر هر پلتفرم می‌ماند
#: (گروه = (version, build_number) با همهٔ فایل‌هایش — FIX2-11).
RELEASE_RETENTION_PER_PLATFORM = 10

#: عمر URL دانلود امضاشده‌ای که برای هر release تازه ساخته می‌شود.
RELEASE_DOWNLOAD_TTL_SECONDS = 900

# کلید آبجکت فایل بیلد: همیشه زیر پیشوند builds/ و بدون traversal
_ARTIFACT_KEY_RE = re.compile(r"^builds/[A-Za-z0-9][A-Za-z0-9._\-/]*$")
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def service_token_ok(token: str | None) -> bool:
    """اعتبارسنجی توکن سرویس CI — فقط وقتی در محیط تنظیم شده باشد."""
    expected = get_settings().builds_service_token.strip()
    if not expected or not token:
        return False
    return hmac.compare_digest(token.strip(), expected)


def validate_artifact_key(key: str | None) -> str | None:
    """کلید آبجکت فایل بیلد — زیر builds/، بدون .. و بدون اسلش آغازین."""
    if key is None:
        return None
    k = key.strip()
    if not _ARTIFACT_KEY_RE.match(k) or ".." in k.split("/"):
        raise APIError(
            422, "bad_artifact_key",
            "artifact_key باید زیر پیشوند builds/ باشد و شامل .. نباشد",
        )
    return k


def _download_url_allowed_hosts() -> set[str]:
    """نام‌میزبان‌های شناخته‌شدهٔ پروژه برای download_url دستی (FIX2-07).

    فقط میزبان‌هایی که خود پروژه از config می‌شناسد: endpoint عمومی
    storage (S3_ENDPOINT_PUBLIC)، endpoint عمومی باکت builds
    (BUILDS_S3_ENDPOINT_PUBLIC) و APP_BASE_URL (دانلودهای app-hosted).
    """
    from urllib.parse import urlparse

    settings = get_settings()
    hosts: set[str] = set()
    for raw in (
        settings.s3_endpoint_public,
        settings.builds_s3_endpoint_public,
        settings.app_base_url,
    ):
        if raw and raw.strip():
            host = urlparse(raw.strip()).hostname
            if host:
                hosts.add(host.lower())
    return hosts


def validate_download_url(url: str | None) -> str | None:
    """اعتبارسنجی download_url ثبت دستی (FIX2-07 — ADR-0045).

    این لینک در CRM به‌عنوان دانلود رسمیِ بیلد امضاشده نمایش داده
    می‌شود؛ URL خارجی دلخواه (حتی https) یعنی هر کس با دسترسی ثبت
    release می‌تواند لینک فیشینگ/بدافزار را جای دانلود رسمی بنشاند.
    قرارداد: فقط https (http فقط برای localhost توسعه) و فقط روی
    میزبان‌های شناخته‌شدهٔ پروژه. اگر هیچ میزبان عمومی‌ای پیکربندی
    نشده باشد، هر download_url دستی رد می‌شود — مسیر درست در آن
    حالت artifact_key (آپلود به باکت builds) است.
    """
    if url is None:
        return None
    from urllib.parse import urlparse

    u = url.strip()
    parsed = urlparse(u)
    host = (parsed.hostname or "").lower()
    bad = APIError(
        422,
        "bad_download_url",
        "download_url باید https و روی میزبان عمومی شناخته‌شدهٔ پروژه "
        "(S3_ENDPOINT_PUBLIC / BUILDS_S3_ENDPOINT_PUBLIC / APP_BASE_URL) "
        "باشد؛ برای فایل روی باکت builds از artifact_key استفاده کنید",
    )
    if not u or any(ch.isspace() for ch in u) or parsed.username or parsed.password:
        raise bad
    if parsed.scheme == "http" and host in ("localhost", "127.0.0.1"):
        pass  # توسعهٔ محلی — همان استثنای localhost در گارد production
    elif parsed.scheme != "https":
        raise bad
    if not host or host not in _download_url_allowed_hosts():
        raise bad
    return u

# ---------------------------------------------------------------------------
# ارائه‌دهندهٔ بیلد (GitHub Actions) — F-05 remediation
# ---------------------------------------------------------------------------

PROVIDER_GITHUB = "github_actions"
GITHUB_API_BASE = "https://api.github.com"

# پلتفرم → workflow مقصد dispatch (در .github/workflows/)
_WORKFLOW_BY_PLATFORM: dict[str, str] = {
    "android": "mobile.yml",
    "ios": "mobile.yml",
    "desktop": "desktop.yml",
}

# محیط CRM → پروفایل EAS در eas.json (mobile.yml ورودی profile می‌گیرد)
_PROFILE_BY_ENVIRONMENT: dict[str, str] = {
    "development": "development",
    "preview": "preview",
    "production": "production-apk",
}

ENVIRONMENTS = tuple(_PROFILE_BY_ENVIRONMENT)

# نام پکیج معتبر جاوا/اندروید: دست‌کم دو بخش، هر بخش با حرف کوچک شروع شود
_PACKAGE_ID_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
# نسخهٔ انتشار معتبر برای ساخت تگ: digits.digits.digits (مثل 1.1.0)
_RELEASE_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


def release_tag_for(*, version: str | None, branding: dict) -> str:
    """تگ Release مقصد dispatch — سیاست صریح نسخه (تابع خالص).

    فقط وقتی «v<version>» برمی‌گردد که هر دو شرط برقرار باشد:
    environment == "production" و version شکل نسخهٔ انتشار معتبر
    (digits.digits.digits) داشته باشد. در همهٔ حالت‌های دیگر "" است:
    بیلدهای preview/development فقط workflow artifact می‌مانند و هیچ
    Releaseای لمس نمی‌شود؛ نسخهٔ نامعتبر هم هرگز تگ نمی‌سازد.
    """
    if str(branding.get("environment") or "") != "production":
        return ""
    v = (version or "").strip()
    if not _RELEASE_VERSION_RE.match(v):
        return ""
    return f"v{v}"
# URL محلی — در بیلد production ممنوع (همان قاعدهٔ app.config.js موبایل)
_LOCAL_URL_RE = re.compile(r"^https?://(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])(:|$|/)")

_ACTIVE_STATUSES = ("queued", "running")
_TERMINAL_STATUSES = ("completed", "failed")


def provider_status() -> dict:
    """وضعیت پیکربندی ارائه‌دهندهٔ بیلد — بدون افشای توکن (فقط configured/repo)."""
    s = get_settings()
    configured = bool(s.github_dispatch_token.strip() and s.github_repo.strip())
    return {
        "configured": configured,
        "provider": PROVIDER_GITHUB if configured else None,
        "repo": s.github_repo.strip() or None,
        "workflows": dict(_WORKFLOW_BY_PLATFORM),
    }


def _make_client() -> httpx.AsyncClient:
    """فکتوری کلاینت GitHub — در تست‌ها با MockTransport جایگزین می‌شود."""
    s = get_settings()
    return httpx.AsyncClient(
        base_url=GITHUB_API_BASE,
        timeout=20.0,
        headers={
            "Authorization": f"Bearer {s.github_dispatch_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "maturidi-academy-builds",
        },
    )


def validate_branding(
    *,
    app_name: str | None = None,
    package_id: str | None = None,
    version_code: int | None = None,
    api_url: str | None = None,
    environment: str | None = None,
) -> dict:
    """اعتبارسنجی برندینگ بیلد — خروجی: dict تمیز برای ذخیره در BuildRequest.branding.

    package_id باید نام پکیج معتبر جاوا باشد (دست‌کم دو بخش)؛ api_url در
    محیط production نباید localhost باشد (همان گارد F-09 سمت موبایل).
    """
    out: dict[str, Any] = {}
    if app_name is not None:
        name = app_name.strip()
        if len(name) > 80:
            raise APIError(422, "invalid_app_name", "نام اپ حداکثر ۸۰ نویسه است")
        if name:
            out["app_name"] = name
    if package_id is not None and package_id.strip():
        pid = package_id.strip()
        if not _PACKAGE_ID_RE.match(pid):
            raise APIError(
                422, "invalid_package_id",
                f"package_id نامعتبر است (نام پکیج جاوا، مثل org.maturidi.academy): {pid}",
            )
        out["package_id"] = pid
    if version_code is not None:
        if version_code <= 0:
            raise APIError(422, "invalid_version_code", "version_code باید عدد صحیح مثبت باشد")
        out["version_code"] = version_code
    env = (environment or "").strip()
    if env:
        if env not in _PROFILE_BY_ENVIRONMENT:
            raise APIError(
                422, "invalid_environment",
                f"محیط نامعتبر: {env} (مجاز: {', '.join(ENVIRONMENTS)})",
            )
        out["environment"] = env
    if api_url is not None and api_url.strip():
        url = api_url.strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise APIError(422, "invalid_api_url", "api_url باید با http(s) شروع شود")
        if out.get("environment") == "production" and _LOCAL_URL_RE.match(url):
            raise APIError(
                422, "invalid_api_url",
                "api_url در بیلد production نمی‌تواند localhost باشد",
            )
        out["api_url"] = url
    return out


def build_dispatch_body(
    *,
    platform: str,
    ref: str | None,
    version: str | None,
    branding: dict,
    request_id: str,
) -> tuple[str, dict]:
    """(نام workflow, بدنهٔ workflow_dispatch) — تابع خالص، بدون شبکه.

    فقط ورودی‌هایی فرستاده می‌شوند که workflow مقصد واقعاً تعریف کرده است
    (ارسال ورودی تعریف‌نشده به GitHub خطای 422 می‌دهد): mobile.yml ورودی‌های
    برندینگ + release_tag را می‌گیرد؛ desktop.yml فقط release_tag را تعریف
    کرده است (وقتی سیاست نسخه تگی ندهد، برای دسکتاپ اصلاً inputs فرستاده
    نمی‌شود). release_tag از release_tag_for می‌آید: فقط production با
    نسخهٔ معتبر — و workflow آن را تحت گارد Release (فقط Draft، هرگز
    Release منتشرشده) به Release همان نسخه وصل می‌کند.
    همهٔ مقادیر inputs باید رشته باشند (قرارداد GitHub).
    """
    workflow = _WORKFLOW_BY_PLATFORM[platform]
    body: dict[str, Any] = {"ref": ref or "main"}
    tag = release_tag_for(version=version, branding=branding)
    if platform in ("android", "ios"):
        environment = str(branding.get("environment") or "preview")
        body["inputs"] = {
            "platform": platform,
            "profile": _PROFILE_BY_ENVIRONMENT.get(environment, "preview"),
            "app_name": str(branding.get("app_name") or ""),
            "package_id": str(branding.get("package_id") or ""),
            "app_version": version or "",
            "version_code": str(branding.get("version_code") or ""),
            "api_url": str(branding.get("api_url") or ""),
            "environment": environment,
            "request_id": request_id,
            "release_tag": tag,
        }
    elif platform == "desktop" and tag:
        body["inputs"] = {"release_tag": tag}
    return workflow, body


def map_run_status(run: dict) -> str | None:
    """نگاشت وضعیت یک workflow run گیت‌هاب به وضعیت BuildRequest — تابع خالص.

    None یعنی وضعیت ناشناخته/میانی: تغییری اعمال نشود.
    """
    status = run.get("status")
    if status == "queued":
        return "queued"
    if status in ("in_progress", "waiting", "pending", "requested"):
        return "running"
    if status == "completed":
        return "completed" if run.get("conclusion") == "success" else "failed"
    return None


def _parse_github_ts(value: str) -> datetime:
    # Python 3.11+ پسوند Z را مستقیم در fromisoformat می‌فهمد
    return datetime.fromisoformat(value)


def pick_run_for_request(
    runs: list[dict], *, dispatched_at: datetime, claimed_run_ids: set[str]
) -> dict | None:
    """انتخاب run متناظر یک درخواست از فهرست runهای workflow — تابع خالص.

    کهن‌ترین runِ workflow_dispatch که پس از dispatch ساخته شده (با ۶۰ ثانیه
    اغماض اختلاف ساعت) و قبلاً به درخواست دیگری نسبت داده نشده است.
    """
    if dispatched_at.tzinfo is None:
        # SQLite زمان‌ها را naive برمی‌گرداند — قرارداد پروژه: همهٔ زمان‌ها UTC
        dispatched_at = dispatched_at.replace(tzinfo=UTC)
    threshold = dispatched_at - timedelta(seconds=60)
    candidates = []
    for run in runs:
        run_id = str(run.get("id", ""))
        if not run_id or run_id in claimed_run_ids:
            continue
        created = run.get("created_at")
        if not created:
            continue
        if _parse_github_ts(created) >= threshold:
            candidates.append(run)
    if not candidates:
        return None
    return min(candidates, key=lambda r: _parse_github_ts(r["created_at"]))


async def _fetch_workflow_runs(
    client: httpx.AsyncClient, workflow: str
) -> list[dict]:
    repo = get_settings().github_repo.strip()
    resp = await client.get(
        f"/repos/{repo}/actions/workflows/{workflow}/runs",
        params={"event": "workflow_dispatch", "per_page": "20"},
    )
    resp.raise_for_status()
    data = resp.json()
    runs = data.get("workflow_runs")
    return runs if isinstance(runs, list) else []


async def _claimed_run_ids(db: AsyncSession, *, exclude_id: Any) -> set[str]:
    rows = (
        await db.execute(
            select(BuildRequest.provider_run_id).where(
                BuildRequest.provider_run_id.is_not(None),
                BuildRequest.id != exclude_id,
            )
        )
    ).scalars().all()
    return {str(r) for r in rows if r}


async def _apply_run(db: AsyncSession, req: BuildRequest, run: dict) -> bool:
    """اعمال یک run روی درخواست؛ True یعنی چیزی عوض شد."""
    changed = False
    run_id = str(run.get("id", ""))
    if run_id and req.provider_run_id != run_id:
        req.provider_run_id = run_id
        changed = True
    html_url = run.get("html_url")
    if html_url and req.provider_run_url != html_url:
        req.provider_run_url = html_url
        changed = True
    mapped = map_run_status(run)
    if mapped and mapped != req.status:
        req.status = mapped
        changed = True
    if req.status in _TERMINAL_STATUSES and req.finished_at is None:
        req.finished_at = _utcnow()
        changed = True
    return changed


async def _match_and_apply_run(
    db: AsyncSession, client: httpx.AsyncClient, req: BuildRequest
) -> bool:
    """یافتن run متناظر درخواستِ dispatchشده و اعمالش — بهترین تلاش."""
    if req.provider_run_id:
        return False
    if req.dispatched_at is None:
        return False
    workflow = _WORKFLOW_BY_PLATFORM[req.platform]
    runs = await _fetch_workflow_runs(client, workflow)
    claimed = await _claimed_run_ids(db, exclude_id=req.id)
    run = pick_run_for_request(
        runs, dispatched_at=req.dispatched_at, claimed_run_ids=claimed
    )
    if run is None:
        return False
    return await _apply_run(db, req, run)


async def sync_build_requests(
    db: AsyncSession, *, client: httpx.AsyncClient | None = None, limit: int = 50
) -> dict:
    """همگام‌سازی وضعیت درخواست‌های dispatchشده با GitHub (کرون ARQ — builds_tasks).

    فقط وضعیت‌هایی را لمس می‌کند که run واقعی گیت‌هاب گزارش کرده باشد؛
    ردیف‌های legacy (provider=NULL) هرگز دست نمی‌خورند.
    """
    if not provider_status()["configured"]:
        return {"provider_configured": False, "checked": 0, "updated": 0}
    stmt = (
        select(BuildRequest)
        .where(
            BuildRequest.provider == PROVIDER_GITHUB,
            BuildRequest.status.in_(_ACTIVE_STATUSES),
        )
        .order_by(BuildRequest.created_at.asc())
        .limit(min(limit, 200))
    )
    rows = (await db.execute(stmt)).scalars().all()
    updated = 0

    async def _run(c: httpx.AsyncClient) -> None:
        nonlocal updated
        repo = get_settings().github_repo.strip()
        for req in rows:
            try:
                if req.provider_run_id:
                    resp = await c.get(
                        f"/repos/{repo}/actions/runs/{req.provider_run_id}"
                    )
                    resp.raise_for_status()
                    changed = await _apply_run(db, req, resp.json())
                    if (
                        req.status in _TERMINAL_STATUSES
                        and req.artifact_name is None
                    ):
                        art = await c.get(
                            f"/repos/{repo}/actions/runs/{req.provider_run_id}/artifacts"
                        )
                        art.raise_for_status()
                        artifacts = art.json().get("artifacts") or []
                        if artifacts:
                            req.artifact_name = str(artifacts[0].get("name", "")) or None
                            changed = True
                else:
                    changed = await _match_and_apply_run(db, c, req)
            except httpx.HTTPError:
                # خطای موقت شبکه/GitHub — این ردیف در چرخهٔ بعد دوباره تلاش می‌شود
                changed = False
            if changed:
                updated += 1

    if client is not None:
        await _run(client)
    else:
        async with _make_client() as c:
            await _run(c)
    await db.commit()
    return {"provider_configured": True, "checked": len(rows), "updated": updated}

_SIGNING_KEYS: dict[str, tuple[str, str]] = {
    # platform-group → (کلید setting, کلید انقضا)
    "apple_developer": ("signing.apple_developer", "signing.apple_developer_expires_at"),
    "google_play": ("signing.google_play", "signing.google_play_expires_at"),
    "cafebazaar": ("signing.cafebazaar", "signing.cafebazaar_expires_at"),
    "windows_cert": ("signing.windows_cert", "signing.windows_cert_expires_at"),
    "macos_cert": ("signing.macos_cert", "signing.macos_cert_expires_at"),
}

# هر پلتفرم به کدام گواهی‌ها نیاز دارد
_PLATFORM_PREREQS: dict[str, tuple[str, ...]] = {
    "android": ("google_play", "cafebazaar"),
    "ios": ("apple_developer",),
    "desktop": ("windows_cert", "macos_cert"),
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def _release_out(
    r: BuildRelease, *, storage: StorageProvider | None = None
) -> dict:
    """خروجی release — download_url برای فایل واقعی، تازه و کوتاه‌عمر.

    اگر فایل بیلد در StorageProvider باشد (artifact_key)، URL از
    get_presigned_url با TTL کوتاه ساخته می‌شود (هرگز در DB ذخیره
    نمی‌شود)؛ این endpoint فقط برای مدیرِ دارای مجوز است، پس بیلد
    امضانشدهٔ داخلی هم قابل دانلود است و پرچم `signed` وضعیت امضا را
    صادقانه جدا نشان می‌دهد (برچسب «امضانشده» در CRM — C-05).
    مسیر قدیمیِ ثبت دستی (download_url ذخیره‌شده) فقط برای بیلد امضاشده
    برگردانده می‌شود — مثل قبل، لینک حدسی ساخته نمی‌شود.
    """
    url: str | None = None
    expires: str | None = None
    download_expired = False
    if r.artifact_key:
        st = storage or get_builds_storage()
        url = await st.get_presigned_url(
            r.artifact_key, expires_seconds=RELEASE_DOWNLOAD_TTL_SECONDS
        )
        expires = (
            _utcnow() + timedelta(seconds=RELEASE_DOWNLOAD_TTL_SECONDS)
        ).isoformat()
    elif r.signed and r.download_url:
        # FIX2-07: انقضای ثبت‌شده روی مسیر سرو اعمال می‌شود — لینک
        # منقضی دیگر داده نمی‌شود (قبلاً فقط نمایش داده می‌شد).
        if r.download_expires_at is not None:
            from app.core.database import ensure_aware

            expires = r.download_expires_at.isoformat()
            if ensure_aware(r.download_expires_at) <= _utcnow():
                download_expired = True
            else:
                url = r.download_url
        else:
            url = r.download_url
    return {
        "id": str(r.id),
        "platform": r.platform,
        "version": r.version,
        "build_number": r.build_number,
        "download_url": url,
        "download_expires_at": expires,
        "download_expired": download_expired,
        "has_file": bool(r.artifact_key),
        "artifact_key": r.artifact_key,
        "file_size_bytes": r.file_size_bytes,
        "sha256": r.sha256,
        "signed": r.signed,
        "build_metadata": r.build_metadata or {},
        "created_at": r.created_at.isoformat(),
    }


async def list_releases(
    db: AsyncSession, *, platform: str | None = None, limit: int = 50
) -> list[dict]:
    if platform and platform not in PLATFORMS:
        raise APIError(422, "bad_platform", f"پلتفرم نامعتبر: {platform}")
    stmt = select(BuildRelease).order_by(BuildRelease.created_at.desc())
    if platform:
        stmt = stmt.where(BuildRelease.platform == platform)
    rows = (await db.execute(stmt.limit(min(limit, 200)))).scalars().all()
    return [await _release_out(r) for r in rows]


async def prune_releases(
    db: AsyncSession,
    *,
    platform: str,
    keep: int = RELEASE_RETENTION_PER_PLATFORM,
    storage: StorageProvider | None = None,
) -> int:
    """نگهداری انتشارها (B-01): فقط `keep` گروه انتشار آخر هر پلتفرم می‌ماند.

    FIX2-11: واحد نگهداری «گروه انتشار» است — (version, build_number)
    — نه تک‌رکورد. یک انتشار desktop سه فایل دارد (نصب‌کننده + امضا +
    مانیفست) و هر فایل یک رکورد است؛ شمارش رکوردی یعنی انتشار چندفایلی
    چند سهمیه می‌سوزاند و ناعادلانه زودتر پاک می‌شود. حالا ۱۰ گروه آخر
    با همهٔ فایل‌هایشان می‌مانند و بقیهٔ گروه‌ها کامل حذف می‌شوند.

    رکوردهای اضافه حذف و فایلشان از StorageProvider هم پاک می‌شود
    (حذف فایل best-effort است: خطای storage جلوی حذف رکورد را نمی‌گیرد
    ولی لاگ می‌شود). خروجی: تعداد رکورد حذف‌شده.
    """
    rows = (
        await db.execute(
            select(BuildRelease)
            .where(BuildRelease.platform == platform)
            .order_by(BuildRelease.created_at.desc(), BuildRelease.id.desc())
        )
    ).scalars().all()
    groups: dict[tuple[str, str | None], list[BuildRelease]] = {}
    group_order: list[tuple[str, str | None]] = []
    for r in rows:  # rows از تازه‌ترین مرتب است؛ ترتیب گروه = اولین ظهور
        gkey = (r.version, r.build_number)
        if gkey not in groups:
            groups[gkey] = []
            group_order.append(gkey)
        groups[gkey].append(r)
    excess = [r for gkey in group_order[keep:] for r in groups[gkey]]
    if not excess:
        return 0
    keys = [r.artifact_key for r in excess if r.artifact_key]
    for r in excess:
        await db.delete(r)
    await db.commit()
    if keys:
        st = storage or get_builds_storage()
        for storage_key in keys:
            try:
                await st.delete_object(storage_key)
            except Exception:  # best-effort؛ رکورد حذف شده است
                logger.warning(
                    "builds prune: storage delete failed for %s",
                    storage_key,
                    exc_info=True,
                )
    return len(excess)


#: پیش‌نیازهایی که در سمت CI/GitHub زندگی می‌کنند و API به آن‌ها دید
#: ندارد — صادقانه با api_visible=false گزارش می‌شوند تا CRM دقیقاً
#: نشان دهد چه چیزی کجاست و کجا راستی‌آزمایی می‌شود (C-05).
_CI_SIDE_PREREQS: tuple[dict, ...] = (
    {"key": "EXPO_TOKEN", "where": "GitHub Secrets", "verified_by": "mobile.yml preflight", "api_visible": False},
    {"key": "BUILDS_API_URL", "where": "GitHub Secrets", "verified_by": "build callback step (B-01)", "api_visible": False},
    {"key": "BUILDS_SERVICE_TOKEN (GitHub Secrets)", "where": "GitHub Secrets", "verified_by": "build callback step (B-01)", "api_visible": False},
    {"key": "BUILDS_S3_ACCESS_KEY / BUILDS_S3_SECRET_KEY / BUILDS_S3_BUCKET / BUILDS_S3_ENDPOINT", "where": "GitHub Secrets", "verified_by": "build callback step (B-01)", "api_visible": False},
    {"key": "Android keystore (EAS managed credentials)", "where": "Expo / EAS", "verified_by": "mobile.yml validate step", "api_visible": False},
    {"key": "Apple distribution certificate + provisioning profile", "where": "Expo / EAS + App Store Connect", "verified_by": "mobile.yml validate step", "api_visible": False},
    {"key": "TAURI_SIGNING_PRIVATE_KEY", "where": "GitHub Secrets", "verified_by": "desktop.yml", "api_visible": False},
)


async def get_prereqs(db: AsyncSession) -> dict:
    """پیش‌نیازهای امضا + وضعیت ارائه‌دهندهٔ بیلد + خط لوله — صادقانه (C-05).

    بخش pipeline فقط چیزهایی را گزارش می‌کند که خود API می‌تواند
    ببیند؛ پیش‌نیازهای سمت CI در ci_side با api_visible=false می‌آیند
    تا CRM «قول توخالی» نشان ندهد.
    """
    signing: dict[str, dict] = {}
    for name, (key, expiry_key) in _SIGNING_KEYS.items():
        value = await get_setting(db, key)
        signing[name] = {
            "present": bool(value and value.strip()),
            "expires_at": await get_setting(db, expiry_key),
        }
    platforms: dict[str, dict] = {}
    for plat, needs in _PLATFORM_PREREQS.items():
        missing = [n for n in needs if not signing[n]["present"]]
        platforms[plat] = {
            "required": list(needs),
            "missing": missing,
            "ready": not missing,
        }
    provider = provider_status()
    settings = get_settings()
    expo_project_id = (await get_setting(db, "builds.expo_project_id")) or ""
    base_url = (settings.app_base_url or "").strip()
    pipeline = {
        "callback_token_configured": bool(settings.builds_service_token.strip()),
        "github_dispatch_configured": provider["configured"],
        "github_repo": provider["repo"],
        "api_base_url": base_url or None,
        "api_base_url_is_local": ("localhost" in base_url or "127.0.0.1" in base_url),
        "expo_project_linked": bool(expo_project_id.strip()),
        "expo_project_id": expo_project_id.strip() or None,
    }
    return {
        "signing": signing,
        "platforms": platforms,
        "provider": provider,
        "pipeline": pipeline,
        "ci_side": [dict(item) for item in _CI_SIDE_PREREQS],
    }


def _release_url(r: BuildRequest) -> str | None:
    """نشانی Release مقصد — فقط برای درخواستی که واقعاً با تگ dispatch شده.

    تگ از همان سیاست release_tag_for بازسازی می‌شود (production + نسخهٔ
    معتبر)؛ تا وقتی dispatch انجام نشده باشد (dispatched_at خالی) یا ریپو
    پیکربندی نشده باشد، None است — لینک حدسی ساخته نمی‌شود.
    """
    tag = release_tag_for(version=r.version, branding=r.branding or {})
    if not tag or r.dispatched_at is None:
        return None
    repo = get_settings().github_repo.strip()
    if not repo:
        return None
    return f"https://github.com/{repo}/releases/tag/{tag}"


def _request_out(r: BuildRequest) -> dict:
    return {
        "id": str(r.id), "platform": r.platform, "version": r.version,
        "ref": r.ref, "status": r.status, "note": r.note,
        "branding": r.branding or {},
        "provider": r.provider,
        "provider_run_id": r.provider_run_id,
        "provider_run_url": r.provider_run_url,
        "artifact_name": r.artifact_name,
        "release_url": _release_url(r),
        "dispatched_at": r.dispatched_at.isoformat() if r.dispatched_at else None,
        "created_at": r.created_at.isoformat(),
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
    }


async def request_rebuild(
    db: AsyncSession,
    *,
    actor: User,
    platform: str,
    version: str | None = None,
    ref: str | None = None,
    note: str | None = None,
    app_name: str | None = None,
    package_id: str | None = None,
    version_code: int | None = None,
    api_url: str | None = None,
    environment: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict:
    """ساخت درخواست بازسازی + dispatch واقعی به GitHub Actions.

    بدون ارائه‌دهندهٔ پیکربندی‌شده: 503 صادقانه و هیچ ردیفی ساخته نمی‌شود.
    خطای dispatch: ردیف با وضعیت failed می‌ماند (نه queued ابدی) و 502 برمی‌گردد.
    """
    if platform not in PLATFORMS:
        raise APIError(422, "bad_platform", f"پلتفرم نامعتبر: {platform}")
    if not provider_status()["configured"]:
        raise APIError(
            503, "build_provider_not_configured",
            "ارائه‌دهندهٔ بیلد پیکربندی نشده است: GITHUB_DISPATCH_TOKEN و "
            "GITHUB_REPO را در محیط API تنظیم کنید (docs/ops/APK_BUILD_GUIDE.md).",
        )
    branding = validate_branding(
        app_name=app_name, package_id=package_id, version_code=version_code,
        api_url=api_url, environment=environment,
    )
    prereqs = await get_prereqs(db)
    ready = prereqs["platforms"][platform]["ready"]

    req = BuildRequest(
        platform=platform, version=version, ref=ref,
        status="queued", note=note, requested_by=actor.id,
        branding=branding, provider=PROVIDER_GITHUB,
    )
    db.add(req)
    await db.flush()

    workflow, body = build_dispatch_body(
        platform=platform, ref=ref, version=version,
        branding=branding, request_id=str(req.id),
    )
    repo = get_settings().github_repo.strip()

    async def _dispatch(c: httpx.AsyncClient) -> None:
        resp = await c.post(
            f"/repos/{repo}/actions/workflows/{workflow}/dispatches", json=body
        )
        if resp.status_code != 204:
            raise APIError(
                502, "build_dispatch_failed",
                f"GitHub dispatch ناموفق بود (HTTP {resp.status_code}) — "
                "وضعیت workflow و دسترسی توکن را بررسی کنید.",
                {"request_id": str(req.id), "github_status": resp.status_code},
            )
        req.dispatched_at = _utcnow()
        # بهترین تلاش: run تازه‌ساخته‌شده را همین حالا پیدا کن؛ اگر هنوز
        # در فهرست GitHub نیامده باشد، کرون sync آن را نسبت می‌دهد.
        try:
            await _match_and_apply_run(db, c, req)
        except httpx.HTTPError:
            pass

    try:
        if client is not None:
            await _dispatch(client)
        else:
            async with _make_client() as c:
                await _dispatch(c)
    except (APIError, httpx.HTTPError) as exc:
        # dispatch انجام نشد — ردیف صادقانه failed می‌شود، نه queued ابدی
        req.status = "failed"
        req.finished_at = _utcnow()
        await log_audit(
            db, actor_id=actor.id, actor_type="admin",
            action="builds.rebuild.dispatch_failed",
            entity_type="build_request", entity_id=str(req.id),
            new_values={"platform": platform, "workflow": workflow,
                        "error": type(exc).__name__},
            ip=ip, user_agent=user_agent,
        )
        await db.commit()
        if isinstance(exc, APIError):
            raise
        raise APIError(
            502, "build_dispatch_failed",
            "خطای شبکه در dispatch به GitHub — وضعیت اتصال و توکن را بررسی کنید.",
            {"request_id": str(req.id)},
        ) from exc

    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="builds.rebuild.request",
        entity_type="build_request", entity_id=str(req.id),
        new_values={"platform": platform, "version": version, "ref": ref,
                    "provider": PROVIDER_GITHUB, "workflow": workflow,
                    "branding": branding,
                    "provider_run_id": req.provider_run_id,
                    "signing_ready": ready,
                    "missing_signing": prereqs["platforms"][platform]["missing"]},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(req)
    return {
        **_request_out(req),
        "signing_ready": ready,
        "missing_signing": prereqs["platforms"][platform]["missing"],
        "note": ("درخواست به GitHub Actions ارسال شد — وضعیت از روی اجرای "
                 "واقعی workflow همگام می‌شود و لینک اجرا در جدول درخواست‌ها می‌آید."),
    }


async def list_requests(
    db: AsyncSession, *, platform: str | None = None, limit: int = 50
) -> list[dict]:
    stmt = select(BuildRequest).order_by(BuildRequest.created_at.desc())
    if platform:
        if platform not in PLATFORMS:
            raise APIError(422, "bad_platform", f"پلتفرم نامعتبر: {platform}")
        stmt = stmt.where(BuildRequest.platform == platform)
    rows = (await db.execute(stmt.limit(min(limit, 200)))).scalars().all()
    return [_request_out(r) for r in rows]


async def create_release(
    db: AsyncSession,
    *,
    actor: User | None,
    platform: str,
    version: str,
    build_number: str | None = None,
    download_url: str | None = None,
    download_expires_at: datetime | None = None,
    signed: bool = False,
    build_metadata: dict | None = None,
    artifact_key: str | None = None,
    file_size_bytes: int | None = None,
    sha256: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    storage: StorageProvider | None = None,
) -> dict:
    """ثبت نسخهٔ منتشرشده — معمولاً توسط CI صدا زده می‌شود، نه دستی.

    مسیر CI (B-01): actor=None و احراز با توکن سرویس انجام شده است؛
    فایل قبلاً توسط workflow به باکت builds فرستاده شده و این‌جا فقط
    کلید/اندازه/sha256 آن ثبت می‌شود. پس از ثبت، نگهداری انتشارها
    (۱۰ گروه انتشار آخر هر پلتفرم — FIX2-11) اعمال می‌شود.
    signed فقط وقتی true می‌شود که بیلد واقعاً امضاشده باشد (§۱۵.۹).
    """
    if platform not in PLATFORMS:
        raise APIError(422, "bad_platform", f"پلتفرم نامعتبر: {platform}")
    if not version:
        raise APIError(422, "missing_version", "version الزامی است")
    artifact_key = validate_artifact_key(artifact_key)
    # FIX2-07: download_url فقط وقتی اعتبارسنجی می‌شود که واقعاً ذخیره
    # و سرو شود (signed)؛ برای بیلد امضانشده مثل قبل دور ریخته می‌شود.
    if signed:
        download_url = validate_download_url(download_url)
    if sha256 is not None and not _SHA256_RE.match(sha256.strip()):
        raise APIError(422, "bad_sha256", "sha256 باید ۶۴ نویسهٔ hex باشد")
    if file_size_bytes is not None and file_size_bytes < 0:
        raise APIError(422, "bad_file_size", "file_size_bytes نمی‌تواند منفی باشد")
    rel = BuildRelease(
        platform=platform, version=version, build_number=build_number,
        download_url=download_url if signed else None,
        download_expires_at=download_expires_at,
        artifact_key=artifact_key,
        file_size_bytes=file_size_bytes,
        sha256=sha256.strip().lower() if sha256 else None,
        signed=signed, build_metadata=build_metadata or {},
        released_by=actor.id if actor is not None else None,
    )
    db.add(rel)
    await db.flush()
    await log_audit(
        db,
        actor_id=actor.id if actor is not None else None,
        actor_type="admin" if actor is not None else "service",
        action="builds.release.create",
        entity_type="build_release", entity_id=str(rel.id),
        new_values={"platform": platform, "version": version,
                    "build_number": build_number, "signed": signed,
                    "has_file": bool(artifact_key)},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    # نگهداری: فقط ۱۰ گروه انتشار آخر این پلتفرم می‌ماند (FIX2-11)
    await prune_releases(db, platform=platform, storage=storage)
    await db.refresh(rel)
    return await _release_out(rel, storage=storage)
