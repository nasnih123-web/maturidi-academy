"""تست‌های بلادرنگ فاز ۲.

- (a) اتصال WebSocket با JWT معتبر → اشتراک → emit_event → دریافت توسط کلاینت
- (b) JWT نامعتبر → handshake رد می‌شود
- (c) قطع اتصال، emit دو رویداد، اتصال مجدد با last_event_id → دقیقاً همان ۲ رویداد به‌ترتیب
- (d) رجیستری adapter با adapter ساختگی: round-trip کامل list/preview/policies
- اضافه: dispatch_once (processed/dead-letter) و API تنظیمات ادمین (mask، hot-reload، audit)

تست‌های WebSocket با سرور uvicorn واقعی در thread جدا اجرا می‌شوند تا مسیر کامل
emit_event → dispatcher → bus → gateway → client تست شود.
"""
from __future__ import annotations

import asyncio
import json
import socket
import threading
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
import websockets
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.content.service import ContentAdapter

# ---------- helpers ----------


async def _make_user(maker, email: str):
    from app.core.security import hash_password
    from app.models.models import User

    async with maker() as db:
        user = User(
            full_name="کاربر تست",
            email=email,
            password_hash=hash_password("x" * 12),
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


def _token(user) -> str:
    from app.core.security import create_access_token

    return create_access_token(str(user.id))


async def _bound_token(maker, user) -> str:
    """توکن دسترسیِ گره‌خورده به نشست — شکل واقعی production.

    پس از سخت‌گیری final remediation (Track 2)، مسیر `POST /ws-ticket`
    توکنِ بدون `sid` را با 401 رد می‌کند.
    """
    from app.core.security import create_access_token
    from app.models.models import Session

    async with maker() as db:
        session = Session(user_id=user.id, device_info="ws-test", ip="127.0.0.1")
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return create_access_token(str(user.id), extra={"sid": str(session.id)})


async def _ticket(ws_url: str, maker, user) -> str:
    """گرفتن بلیط WS از همان سرور تست با توکنِ نشست‌دار (مسیر پشتیبانی‌شده
    پس از حذف ?token= و سخت‌گیری گره‌خوردگی به نشست)."""
    import httpx

    token = await _bound_token(maker, user)
    http_base = ws_url.replace("ws://", "http://").rsplit("/ws/events", 1)[0]
    async with httpx.AsyncClient(trust_env=False, timeout=10.0) as client:
        r = await client.post(
            f"{http_base}/api/v1/auth/ws-ticket",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    return r.json()["ticket"]


async def _emit(maker, event_type: str, payload: dict | None = None):
    from app.core.events import emit_event

    async with maker() as db:
        ev = await emit_event(
            db,
            aggregate_type="test",
            aggregate_id=str(uuid.uuid4()),
            event_type=event_type,
            payload=payload or {},
        )
        await db.commit()
        return str(ev.event_id)


async def _wait_processed(maker, event_id: str, timeout: float = 20.0) -> None:
    """منتظر processed شدن رویداد توسط dispatcher — حذف race تحویل زنده."""
    from app.models.models import DomainEvent

    deadline = asyncio.get_running_loop().time() + timeout
    eid = uuid.UUID(event_id)
    while True:
        async with maker() as db:
            ev = await db.get(DomainEvent, eid)
            if ev is not None and ev.processed_at is not None:
                return
        if asyncio.get_running_loop().time() > deadline:
            raise TimeoutError(f"event {event_id} was not processed in time")
        await asyncio.sleep(0.1)


async def _recv_event(ws, timeout: float = 15.0) -> dict:
    """اولین پیام از نوع event را برمی‌گرداند (ackهای subscribed نادیده گرفته می‌شوند)."""
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        if msg.get("type") == "event":
            return msg


# ---------- fixture: سرور واقعی (روی همان دیتابیس tc) ----------


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def ws_env(tc):
    """سرور uvicorn واقعی در thread جدا — روی همان دیتابیس tc.

    عمداً دیتابیس جدا نمی‌سازیم تا نیازی به دست‌کاری سراسری
    app.dependency_overrides نباشد (با fixture جلسه‌ای tc تداخل می‌کرد).
    dispatcher از app.state.session_factory همان maker تست‌ها را می‌گیرد.
    """
    import uvicorn

    from app.main import app

    app.state.session_factory = tc["maker"]

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    import httpx

    async with httpx.AsyncClient(trust_env=False) as client:
        for _ in range(200):
            try:
                resp = await client.get(f"http://127.0.0.1:{port}/health")
                if resp.status_code == 200:
                    break
            except Exception:
                pass
            await asyncio.sleep(0.05)
        else:
            raise RuntimeError("test websocket server did not start")

    from app.core.realtime import manager

    yield {"ws_url": f"ws://127.0.0.1:{port}/ws/events", "maker": tc["maker"]}

    server.should_exit = True
    thread.join(timeout=15)
    manager.clear()
    if hasattr(app.state, "session_factory"):
        delattr(app.state, "session_factory")


# ---------- (a) subscribe → emit → receive ----------


async def test_ws_subscribe_and_receive(ws_env):
    maker = ws_env["maker"]
    user = await _make_user(maker, "ws-a@test.local")
    t = await _ticket(ws_env["ws_url"], maker, user)
    url = f"{ws_env['ws_url']}?ticket={t}&channels=test.alpha"
    async with websockets.connect(url) as ws:
        ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert ack["type"] == "subscribed" and ack["channel"] == "test.alpha"

        eid = await _emit(maker, "test.alpha", {"n": 1})
        msg = await _recv_event(ws)
        assert msg["event_id"] == eid
        assert msg["event_type"] == "test.alpha"
        assert msg["payload"] == {"n": 1}
        assert msg["aggregate_type"] == "test"


# ---------- (b) invalid JWT → handshake rejected ----------


async def test_ws_invalid_token_rejected(ws_env):
    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(f"{ws_env['ws_url']}?ticket=invalid-ticket-value"):
            pass  # pragma: no cover


async def test_ws_jwt_in_query_string_rejected(ws_env):
    """remediation-pass-2 Track 1: `?token=<JWT>` دیگر پذیرفته نیست —
    JWT معتبر هم در query string رد می‌شود (فقط هدر Authorization یا بلیط)."""
    maker = ws_env["maker"]
    user = await _make_user(maker, "ws-q@test.local")
    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(
            f"{ws_env['ws_url']}?token={_token(user)}"
        ):
            pass  # pragma: no cover


async def test_ws_missing_token_rejected(ws_env):
    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(ws_env["ws_url"]):
            pass  # pragma: no cover


# ---------- (c) reconnect with last_event_id replays missed events ----------


async def test_ws_replay_missed_events_in_order(ws_env):
    maker = ws_env["maker"]
    user = await _make_user(maker, "ws-c@test.local")
    token = _token(user)
    t = await _ticket(ws_env["ws_url"], maker, user)
    base = f"{ws_env['ws_url']}?ticket={t}&channels=test.replay"

    async with websockets.connect(base) as ws:
        await asyncio.wait_for(ws.recv(), timeout=10)  # subscribed ack
        eid0 = await _emit(maker, "test.replay", {"seq": 0})
        msg0 = await _recv_event(ws)
        assert msg0["event_id"] == eid0
        last_id = msg0["event_id"]
    # اتصال قطع شد — دو رویداد در غیاب کلاینت

    eid1 = await _emit(maker, "test.replay", {"seq": 1})
    await asyncio.sleep(0.02)  # ترتیب زمانی یکتا
    eid2 = await _emit(maker, "test.replay", {"seq": 2})
    await _wait_processed(maker, eid1)
    await _wait_processed(maker, eid2)

    t2 = await _ticket(ws_env["ws_url"], maker, user)
    base2 = f"{ws_env['ws_url']}?ticket={t2}&channels=test.replay"
    async with websockets.connect(f"{base2}&last_event_id={last_id}") as ws:
        m1 = await _recv_event(ws)
        m2 = await _recv_event(ws)
        assert [m1["event_id"], m2["event_id"]] == [eid1, eid2]
        assert [m1["payload"]["seq"], m2["payload"]["seq"]] == [1, 2]
        # چیز دیگری نباید برسد
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(ws.recv(), timeout=3)


async def test_ws_admin_channel_requires_permission(ws_env):
    """اشتراک admin.* بدون مجوز realtime.admin رد می‌شود."""
    maker = ws_env["maker"]
    user = await _make_user(maker, "ws-admin@test.local")
    t = await _ticket(ws_env["ws_url"], maker, user)
    url = f"{ws_env['ws_url']}?ticket={t}"
    async with websockets.connect(url) as ws:
        await ws.send(json.dumps({"type": "subscribe", "channel": "admin.secret"}))
        resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert resp["type"] == "error" and resp["code"] == "forbidden"


# ---------- (d) adapter registry round-trip ----------


class _DummyContentAdapter(ContentAdapter):
    content_type = "dummy"
    module = "testmod"

    async def list_items(self, filters):
        from app.modules.content.service import ContentRef

        items = [
            ContentRef(
                content_type="dummy", id="1", module="testmod", status="published",
                owner_id=None, title={"fa": "یک", "ar": "واحد", "en": "one"},
                created_at="2026-01-01T00:00:00+00:00", updated_at="2026-01-02T00:00:00+00:00",
                languages=["fa"],
            ),
            ContentRef(
                content_type="dummy", id="2", module="testmod", status="draft",
                owner_id=None, title={"fa": "دو", "ar": "اثنان", "en": "two"},
                created_at="2026-01-01T00:00:00+00:00", updated_at="2026-01-03T00:00:00+00:00",
                languages=["fa", "en"],
            ),
        ]
        if filters.get("status"):
            items = [i for i in items if i.status == filters["status"]]
        if filters.get("q"):
            items = [i for i in items if filters["q"] in i.title["fa"]]
        return items

    async def get_preview(self, item_id):
        from app.modules.content.service import ContentPreview, ContentRef

        if item_id != "1":
            return None
        ref = ContentRef(
            content_type="dummy", id="1", module="testmod", status="published",
            owner_id=None, title={"fa": "یک", "ar": "واحد", "en": "one"},
            created_at="2026-01-01T00:00:00+00:00", updated_at="2026-01-02T00:00:00+00:00",
            languages=["fa"],
        )
        return ContentPreview(
            ref=ref, preview={"html": "<h1>یک</h1>"},
            surfaces=["homepage.section"], locales=["fa"],
        )

    async def get_policies(self, item_id):
        from app.modules.content.service import ContentPolicies

        if item_id != "1":
            return None
        return ContentPolicies(
            ai_policy={"allowed_uses": [], "default": "none"},
            distribution={"web": True, "mobile": False,
                          "telegram": {"mode": "manual_approval"}},
            schedule=None,
            placement=[{"surface": "homepage.section", "sort_order": 1, "active": True}],
        )


def _blank_filters(**over):
    f = {"type": None, "module": None, "status": None, "owner": None,
         "date_from": None, "date_to": None, "q": None}
    f.update(over)
    return f


async def test_content_adapter_registry_roundtrip():
    from app.core.errors import APIError
    from app.modules.content import service
    from app.modules.content.service import (
        get_adapter,
        register_adapter,
        registered_types,
        unregister_adapter,
    )

    register_adapter(_DummyContentAdapter())
    try:
        assert "dummy" in registered_types()
        assert isinstance(get_adapter("dummy"), _DummyContentAdapter)

        items = await service.list_content(_blank_filters())
        assert len(items) == 2
        assert {i["id"] for i in items} == {"1", "2"}

        pub = await service.list_content(_blank_filters(status="published"))
        assert len(pub) == 1 and pub[0]["id"] == "1"

        q = await service.list_content(_blank_filters(q="دو"))
        assert len(q) == 1 and q[0]["id"] == "2"

        pv = await service.preview_content("dummy", "1")
        assert pv["preview"] == {"html": "<h1>یک</h1>"}
        assert pv["surfaces"] == ["homepage.section"]
        assert pv["locales"] == ["fa"]

        pol = await service.content_policies("dummy", "1")
        assert pol["ai_policy"] == {"allowed_uses": [], "default": "none"}
        assert pol["distribution"]["telegram"] == {"mode": "manual_approval"}
        assert pol["schedule"] is None
        assert pol["placement"][0]["surface"] == "homepage.section"

        with pytest.raises(APIError) as ei:
            await service.preview_content("nope", "1")
        assert ei.value.status_code == 404

        with pytest.raises(APIError) as ei2:
            await service.content_policies("dummy", "999")
        assert ei2.value.status_code == 404
    finally:
        unregister_adapter("dummy")
    assert "dummy" not in registered_types()


async def test_content_http_endpoints(tc):
    """سیم‌کشی HTTP مرکز محتوا — با همان adapter ساختگی."""
    from app.modules.content.service import register_adapter, unregister_adapter

    register_adapter(_DummyContentAdapter())
    try:
        user = await _make_user(tc["maker"], "content-http@test.local")
        headers = {"Authorization": f"Bearer {_token(user)}"}
        client = tc["client"]

        r = await client.get("/api/v1/content/items", headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 2

        r = await client.get("/api/v1/content/items", params={"status": "draft"}, headers=headers)
        assert r.json()["total"] == 1

        r = await client.get("/api/v1/content/items/dummy/1/preview", headers=headers)
        assert r.status_code == 200
        assert r.json()["preview"] == {"html": "<h1>یک</h1>"}

        r = await client.get("/api/v1/content/policies/dummy/1", headers=headers)
        assert r.status_code == 200
        assert r.json()["ai_policy"]["default"] == "none"

        r = await client.get("/api/v1/content/items/nope/1/preview", headers=headers)
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "unknown_content_type"

        r = await client.get("/api/v1/content/items")
        assert r.status_code == 401
    finally:
        unregister_adapter("dummy")


async def test_content_empty_registry_graceful(tc):
    """بدون هیچ adapter — لیست خالی، نه خطا."""
    user = await _make_user(tc["maker"], "content-empty@test.local")
    headers = {"Authorization": f"Bearer {_token(user)}"}
    r = await tc["client"].get("/api/v1/content/items", headers=headers)
    assert r.status_code == 200
    assert r.json() == {"items": [], "total": 0}


# ---------- dispatcher: processed + dead-letter ----------


async def _temp_maker(tmp_path):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    import app.models  # noqa: F401
    from app.core.database import Base

    db_file = str(tmp_path / "unit.db")
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_file}", connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return maker, engine


async def test_dispatch_once_marks_processed(tmp_path):
    from app.core.dispatcher import InMemoryBus, dispatch_once

    maker, engine = await _temp_maker(tmp_path)
    try:
        eid = await _emit(maker, "unit.ok", {"a": 1})
        bus = InMemoryBus()
        assert await dispatch_once(maker, bus) == 1
        msg = await asyncio.wait_for(bus._queue.get(), timeout=5)
        assert msg["event_id"] == eid and msg["event_type"] == "unit.ok"
        # دور دوم چیزی برای پردازش نیست
        assert await dispatch_once(maker, bus) == 0
    finally:
        await engine.dispose()


async def test_dispatch_dead_letter_after_five_failures(tmp_path):
    from app.core.dispatcher import InMemoryBus, dispatch_once
    from app.models.models import DomainEvent

    class FailingBus(InMemoryBus):
        async def publish(self, message):
            raise RuntimeError("bus down")

    maker, engine = await _temp_maker(tmp_path)
    try:
        eid = await _emit(maker, "unit.fail", {})
        bus = FailingBus()
        for _ in range(5):
            assert await dispatch_once(maker, bus) == 0
            # شبیه‌سازی گذر زمان برای backoff نمایی
            async with maker() as db:
                ev = await db.get(DomainEvent, uuid.UUID(eid))
                if ev.failed_at is not None:
                    break
                ev.created_at = datetime.now(UTC) - timedelta(seconds=600)
                await db.commit()

        async with maker() as db:
            ev = await db.get(DomainEvent, uuid.UUID(eid))
            assert ev.retry_count == 5
            assert ev.failed_at is not None
            assert ev.processed_at is None
    finally:
        await engine.dispose()


# ---------- admin settings API ----------


async def _make_platform_admin(tc):
    from app.core.security import hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    async with tc["maker"]() as db:
        role = (
            await db.execute(select(Role).where(Role.name == "phase2_platform_admin"))
        ).scalar_one_or_none()
        if role is None:
            role = Role(name="phase2_platform_admin", description="test")
            db.add(role)
            await db.flush()
        perm = (
            await db.execute(select(Permission).where(Permission.key == "platform.settings"))
        ).scalar_one_or_none()
        if perm is None:
            perm = Permission(key="platform.settings", description="test")
            db.add(perm)
            await db.flush()
        link = (
            await db.execute(
                select(RolePermission).where(
                    RolePermission.role_id == role.id,
                    RolePermission.permission_id == perm.id,
                )
            )
        ).first()
        if link is None:
            db.add(RolePermission(role_id=role.id, permission_id=perm.id))
        user = User(
            full_name="ادمین پلتفرم",
            email=f"platform-admin-{uuid.uuid4().hex[:8]}@test.local",
            password_hash=hash_password("x" * 12),
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        await db.refresh(user)
        return user


async def test_admin_settings_roundtrip_masking_and_hotreload(tc):
    import json as _json

    from app.core.platform_settings import (
        get_settings_version,
        get_typed_setting,
        reset_settings_cache,
    )
    from app.models.models import AuditLog

    reset_settings_cache()
    try:
        admin = await _make_platform_admin(tc)
        headers = {"Authorization": f"Bearer {_token(admin)}"}
        client = tc["client"]

        v0 = (await client.get("/api/v1/admin/settings", headers=headers)).json()["version"]
        assert v0 == get_settings_version()

        r = await client.put(
            "/api/v1/admin/settings",
            headers=headers,
            json={"settings": {
                "ai.model": "test-model-v1",
                "ai.api_key": "sk-test-123",
                "branding.app_display_name": {"fa": "تست", "ar": "اختبار", "en": "Test"},
            }},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body["updated"]) == {"ai.model", "ai.api_key", "branding.app_display_name"}
        assert body["version"] == v0 + 1  # نسخه بالا رفت — hot-reload

        r = await client.get("/api/v1/admin/settings", headers=headers)
        assert r.status_code == 200
        data = {s["key"]: s for s in r.json()["settings"]}
        # کلید حساس mask شده
        assert data["ai.api_key"]["value"] == "***"
        assert data["ai.api_key"]["masked"] is True
        # بقیه قابل مشاهده‌اند
        assert data["ai.model"]["value"] == "test-model-v1"
        assert data["branding.app_display_name"]["value"] == {"fa": "تست", "ar": "اختبار", "en": "Test"}
        assert r.json()["version"] == v0 + 1

        # hot-reload واقعی: خواندن بدون ری‌استارت مقدار جدید را می‌دهد
        async with tc["maker"]() as db:
            assert await get_typed_setting(db, "ai.model") == "test-model-v1"
            assert await get_typed_setting(db, "branding.app_display_name") == {
                "fa": "تست", "ar": "اختبار", "en": "Test"}

        # مقدار "***" یعنی بدون تغییر — نسخه بالا نمی‌رود
        r = await client.put("/api/v1/admin/settings", headers=headers,
                             json={"settings": {"ai.api_key": "***"}})
        assert r.json()["updated"] == []
        assert r.json()["version"] == v0 + 1

        # audit log نباید plaintext سکرت داشته باشد (§۱۴)
        async with tc["maker"]() as db:
            rows = (await db.execute(
                select(AuditLog).where(AuditLog.action == "platform.settings_update")
                .order_by(AuditLog.created_at.desc())
            )).scalars().all()
            assert rows
            assert "sk-test-123" not in _json.dumps(rows[0].new_values, ensure_ascii=False)

        # کلید ناشناخته → 400
        r = await client.put("/api/v1/admin/settings", headers=headers,
                             json={"settings": {"nope.key": "x"}})
        assert r.status_code == 400

        # کاربر بدون مجوز → 403
        plain = await _make_user(tc["maker"], "plain-noperm@test.local")
        r = await client.get("/api/v1/admin/settings",
                             headers={"Authorization": f"Bearer {_token(plain)}"})
        assert r.status_code == 403
    finally:
        reset_settings_cache()


async def test_admin_dead_letter_endpoints(tc):
    from app.models.models import DomainEvent

    admin = await _make_platform_admin(tc)
    headers = {"Authorization": f"Bearer {_token(admin)}"}
    client = tc["client"]

    # ساخت یک رویداد dead-letter مصنوعی
    eid = await _emit(tc["maker"], "unit.doomed", {})
    async with tc["maker"]() as db:
        ev = await db.get(DomainEvent, uuid.UUID(eid))
        ev.retry_count = 5
        ev.failed_at = datetime.now(UTC)
        await db.commit()

    r = await client.get("/api/v1/admin/events/dead-letter", headers=headers)
    assert r.status_code == 200
    ids = [e["event_id"] for e in r.json()["events"]]
    assert eid in ids

    r = await client.post(f"/api/v1/admin/events/dead-letter/{eid}/retry", headers=headers)
    assert r.status_code == 200

    async with tc["maker"]() as db:
        ev = await db.get(DomainEvent, uuid.UUID(eid))
        assert ev.failed_at is None and ev.retry_count == 0
