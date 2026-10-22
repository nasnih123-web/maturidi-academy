"""تست‌های dispatch واقعی مرکز بیلدها — F-05 remediation.

پوشش:
- اعتبارسنجی package_id و بقیهٔ برندینگ (تابع خالص validate_branding)
- بدنهٔ workflow_dispatch و نگاشت وضعیت run (توابع خالص)
- انتخاب run متناظر درخواست (pick_run_for_request)
- صداقت «پیکربندی نشده»: POST /rebuild با خطای 503 و کد
  build_provider_not_configured و هیچ ردیف queuedای ساخته نمی‌شود
- جریان کامل dispatch با GitHub mockشده (httpx MockTransport): هدر/بدنهٔ
  درست، run بلافاصله match می‌شود، توکن هیچ‌جا ذخیره نمی‌شود
- خطای dispatch → ردیف failed (نه queued ابدی) + خطای 502
- sync: گذار وضعیت از روی run payloadها + artifact + ردیف legacy دست‌نخورده
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.admin import builds_service as svc

BASE = "/api/v1"
TOKEN = "test-token-not-a-real-secret"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...] = ("builds.manage",)):
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        role = Role(name=f"bd_test_role_{suffix}", description="builds dispatch test")
        db.add(role)
        await db.flush()
        for key in permissions:
            p = (
                await db.execute(select(Permission).where(Permission.key == key))
            ).scalar_one_or_none()
            if p is None:
                p = Permission(key=key, description=key)
                db.add(p)
                await db.flush()
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست بیلد",
            email=f"bd-{suffix}@example.com",
            phone=f"+98911{abs(hash(suffix)) % 10**7:07d}",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        jwt_value = create_access_token(str(user.id))
        return {"Authorization": f"Bearer {jwt_value}", "user_id": str(user.id)}


@pytest.fixture
def gh_configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "github_dispatch_token", TOKEN)
    monkeypatch.setattr(s, "github_repo", "owner/repo")
    return s


def _mock_client(handler) -> httpx.AsyncClient:
    # هدرها همان‌هایی‌اند که فکتوری واقعی سرویس (_make_client) می‌سازد
    return httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://api.github.com",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )


def _gh_ts(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# توابع خالص: اعتبارسنجی برندینگ
# ---------------------------------------------------------------------------


def test_validate_package_id_accepts_java_names():
    out = svc.validate_branding(package_id="org.maturidi.academy")
    assert out["package_id"] == "org.maturidi.academy"
    out = svc.validate_branding(package_id="com.example.app2")
    assert out["package_id"] == "com.example.app2"


@pytest.mark.parametrize(
    "bad",
    ["app", "1org.example", "Org.example", "org..example", "org.example-", "org.ex ample"],
)
def test_validate_package_id_rejects_bad_names(bad):
    with pytest.raises(APIError) as ei:
        svc.validate_branding(package_id=bad)
    assert ei.value.code == "invalid_package_id"
    assert ei.value.status_code == 422


def test_validate_branding_other_rules():
    with pytest.raises(APIError) as ei:
        svc.validate_branding(version_code=0)
    assert ei.value.code == "invalid_version_code"
    with pytest.raises(APIError) as ei:
        svc.validate_branding(environment="staging")
    assert ei.value.code == "invalid_environment"
    # localhost در production ممنوع؛ در preview مجاز (همان گارد F-09)
    with pytest.raises(APIError) as ei:
        svc.validate_branding(environment="production", api_url="http://localhost:8000")
    assert ei.value.code == "invalid_api_url"
    out = svc.validate_branding(environment="preview", api_url="http://localhost:8000/")
    assert out["api_url"] == "http://localhost:8000"


# ---------------------------------------------------------------------------
# توابع خالص: بدنهٔ dispatch + نگاشت وضعیت + انتخاب run
# ---------------------------------------------------------------------------


def test_build_dispatch_body_mobile_inputs_are_strings():
    workflow, body = svc.build_dispatch_body(
        platform="android", ref=None, version="1.1.0",
        branding={"app_name": "آکادمی", "package_id": "org.maturidi.academy",
                  "version_code": 7, "api_url": "https://api.example.com",
                  "environment": "production"},
        request_id="req-1",
    )
    assert workflow == "mobile.yml"
    assert body["ref"] == "main"
    inputs = body["inputs"]
    assert inputs["profile"] == "production-apk"  # production → پروفایل APK واقعی
    assert inputs["version_code"] == "7"
    # production + نسخهٔ معتبر → تگ Release مقصد (سیاست release_tag_for)
    assert inputs["release_tag"] == "v1.1.0"
    assert all(isinstance(v, str) for v in inputs.values())
    assert len(inputs) <= 10  # سقف GitHub برای inputs


def test_build_dispatch_body_desktop_has_no_inputs():
    workflow, body = svc.build_dispatch_body(
        platform="desktop", ref="release/x", version=None, branding={},
        request_id="req-2",
    )
    assert workflow == "desktop.yml"
    assert body == {"ref": "release/x"}


@pytest.mark.parametrize(
    "version,branding,expected",
    [
        ("1.1.0", {"environment": "production"}, "v1.1.0"),
        ("10.20.30", {"environment": "production"}, "v10.20.30"),
        ("1.1.0", {"environment": "preview"}, ""),
        ("1.1.0", {"environment": "development"}, ""),
        ("1.1.0", {}, ""),  # بدون environment → production نیست
        (None, {"environment": "production"}, ""),
        ("", {"environment": "production"}, ""),
        ("1.1", {"environment": "production"}, ""),  # ناقص
        ("v1.1.0", {"environment": "production"}, ""),  # پیشوند v مجاز نیست
        ("1.1.0-rc.1", {"environment": "production"}, ""),  # پسوند مجاز نیست
    ],
)
def test_release_tag_for_policy(version, branding, expected):
    assert svc.release_tag_for(version=version, branding=branding) == expected


def test_build_dispatch_body_mobile_release_tag_empty_cases():
    # preview → تگ خالی: فقط workflow artifact، هیچ Releaseای لمس نمی‌شود
    _, body = svc.build_dispatch_body(
        platform="android", ref=None, version="1.1.0",
        branding={"environment": "preview"}, request_id="r",
    )
    assert body["inputs"]["release_tag"] == ""
    # production بدون نسخه → تگ خالی
    _, body = svc.build_dispatch_body(
        platform="ios", ref=None, version=None,
        branding={"environment": "production"}, request_id="r",
    )
    assert body["inputs"]["release_tag"] == ""
    # production با نسخهٔ نامعتبر → تگ خالی
    _, body = svc.build_dispatch_body(
        platform="android", ref=None, version="1.1",
        branding={"environment": "production"}, request_id="r",
    )
    assert body["inputs"]["release_tag"] == ""


def test_build_dispatch_body_desktop_sends_release_tag_only():
    # desktop.yml فقط release_tag را تعریف کرده است — همان یکی، تنها
    workflow, body = svc.build_dispatch_body(
        platform="desktop", ref="main", version="1.2.3",
        branding={"environment": "production"}, request_id="req-3",
    )
    assert workflow == "desktop.yml"
    assert body == {"ref": "main", "inputs": {"release_tag": "v1.2.3"}}
    # preview دسکتاپ → سیاست تگی نمی‌دهد → بدون inputs (قرارداد قبلی)
    workflow, body = svc.build_dispatch_body(
        platform="desktop", ref="main", version="1.2.3",
        branding={"environment": "preview"}, request_id="req-4",
    )
    assert body == {"ref": "main"}


def test_release_url_only_after_tagged_dispatch(gh_configured):
    from app.models.models import BuildRequest

    req = BuildRequest(
        platform="android", version="1.1.0", status="queued",
        branding={"environment": "production"},
        created_at=datetime.now(UTC),
    )
    # هنوز dispatch نشده → لینکی ساخته نمی‌شود
    assert svc._request_out(req)["release_url"] is None
    req.dispatched_at = datetime.now(UTC)
    assert svc._request_out(req)["release_url"] == (
        "https://github.com/owner/repo/releases/tag/v1.1.0"
    )
    # preview با همان نسخه → سیاست تگی نمی‌دهد → بدون لینک
    req2 = BuildRequest(
        platform="android", version="1.1.0", status="running",
        branding={"environment": "preview"},
        dispatched_at=datetime.now(UTC), created_at=datetime.now(UTC),
    )
    assert svc._request_out(req2)["release_url"] is None


@pytest.mark.parametrize(
    "run,expected",
    [
        ({"status": "queued"}, "queued"),
        ({"status": "in_progress"}, "running"),
        ({"status": "waiting"}, "running"),
        ({"status": "completed", "conclusion": "success"}, "completed"),
        ({"status": "completed", "conclusion": "failure"}, "failed"),
        ({"status": "completed", "conclusion": "cancelled"}, "failed"),
        ({"status": "something-else"}, None),
    ],
)
def test_map_run_status(run, expected):
    assert svc.map_run_status(run) == expected


def test_pick_run_for_request_skips_claimed_and_old():
    now = datetime.now(UTC)
    runs = [
        {"id": 3, "created_at": _gh_ts(now)},                     # claimed
        {"id": 2, "created_at": _gh_ts(now - timedelta(hours=2))},  # too old
        {"id": 1, "created_at": _gh_ts(now - timedelta(seconds=5))},
    ]
    picked = svc.pick_run_for_request(
        runs, dispatched_at=now, claimed_run_ids={"3"}
    )
    assert picked is not None and picked["id"] == 1
    assert svc.pick_run_for_request(
        runs, dispatched_at=now, claimed_run_ids={"1", "3"}
    ) is None


# ---------------------------------------------------------------------------
# صداقت «پیکربندی نشده» — سطح API
# ---------------------------------------------------------------------------


async def test_rebuild_unconfigured_is_503_and_creates_nothing(tc):
    admin = await _make_user(tc)
    client = tc["client"]
    before = (await client.get(f"{BASE}/admin/builds/requests", headers=admin)).json()

    r = await client.post(
        f"{BASE}/admin/builds/rebuild", headers=admin,
        json={"platform": "android", "version": "9.9.9"},
    )
    assert r.status_code == 503, r.text
    assert r.json()["error"]["code"] == "build_provider_not_configured"

    after = (await client.get(f"{BASE}/admin/builds/requests", headers=admin)).json()
    assert len(after) == len(before)  # هیچ «queued» دروغینی ساخته نشد

    # prereqs وضعیت ارائه‌دهنده را صادقانه نشان می‌دهد
    pre = (await client.get(f"{BASE}/admin/builds/prereqs", headers=admin)).json()
    assert pre["provider"]["configured"] is False
    assert pre["provider"]["provider"] is None
    # C-05: بخش pipeline کامل و صادقانه است — در محیط تست هیچ‌کدام از
    # پیش‌نیازهای خط لوله برقرار نیست و endpoint نباید قول توخالی بدهد.
    pipe = pre["pipeline"]
    assert pipe["callback_token_configured"] is False
    assert pipe["github_dispatch_configured"] is False
    assert pipe["expo_project_linked"] is False
    assert pipe["expo_project_id"] is None
    assert pipe["api_base_url"]  # از config خوانده می‌شود (localhost تست)
    assert pipe["api_base_url_is_local"] is True
    ci_keys = {item["key"] for item in pre["ci_side"]}
    assert "EXPO_TOKEN" in ci_keys
    assert all(item["api_visible"] is False for item in pre["ci_side"])
    assert all(item["where"] and item["verified_by"] for item in pre["ci_side"])


async def test_rebuild_bad_package_id_is_422(tc, gh_configured):
    admin = await _make_user(tc)
    r = await tc["client"].post(
        f"{BASE}/admin/builds/rebuild", headers=admin,
        json={"platform": "android", "package_id": "not a package"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "invalid_package_id"


# ---------------------------------------------------------------------------
# جریان dispatch — سطح سرویس با GitHub mockشده
# ---------------------------------------------------------------------------


async def test_dispatch_flow_matches_run_and_hides_token(tc, gh_configured):
    admin = await _make_user(tc)
    captured: list[httpx.Request] = []
    now = datetime.now(UTC)

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        path = request.url.path
        if request.method == "POST" and path.endswith("/dispatches"):
            return httpx.Response(204)
        if path.endswith("/runs"):
            return httpx.Response(200, json={"workflow_runs": [{
                "id": 4242, "status": "in_progress", "conclusion": None,
                "html_url": "https://github.com/owner/repo/actions/runs/4242",
                "created_at": _gh_ts(now),
            }]})
        return httpx.Response(404)

    async with tc["maker"]() as db:
        from app.models.models import User

        actor = await db.get(User, uuid.UUID(admin["user_id"]))
        out = await svc.request_rebuild(
            db, actor=actor, platform="android", version="1.1.0",
            package_id="org.maturidi.academy", version_code=7,
            api_url="https://api.example.com", environment="production",
            client=_mock_client(handler),
        )

    assert out["status"] == "running"  # از روی run واقعی، نه حدس
    assert out["provider"] == "github_actions"
    assert out["provider_run_id"] == "4242"
    assert out["provider_run_url"].endswith("/4242")
    assert out["branding"]["package_id"] == "org.maturidi.academy"

    dispatch = captured[0]
    assert dispatch.url.path == (
        "/repos/owner/repo/actions/workflows/mobile.yml/dispatches"
    )
    assert dispatch.headers["Authorization"] == f"Bearer {TOKEN}"
    body = json.loads(dispatch.content)
    assert body["inputs"]["request_id"] == out["id"]
    assert body["inputs"]["profile"] == "production-apk"
    # production + نسخهٔ 1.1.0 → تگ مقصد فرستاده و نشانی Release روی خروجی است
    assert body["inputs"]["release_tag"] == "v1.1.0"
    assert out["release_url"] == (
        "https://github.com/owner/repo/releases/tag/v1.1.0"
    )

    # توکن در هیچ خروجی/رکوردی نیست (§۱۴)
    assert TOKEN not in str(out)
    async with tc["maker"]() as db:
        from app.models.models import BuildRequest

        row = (
            await db.execute(
                select(BuildRequest).where(BuildRequest.id == uuid.UUID(out["id"]))
            )
        ).scalar_one()
        assert TOKEN not in str(row.branding)
        assert row.provider_run_id == "4242"


async def test_dispatch_failure_marks_request_failed(tc, gh_configured):
    admin = await _make_user(tc)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "Not Found"})

    async with tc["maker"]() as db:
        from app.models.models import BuildRequest, User

        actor = await db.get(User, uuid.UUID(admin["user_id"]))
        with pytest.raises(APIError) as ei:
            await svc.request_rebuild(
                db, actor=actor, platform="android",
                client=_mock_client(handler),
            )
        assert ei.value.code == "build_dispatch_failed"
        assert ei.value.status_code == 502
        req_id = ei.value.details["request_id"]
        row = await db.get(BuildRequest, uuid.UUID(req_id))
        assert row is not None
        assert row.status == "failed"  # نه queued ابدی
        assert row.finished_at is not None


# ---------------------------------------------------------------------------
# sync — گذار وضعیت از payloadهای run
# ---------------------------------------------------------------------------


async def test_sync_transitions_and_artifacts(tc, gh_configured):
    from app.models.models import BuildRequest

    now = datetime.now(UTC)
    async with tc["maker"]() as db:
        done = BuildRequest(
            platform="android", status="running", provider="github_actions",
            provider_run_id="777", dispatched_at=now - timedelta(minutes=5),
            branding={},
        )
        match = BuildRequest(
            platform="ios", status="queued", provider="github_actions",
            dispatched_at=now - timedelta(seconds=30), branding={},
        )
        legacy = BuildRequest(platform="android", status="queued", branding={})
        db.add_all([done, match, legacy])
        await db.commit()
        done_id, match_id, legacy_id = done.id, match.id, legacy.id

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/actions/runs/777"):
            return httpx.Response(200, json={
                "id": 777, "status": "completed", "conclusion": "success",
                "html_url": "https://github.com/owner/repo/actions/runs/777",
            })
        if path.endswith("/actions/runs/777/artifacts"):
            return httpx.Response(200, json={"artifacts": [
                {"name": "mobile-build-xyz"}, {"name": "other"},
            ]})
        if path.endswith("/runs"):
            return httpx.Response(200, json={"workflow_runs": [{
                "id": 888, "status": "queued", "conclusion": None,
                "html_url": "https://github.com/owner/repo/actions/runs/888",
                "created_at": _gh_ts(now),
            }]})
        return httpx.Response(404)

    async with tc["maker"]() as db:
        out = await svc.sync_build_requests(db, client=_mock_client(handler))
    # شمارش سراسری به DB اشتراکی نشست حساس است؛ وضعیت ردیف‌های خودمان قطعی است
    assert out["provider_configured"] is True
    assert out["checked"] >= 2
    assert out["updated"] == 2

    async with tc["maker"]() as db:
        done = await db.get(BuildRequest, done_id)
        match = await db.get(BuildRequest, match_id)
        legacy = await db.get(BuildRequest, legacy_id)
        assert done.status == "completed"
        assert done.artifact_name == "mobile-build-xyz"
        assert done.finished_at is not None
        assert match.provider_run_id == "888"
        assert match.status == "queued"  # run هنوز queued است — صادقانه
        # ردیف legacy فاز ۱۴ دست‌نخورده: هرگز dispatch نشده
        assert legacy.status == "queued" and legacy.provider is None


async def test_sync_unconfigured_is_noop(tc):
    async with tc["maker"]() as db:
        out = await svc.sync_build_requests(db, client=_mock_client(lambda r: httpx.Response(500)))
    assert out == {"provider_configured": False, "checked": 0, "updated": 0}


# ---------------------------------------------------------------------------
# B-01 — callback سرویس CI: ثبت انتشار با فایل واقعی + URL امضاشده + pruning
# ---------------------------------------------------------------------------

SERVICE_TOKEN = "<MASKED_SECRET_002>"


@pytest.fixture
def svc_token_configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "builds_service_token", SERVICE_TOKEN)
    return s


def _release_payload(**over):
    payload = {
        "platform": "android",
        "version": "1.1.0",
        "build_number": "42",
        "artifact_key": "builds/android/1.1.0/42/app.apk",
        "file_size_bytes": 12345,
        "sha256": "a" * 64,
        "signed": True,
        "build_metadata": {"filename": "app.apk"},
    }
    payload.update(over)
    return payload


async def test_ci_callback_registers_release_and_signs_url(tc, svc_token_configured):
    """مسیر CI واقعی: توکن سرویس → ۲۰۱ + download_url تازه و امضاشده."""
    from app.models.models import BuildRelease

    client = tc["client"]
    r = await client.post(
        f"{BASE}/admin/builds/releases",
        json=_release_payload(),
        headers={"X-Build-Service-Token": SERVICE_TOKEN},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["has_file"] is True
    assert body["artifact_key"] == "builds/android/1.1.0/42/app.apk"
    assert body["file_size_bytes"] == 12345
    assert body["sha256"] == "a" * 64
    # URL از StorageProvider محلی: امضای HMAC روی کلید + انقضا دارد
    assert body["download_url"] and "app.apk" in body["download_url"]
    assert "sig=" in body["download_url"]
    assert body["download_expires_at"]

    async with tc["maker"]() as db:
        row = (
            await db.execute(
                select(BuildRelease).where(
                    BuildRelease.artifact_key == "builds/android/1.1.0/42/app.apk"
                )
            )
        ).scalar_one()
        # سرویس CI کاربر نیست — released_by خالی می‌ماند
        assert row.released_by is None

    # فهرست مدیر هم برای همین release URL امضاشده می‌دهد (دکمهٔ دانلود CRM)
    admin = await _make_user(tc)
    r2 = await client.get(
        f"{BASE}/admin/builds/releases?platform=android", headers=admin
    )
    assert r2.status_code == 200, r2.text
    mine = [
        x for x in r2.json()
        if x["artifact_key"] == "builds/android/1.1.0/42/app.apk"
    ]
    assert mine and mine[0]["has_file"] is True and mine[0]["download_url"]


async def test_ci_callback_wrong_token_rejected(tc, svc_token_configured):
    r = await tc["client"].post(
        f"{BASE}/admin/builds/releases",
        json=_release_payload(),
        headers={"X-Build-Service-Token": "wrong-token"},
    )
    # توکن اشتباه → مسیر کاربر؛ بدون Bearer یعنی 401
    assert r.status_code == 401, r.text


async def test_ci_callback_inactive_when_token_unconfigured(tc):
    """پیش‌فرض (BUILDS_SERVICE_TOKEN خالی): هدر هیچ اثری ندارد."""
    r = await tc["client"].post(
        f"{BASE}/admin/builds/releases",
        json=_release_payload(),
        headers={"X-Build-Service-Token": SERVICE_TOKEN},
    )
    assert r.status_code == 401, r.text


async def test_ci_callback_bad_artifact_key_is_422(tc, svc_token_configured):
    for bad in ("../evil.apk", "other/app.apk", "/builds/x.apk", "builds/../x.apk"):
        r = await tc["client"].post(
            f"{BASE}/admin/builds/releases",
            json=_release_payload(artifact_key=bad),
            headers={"X-Build-Service-Token": SERVICE_TOKEN},
        )
        assert r.status_code == 422, (bad, r.text)
        assert r.json()["error"]["code"] == "bad_artifact_key"


async def test_admin_user_path_still_works_for_releases(tc):
    """مسیر قدیمی (کاربرِ دارای مجوز) دست‌نخورده مانده است."""
    admin = await _make_user(tc)
    r = await tc["client"].post(
        f"{BASE}/admin/builds/releases",
        json=_release_payload(version="9.9.9", artifact_key=None, signed=False),
        headers=admin,
    )
    assert r.status_code == 201, r.text
    assert r.json()["has_file"] is False
    assert r.json()["download_url"] is None


async def test_release_pruning_keeps_last_10_and_deletes_files(
    tc, svc_token_configured, monkeypatch, tmp_path
):
    """نگهداری B-01: ۱۱ ثبت → ۱۰ رکورد آخر + حذف فایل قدیمی‌ترین از storage."""
    import os

    from app.core.storage import get_storage

    s = get_settings()
    monkeypatch.setattr(s, "storage_provider", "local")
    monkeypatch.setattr(s, "storage_local_dir", str(tmp_path))
    storage = get_storage()

    client = tc["client"]
    for i in range(11):
        key = f"builds/desktop/1.0.{i}/1/app-{i}.bin"
        await storage.put_object(key, b"x" * 10, "application/octet-stream")
        r = await client.post(
            f"{BASE}/admin/builds/releases",
            json=_release_payload(
                platform="desktop", version=f"1.0.{i}", build_number="1",
                artifact_key=key, sha256="b" * 64, signed=False,
            ),
            headers={"X-Build-Service-Token": SERVICE_TOKEN},
        )
        assert r.status_code == 201, r.text

    admin = await _make_user(tc)
    r = await client.get(
        f"{BASE}/admin/builds/releases?platform=desktop&limit=50", headers=admin
    )
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 10, [x["version"] for x in rows]
    keys = {x["artifact_key"] for x in rows}
    oldest = "builds/desktop/1.0.0/1/app-0.bin"
    newest = "builds/desktop/1.0.10/1/app-10.bin"
    assert oldest not in keys and newest in keys
    # فایل قدیمی‌ترین از storage هم حذف شده است؛ تازه‌ترین سر جایش است
    assert not os.path.exists(os.path.join(str(tmp_path), oldest))
    assert os.path.exists(os.path.join(str(tmp_path), newest))


async def test_prereqs_expo_project_linked_when_setting_present(tc):
    """C-05: با ثبت builds.expo_project_id، prereqs لینک‌شدن Expo را نشان می‌دهد."""
    from sqlalchemy import delete

    from app.core.platform_settings import (
        reset_settings_cache,
        stage_setting,
    )
    from app.models.models import PlatformSetting

    admin = await _make_user(tc)
    async with tc["maker"]() as session:
        try:
            await stage_setting(session, "builds.expo_project_id", "expo-proj-123")
            await session.commit()
            reset_settings_cache()
            pre = (
                await tc["client"].get(f"{BASE}/admin/builds/prereqs", headers=admin)
            ).json()
            assert pre["pipeline"]["expo_project_linked"] is True
            assert pre["pipeline"]["expo_project_id"] == "expo-proj-123"
        finally:
            await session.execute(
                delete(PlatformSetting).where(
                    PlatformSetting.key == "builds.expo_project_id"
                )
            )
            await session.commit()
            reset_settings_cache()
