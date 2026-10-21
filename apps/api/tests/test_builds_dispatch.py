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
