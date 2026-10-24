"""تست‌های فاز ۱۱ — اماکن مذهبی، تلگرام (بات/اتصال/درون‌ریزی/توزیع)،
کلیدهای API و ویجت‌های جاسازی‌شونده (Track 1: Backend).

پوشش معیارهای پذیرش بک‌اند:
- places CRUD + گردش‌کار مشترک §۹ + فیلتر bounding-box
- ایزولاسیون CORS ویجت‌ها (wildcard فقط روی /api/v1/widgets/*)
- scope و rate-limit کلیدهای API
- idempotency توزیع (ارسال دوباره → یک رکورد)
- درون‌ریزی با Telethon جعلی → in_review، هرگز auto-publish
- round-trip رمزنگاری session + عدم نشت secret در audit
- وبهوک callback: تأیید فتوا از تلگرام → گذار واقعی در پلتفرم
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

BASE = "/api/v1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    """کاربر تست + توکن؛ RBAC واقعی از جدول‌ها (الگوی فاز ۱۰)."""
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        perms = []
        for key in permissions:
            p = (
                await db.execute(select(Permission).where(Permission.key == key))
            ).scalar_one_or_none()
            if p is None:
                p = Permission(key=key, description=key)
                db.add(p)
                await db.flush()
            perms.append(p)
        role = Role(name=f"p11_test_role_{suffix}", description="phase11 test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست فاز ۱۱",
            email=f"p11-{suffix}@example.com",
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
        return {"Authorization": f"Bearer {token}", "user_id": str(user.id)}


async def _set_settings(tc, values: dict[str, str]):
    """نوشتن مستقیم تنظیمات (رمزنگاری‌شده) + باطل‌سازی کش."""
    from app.core.platform_settings import bump_settings_version, stage_setting

    async with tc["maker"]() as db:
        for k, v in values.items():
            await stage_setting(db, k, v)
        await db.commit()
    bump_settings_version(list(values.keys()))


async def _clear_settings(tc, keys: list[str]):
    from app.core.platform_settings import bump_settings_version
    from app.models.models import PlatformSetting

    async with tc["maker"]() as db:
        for k in keys:
            row = await db.get(PlatformSetting, k)
            if row is not None:
                await db.delete(row)
        await db.commit()
    bump_settings_version(keys)


@pytest.fixture(autouse=True)
def _clean_telegram_state():
    """بازنشانی کش تنظیمات، factory جعلی و rate-limitها بین تست‌ها."""
    from app.core.platform_settings import reset_settings_cache
    from app.modules.api_keys import service as api_keys_service
    from app.modules.telegram import telethon_client

    reset_settings_cache()
    telethon_client.reset_client_factory()
    api_keys_service.reset_rate_limits()
    yield
    reset_settings_cache()
    telethon_client.reset_client_factory()
    api_keys_service.reset_rate_limits()


# ---------------------------------------------------------------------------
# Fakeها: MTProto و Bot (بدون هیچ شبکه‌ای)
# ---------------------------------------------------------------------------

from app.modules.telegram.telethon_client import (
    FloodWait,
    MtprotoMessage,
    SessionPasswordNeeded,
    set_client_factory,
)


class FakeMtprotoClient:
    def __init__(
        self,
        *,
        authorized: bool = False,
        code: str = "12345",
        password: str = "s3cret",
        need_password: bool = False,
        session_str: str = "FAKESESSIONDATA",
        messages: list[MtprotoMessage] | None = None,
        flood_wait_first: bool = False,
    ):
        self._authorized = authorized
        self._code = code
        self._password = password
        self._need_password = need_password
        self._session_str = session_str
        self._messages = messages or []
        self._flood_wait_first = flood_wait_first
        self._flooded = False
        self.sent_code_to: str | None = None

    async def connect(self): ...
    async def disconnect(self): ...

    async def is_user_authorized(self) -> bool:
        return self._authorized

    async def send_code_request(self, phone: str):
        self.sent_code_to = phone
        return SimpleNamespace(phone_code_hash="HASH123")

    async def sign_in_with_code(self, phone, code, phone_code_hash):
        assert phone_code_hash == "HASH123"
        if self._need_password:
            raise SessionPasswordNeeded()
        if code != self._code:
            raise Exception("bad code")
        self._authorized = True

    async def sign_in_with_password(self, password: str):
        if password != self._password:
            raise Exception("bad password")
        self._authorized = True

    def save_session(self) -> str:
        return self._session_str

    def iter_messages(self, channel: str, limit: int):
        return self._gen(channel, limit)

    async def _gen(self, channel: str, limit: int):
        if self._flood_wait_first and not self._flooded:
            self._flooded = True
            raise FloodWait(0)
        for m in self._messages[:limit]:
            yield m

    async def download_media_bytes(self, message: MtprotoMessage) -> bytes:
        return message.media_bytes or b""


class FakeBot:
    def __init__(self):
        self.sent: list[dict] = []
        self.deleted: list[tuple] = []

    async def send_message(self, chat_id, text, reply_markup=None,
                           parse_mode=None, disable_web_page_preview=True):
        self.sent.append({"chat_id": chat_id, "text": text,
                          "reply_markup": reply_markup})
        return SimpleNamespace(message_id=1000 + len(self.sent))

    async def delete_message(self, chat_id, message_id):
        self.deleted.append((chat_id, message_id))

    async def answer_callback_query(self, callback_query_id, text=None):
        return True


@pytest.fixture()
def fake_bot(monkeypatch):
    from app.modules.telegram import bot_service

    bot = FakeBot()
    monkeypatch.setattr(bot_service, "_make_bot", lambda token: bot)
    return bot


async def _enable_bot(tc, fake_bot):
    await _set_settings(tc, {
        "telegram.enabled": "true",
        "telegram.bot_token": "fake-token",
        "telegram.channel": "@testchannel",
        "telegram.webhook_secret": "webhook-secret-123",
    })


# ---------------------------------------------------------------------------
# ۱) اماکن: CRUD + گردش‌کار + bbox
# ---------------------------------------------------------------------------


def _place_payload(**kw):
    d = {
        "name": _L("مسجد تست"),
        "description": _L("توضیح تست"),
        "lat": 36.2880,
        "lng": 59.6157,
        "type": "shrine",
    }
    d.update(kw)
    return d


async def test_places_crud_and_workflow(tc):
    admin = await _make_user(tc, ("places.manage",))
    client = tc["client"]

    r = await client.post(f"{BASE}/admin/places", json=_place_payload(),
                          headers=admin)
    assert r.status_code == 201, r.text
    place = r.json()
    assert place["workflow_status"] == "draft"
    pid = place["id"]

    # عمومی: draft دیده نمی‌شود
    r = await client.get(f"{BASE}/places")
    assert r.status_code == 200
    assert r.json()["total"] == 0

    # جهش draft → published ممنوع است (§۹)
    r = await client.post(f"{BASE}/admin/places/{pid}/transition",
                          json={"target": "published"}, headers=admin)
    assert r.status_code == 422

    for target in ("in_review", "approved", "published"):
        r = await client.post(f"{BASE}/admin/places/{pid}/transition",
                              json={"target": target}, headers=admin)
        assert r.status_code == 200, (target, r.text)
        assert r.json()["workflow_status"] == target

    r = await client.get(f"{BASE}/places")
    assert r.json()["total"] == 1
    r = await client.get(f"{BASE}/places/{pid}")
    assert r.status_code == 200
    assert r.json()["lat"] == 36.2880

    # ویدیوی ۳۶۰ نامعتبر → ۴۲۲
    r = await client.post(
        f"{BASE}/admin/places", headers=admin,
        json=_place_payload(video_360_id=str(uuid.uuid4())),
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_360_ref"

    # حذف: فقط draft
    r = await client.delete(f"{BASE}/admin/places/{pid}", headers=admin)
    assert r.status_code == 422  # published است
    # archived → حذف هم مجاز نیست (فقط draft)
    r = await client.post(f"{BASE}/admin/places/{pid}/transition",
                          json={"target": "archived"}, headers=admin)
    assert r.status_code == 200


async def test_places_bbox_filter(tc):
    admin = await _make_user(tc, ("places.manage",))
    client = tc["client"]
    coords = [(21.4225, 39.8262), (24.4672, 39.6111), (36.2880, 59.6157)]
    for i, (lat, lng) in enumerate(coords):
        r = await client.post(f"{BASE}/admin/places",
                              json=_place_payload(lat=lat, lng=lng,
                                                   name=_L(f"مکان {i}")),
                              headers=admin)
        assert r.status_code == 201
        pid = r.json()["id"]
        for t in ("in_review", "approved", "published"):
            await client.post(f"{BASE}/admin/places/{pid}/transition",
                              json={"target": t}, headers=admin)
    # bbox فقط مکه و مدینه
    r = await client.get(
        f"{BASE}/places?min_lat=20&max_lat=25&min_lng=39&max_lng=40")
    assert r.status_code == 200
    assert r.json()["total"] == 2
    # bbox خالی
    r = await client.get(
        f"{BASE}/places?min_lat=0&max_lat=1&min_lng=0&max_lng=1")
    assert r.json()["total"] == 0


async def test_places_seed_data():
    """seed چهار مکان مشهور — مختصات واقعی، published (دادهٔ استاتیک)."""
    from app.modules.places import seed_places as sp

    assert len(sp.PLACES) == 4
    coords = {(p["lat"], p["lng"]) for p in sp.PLACES}
    assert (21.4225, 39.8262) in coords  # مسجد الحرام
    assert (24.4672, 39.6111) in coords  # مسجد النبی
    assert (36.2880, 59.6157) in coords  # حرم امام رضا
    assert (31.7689, 35.2137) in coords  # مسجد الاقصی
    names = " ".join(p["name"]["fa"] for p in sp.PLACES)
    assert "مسجد الحرام" in names and "الاقصی" in names
    assert all(p["type"] in ("mosque", "shrine", "holy_site", "museum", "other")
               for p in sp.PLACES)


# ---------------------------------------------------------------------------
# ۲) کلیدهای API: ساخت، scope، rate-limit
# ---------------------------------------------------------------------------


async def _create_key(tc, admin, **kw):
    client = tc["client"]
    payload = {"name": "widget-site", "scopes": ["prayer-times"],
               "rate_limit_per_min": 60, "quota_monthly": 10000}
    payload.update(kw)
    r = await client.post(f"{BASE}/api-keys", json=payload, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


async def test_api_key_create_and_usage(tc):
    admin = await _make_user(tc, ("api_keys.manage",))
    client = tc["client"]
    created = await _create_key(tc, admin)
    assert created["key"].startswith("mk_")
    assert created["key_prefix"] == created["key"][:8]

    # هش در DB است، نه کلید خام
    from app.models.models import ApiKey
    async with tc["maker"]() as db:
        row = await db.get(ApiKey, uuid.UUID(created["id"]))
        assert created["key"] not in (row.key_hash or "")
        assert len(row.key_hash) == 64

    r = await client.get(f"{BASE}/api-keys/{created['id']}/usage", headers=admin)
    assert r.status_code == 200
    assert r.json()["quota_remaining"] == 10000

    # embed snippet — بدون نشت کلید واقعی: Pass 4 / A5 دیگر
    # placeholder برنمی‌گرداند، بلکه توکن embed امضاشدهٔ واقعی
    # (?embed_token=) صادر می‌کند؛ کلید خام هرگز در snippet نیست.
    r = await client.get(
        f"{BASE}/api-keys/{created['id']}/embed-snippet?widget=prayer-times",
        headers=admin)
    assert r.status_code == 200
    assert created["key"] not in r.json()["html"]
    assert "embed_token=" in r.json()["html"]
    assert "<iframe" in r.json()["html"]

    # revoke
    r = await client.post(f"{BASE}/api-keys/{created['id']}/revoke", headers=admin)
    assert r.json()["is_active"] is False
    r = await client.get(
        f"{BASE}/widgets/prayer-times?lat=35.7&lng=51.4", headers={"X-API-Key": created["key"]})
    assert r.status_code == 401


async def test_api_key_scope_enforcement(tc):
    admin = await _make_user(tc, ("api_keys.manage",))
    client = tc["client"]
    created = await _create_key(tc, admin, scopes=["prayer-times"])
    key = created["key"]

    r = await client.get(f"{BASE}/widgets/ayah-of-day", headers={"X-API-Key": key})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "api_key_scope_denied"

    r = await client.get(
        f"{BASE}/widgets/prayer-times?lat=35.7&lng=51.4", headers={"X-API-Key": key})
    assert r.status_code == 200
    assert "fajr" in r.json()["times"]


async def test_api_key_rate_limit(tc):
    admin = await _make_user(tc, ("api_keys.manage",))
    client = tc["client"]
    created = await _create_key(tc, admin, scopes=["prayer-times"],
                                rate_limit_per_min=2)
    key = created["key"]
    url = f"{BASE}/widgets/prayer-times?lat=35.7&lng=51.4"
    assert (await client.get(url, headers={"X-API-Key": key})).status_code == 200
    assert (await client.get(url, headers={"X-API-Key": key})).status_code == 200
    r = await client.get(url, headers={"X-API-Key": key})
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"


async def test_widget_requires_key(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/widgets/prayer-times?lat=35.7&lng=51.4")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "api_key_required"


# ---------------------------------------------------------------------------
# ۳) ایزولاسیون CORS ویجت‌ها
# ---------------------------------------------------------------------------


async def test_widget_cors_isolation(tc):
    admin = await _make_user(tc, ("api_keys.manage", "places.manage"))
    client = tc["client"]
    created = await _create_key(tc, admin, scopes=["prayer-times"])
    key = created["key"]

    # ویجت: wildcard
    r = await client.get(
        f"{BASE}/widgets/prayer-times?lat=35.7&lng=51.4",
        headers={"Origin": "https://external-site.example", "X-API-Key": key},
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "*"
    assert "access-control-allow-credentials" not in r.headers

    # preflight ویجت
    r = await client.options(
        f"{BASE}/widgets/prayer-times",
        headers={"Origin": "https://external-site.example",
                 "Access-Control-Request-Method": "GET"},
    )
    assert r.status_code == 204
    assert r.headers.get("access-control-allow-origin") == "*"

    # endpoint احرازهویت‌شده: هیچ wildcard نباید بگیرد
    r = await client.post(
        f"{BASE}/admin/places", json=_place_payload(), headers={
            **admin, "Origin": "https://external-site.example"},
    )
    assert r.status_code in (200, 201)
    assert r.headers.get("access-control-allow-origin") != "*"

    r = await client.get(
        f"{BASE}/api-keys", headers={
            **admin, "Origin": "https://external-site.example"},
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") != "*"


# ---------------------------------------------------------------------------
# ۴) ویجت‌ها: prayer-times / ayah-of-day / latest-fatwa / zakat-mini
# ---------------------------------------------------------------------------


async def test_prayer_times_widget(tc):
    admin = await _make_user(tc, ("api_keys.manage",))
    key = (await _create_key(tc, admin, scopes=["prayer-times"]))["key"]
    client = tc["client"]
    r = await client.get(
        f"{BASE}/widgets/prayer-times?lat=21.42&lng=39.82"
        f"&method=makkah&madhab=hanafi&tz=3", headers={"X-API-Key": key})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["times"]) == {"imsak", "fajr", "sunrise", "dhuhr", "asr",
                                  "maghrib", "isha", "midnight"}
    assert body["method"] == "makkah" and body["madhab"] == "hanafi"

    r = await client.get(
        f"{BASE}/widgets/prayer-times?lat=21.42&lng=39.82&method=nope", headers={"X-API-Key": key})
    assert r.status_code == 422


async def test_ayah_of_day_widget(tc, monkeypatch):
    from app.modules.widgets import service as widget_service

    admin = await _make_user(tc, ("api_keys.manage",))
    key = (await _create_key(tc, admin, scopes=["ayah-of-day"]))["key"]

    async def fake_bundle(db, surah, ayah):
        return {"surah": surah, "ayah": ayah,
                "editions": {"text": "بِسْمِ اللَّهِ"}}

    monkeypatch.setattr(widget_service, "_default_ayah_bundle", fake_bundle)
    client = tc["client"]
    r = await client.get(f"{BASE}/widgets/ayah-of-day", headers={"X-API-Key": key})
    assert r.status_code == 200, r.text
    body = r.json()
    # قطعی بودن: شمارهٔ آیه از فهرست چرخشی است
    assert (body["surah"], body["ayah"]) in widget_service.AYAH_ROTATION
    assert body["bundle"]["editions"]["text"] == "بِسْمِ اللَّهِ"


async def test_latest_fatwa_widget(tc):
    from app.modules.fatwa import submissions_service

    approver = await _make_user(tc, ("fatwa.approve", "api_keys.manage"))
    client = tc["client"]
    async with tc["maker"]() as db:
        from app.models.models import User
        user = await db.get(User, uuid.UUID(approver["user_id"]))
        sub = await submissions_service.create_submission(
            db, author=user, title=_L("حکم تست"), body="متن فتوای تست",
            madhab="hanafi", evidence=None,
        )
        await submissions_service.transition(
            db, submission=sub, target="in_review", actor=user)
        await submissions_service.transition(
            db, submission=sub, target="approved", actor=user)
        await submissions_service.transition(
            db, submission=sub, target="published", actor=user)

    key = (await _create_key(tc, approver, scopes=["latest-fatwa"]))["key"]
    r = await client.get(f"{BASE}/widgets/latest-fatwa", headers={"X-API-Key": key})
    assert r.status_code == 200, r.text
    assert r.json()["title"]["fa"] == "حکم تست"


async def test_zakat_mini_no_rule(tc, monkeypatch):
    from app.core.errors import APIError
    from app.modules.calculators import service as calc_service

    admin = await _make_user(tc, ("api_keys.manage",))
    key = (await _create_key(tc, admin, scopes=["zakat-mini"]))["key"]
    client = tc["client"]

    # بدون rule تأییدشده: ۵۰۳ صادقانه، نه نرخ ساختگی (§۱۵.۵)
    # (**_kwargs: امضای داخلی get_active_rule در فاز ۴ پارامتر require_key گرفت)
    async def no_rule(db, kind, madhab=None, **_kwargs):
        raise APIError(422, "rules_not_approved", "no rule")

    monkeypatch.setattr(calc_service, "get_active_rule", no_rule)
    r = await client.get(f"{BASE}/widgets/zakat-mini?amount=1000", headers={"X-API-Key": key})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "zakat_rule_not_configured"


async def test_zakat_mini_with_rule(tc, monkeypatch):
    from app.modules.calculators import service as calc_service

    admin = await _make_user(tc, ("api_keys.manage",))
    key = (await _create_key(tc, admin, scopes=["zakat-mini"]))["key"]
    client = tc["client"]

    async def fake_calc(db, **kw):
        return {
            "result": {"zakat_due": "25.00", "nisab_value": "400.00",
                       "currency": "USD", "status": "ok"},
            "nisab_snapshot": {"currency": "USD"},
        }

    monkeypatch.setattr(calc_service, "calculate_zakat", fake_calc)
    r = await client.get(f"{BASE}/widgets/zakat-mini?amount=1000", headers={"X-API-Key": key})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["zakat_due"] == "25.00"
    assert body["nisab"] == "400.00"

    r = await client.get(f"{BASE}/widgets/zakat-mini?amount=-5", headers={"X-API-Key": key})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# ۵) اتصال Telethon: round-trip رمزنگاری + عدم نشت در audit
# ---------------------------------------------------------------------------


async def test_telegram_connect_requires_config(tc):
    admin = await _make_user(tc, ("telegram.manage",))
    client = tc["client"]
    r = await client.post(f"{BASE}/telegram/connect/request-code",
                          json={"phone": "+989123456789"}, headers=admin)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "telegram_not_configured"


async def test_telegram_connect_flow_encrypted(tc):
    from app.models.models import AuditLog, PlatformSetting
    from app.modules.telegram import connect_service

    admin = await _make_user(tc, ("telegram.manage",))
    client = tc["client"]
    await _set_settings(tc, {"telegram.api_id": "123456",
                             "telegram.api_hash": "fakehash"})
    fake = FakeMtprotoClient()
    set_client_factory(lambda s, i, h: fake)

    r = await client.post(f"{BASE}/telegram/connect/request-code",
                          json={"phone": "+989123456789"}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["phone_masked"].endswith("6789")
    assert fake.sent_code_to == "+989123456789"

    r = await client.post(
        f"{BASE}/telegram/connect/confirm-code",
        json={"phone": "+989123456789", "code": "12345"}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["connected"] is True

    # round-trip رمزنگاری: خواندن session رمزگشایی‌شده برابر مقدار جعلی
    async with tc["maker"]() as db:
        assert await connect_service.load_session(db) == "FAKESESSIONDATA"
        # در DB مقدار رمزنگاری‌شده است، نه plaintext
        row = await db.get(PlatformSetting, "telegram.session")
        assert "FAKESESSIONDATA" not in str(row.value)

    # §۱۴: مقدار session در audit نیست
    async with tc["maker"]() as db:
        logs = (await db.execute(
            select(AuditLog).where(
                AuditLog.action == "telegram.connect.confirm_code"))).scalars().all()
        assert logs
        for log in logs:
            assert "FAKESESSIONDATA" not in str(log.new_values)
            assert "FAKESESSIONDATA" not in str(log.old_values)

    r = await client.get(f"{BASE}/telegram/connect/status", headers=admin)
    assert r.json()["connected"] is True
    assert r.json()["phone_masked"].endswith("6789")

    r = await client.post(f"{BASE}/telegram/connect/disconnect", headers=admin)
    assert r.json()["connected"] is False
    async with tc["maker"]() as db:
        assert await connect_service.load_session(db) is None


async def test_telegram_connect_password_flow(tc):
    admin = await _make_user(tc, ("telegram.manage",))
    client = tc["client"]
    await _set_settings(tc, {"telegram.api_id": "123456",
                             "telegram.api_hash": "fakehash"})
    fake = FakeMtprotoClient(need_password=True)
    set_client_factory(lambda s, i, h: fake)

    await client.post(f"{BASE}/telegram/connect/request-code",
                      json={"phone": "+989123456789"}, headers=admin)
    # بدون password → ۴۲۲
    r = await client.post(
        f"{BASE}/telegram/connect/confirm-code",
        json={"phone": "+989123456789", "code": "12345"}, headers=admin)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "password_required"
    # با password → وصل
    r = await client.post(
        f"{BASE}/telegram/connect/confirm-code",
        json={"phone": "+989123456789", "code": "12345",
              "password": "s3cret"}, headers=admin)
    assert r.status_code == 200
    assert r.json()["connected"] is True


# ---------------------------------------------------------------------------
# ۶) درون‌ریزی: in_review، flood-wait، هرگز auto-publish
# ---------------------------------------------------------------------------


def _msg(mid, text=None, file_name=None, media_bytes=None, mime=None):
    return MtprotoMessage(message_id=mid, text=text, file_name=file_name,
                          mime_type=mime, file_size=len(media_bytes or b""),
                          media_bytes=media_bytes)


_PDF = b"%PDF-1.4 fake pdf content for tests...................."
_MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
_JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64  # بدون kind در کتابخانه → skip


async def test_import_lands_in_review(tc):
    from app.models.models import LibraryItem
    from app.modules.telegram import import_service

    admin = await _make_user(tc, ("telegram.manage",))
    async with tc["maker"]() as db:
        from app.models.models import User
        actor = await db.get(User, uuid.UUID(admin["user_id"]))
        actor_id = actor.id

    fake = FakeMtprotoClient(messages=[
        _msg(1, "درس اول", "lesson1.pdf", _PDF, "application/pdf"),
        _msg(2, "کلیپ", "clip.mp4", _MP4, "video/mp4"),
        _msg(3, "عکس", "photo.jpg", _JPG, "image/jpeg"),
        _msg(4, "فقط متن — بدون مدیا"),
    ])
    async with tc["maker"]() as db:
        result = await import_service.run_import(
            db, channel="@testchannel", limit=10, actor_id=actor_id, client=fake)
    assert result["imported"] == 2, result
    assert result["unsupported_kind"] == 1
    assert result["no_media"] == 1

    async with tc["maker"]() as db:
        items = (await db.execute(
            select(LibraryItem).where(
                LibraryItem.source_type == "telegram_import",
                LibraryItem.source_ref["channel"].as_string() == "@testchannel",
            ))).scalars().all()
        assert len(items) == 2
        for item in items:
            assert item.workflow_status == "in_review"  # هرگز published مستقیم
            assert item.source_ref["origin"] == "telegram"
            assert item.source_ref["channel"] == "@testchannel"
            assert item.source_ref["message_id"] in (1, 2)

    # اجرای دوباره → duplicate، بدون رکورد تازه
    async with tc["maker"]() as db:
        result2 = await import_service.run_import(
            db, channel="@testchannel", limit=10, actor_id=actor_id, client=fake)
    assert result2["duplicate"] == 2
    assert result2["imported"] == 0


async def test_import_flood_wait_backoff(tc):
    from app.modules.telegram import import_service

    admin = await _make_user(tc, ("telegram.manage",))
    async with tc["maker"]() as db:
        from app.models.models import User
        actor_id = (await db.get(User, uuid.UUID(admin["user_id"]))).id
    fake = FakeMtprotoClient(
        messages=[_msg(10, "درس", "d.pdf", _PDF, "application/pdf")],
        flood_wait_first=True,
    )
    async with tc["maker"]() as db:
        result = await import_service.run_import(
            db, channel="@ch", limit=10, actor_id=actor_id, client=fake)
    assert result["imported"] == 1  # بعد از flood-wait کامل شد


async def test_imported_content_never_auto_reposts(tc):
    from app.models.models import LibraryItem, TelegramPublished
    from app.modules.telegram import distribute_service, import_service

    admin = await _make_user(tc, ("telegram.manage",))
    async with tc["maker"]() as db:
        from app.models.models import User
        actor = await db.get(User, uuid.UUID(admin["user_id"]))
        fake = FakeMtprotoClient(messages=[
            _msg(20, "درس", "d2.pdf", _PDF, "application/pdf")])
        result = await import_service.run_import(
            db, channel="@ch", limit=10, actor_id=actor.id, client=fake)
        assert result["imported"] == 1
        item = (await db.execute(
            select(LibraryItem).where(
                LibraryItem.source_type == "telegram_import"))).scalars().first()

        # حتی با policy=auto_publish، محتوای تلگرامی بازنشر نمی‌شود
        await distribute_service.set_policy(
            db, "library_item", {"policy": "auto_publish",
                                "target_channels": ["@ch"]}, actor=actor)
        out = await distribute_service.auto_publish_if_policy(
            db, "library_item", str(item.id))
        assert out is None
        rows = (await db.execute(
            select(TelegramPublished).where(
                TelegramPublished.source_content_id == str(item.id)))).scalars().all()
        assert rows == []


async def test_planned_import_also_never_auto_reposts(tc):
    """واردشدهٔ برنامه‌ریزی‌شدهٔ فاز ۹ (source_type=telegram_import بدون origin)
    هم از auto-repost مستثناست — قانون محافظه‌کارانهٔ §۹.۵."""
    from app.models.models import TelegramPublished, User
    from app.modules.library import service as library_service
    from app.modules.telegram import distribute_service

    admin = await _make_user(tc, ("telegram.manage", "library.manage"))
    async with tc["maker"]() as db:
        actor = await db.get(User, uuid.UUID(admin["user_id"]))
        created = await library_service.import_item(
            db,
            {"kind": "pdf", "title": _L("planned"),
             "source_ref": {"planned": True}},
            actor=actor,
        )
        item_id = created["id"]
        await distribute_service.set_policy(
            db, "library_item", {"policy": "auto_publish",
                                "target_channels": ["@ch"]}, actor=actor)
        out = await distribute_service.auto_publish_if_policy(
            db, "library_item", str(item_id))
        assert out is None
        rows = (await db.execute(
            select(TelegramPublished).where(
                TelegramPublished.source_content_id == str(item_id)))).scalars().all()
        assert rows == []


# ---------------------------------------------------------------------------
# ۷) توزیع: idempotency + سیاست‌ها
# ---------------------------------------------------------------------------


async def test_distribution_idempotency(tc):
    from app.models.models import TelegramPublished, User
    from app.modules.telegram import distribute_service

    admin = await _make_user(tc, ("telegram.manage", "places.manage"))
    client = tc["client"]
    # یک مکان published برای انتشار
    r = await client.post(f"{BASE}/admin/places", json=_place_payload(),
                          headers=admin)
    pid = r.json()["id"]
    for t in ("in_review", "approved", "published"):
        await client.post(f"{BASE}/admin/places/{pid}/transition",
                          json={"target": t}, headers=admin)

    key_suffix = _uid()
    async with tc["maker"]() as db:
        actor = await db.get(User, uuid.UUID(admin["user_id"]))
        first = await distribute_service.request_publish(
            db, content_type="religious_place", content_id=pid, actor=actor,
            targets=["@ch1"], idempotency_key=f"idem-1-{key_suffix}")
        second = await distribute_service.request_publish(
            db, content_type="religious_place", content_id=pid, actor=actor,
            targets=["@ch1"], idempotency_key=f"idem-1-{key_suffix}")
        assert first[0]["id"] == second[0]["id"]
        rows = (await db.execute(
            select(TelegramPublished).where(
                TelegramPublished.idempotency_key == f"idem-1-{key_suffix}")
        )).scalars().all()
        assert len(rows) == 1
        # target دیگر → رکورد جدا
        third = await distribute_service.request_publish(
            db, content_type="religious_place", content_id=pid, actor=actor,
            targets=["@ch2"], idempotency_key=f"idem-2-{key_suffix}")
        assert third[0]["id"] != first[0]["id"]


async def test_policy_defaults_to_never(tc):
    from app.modules.telegram import distribute_service

    admin = await _make_user(tc, ("telegram.manage",))
    async with tc["maker"]() as db:
        from app.models.models import User
        actor = await db.get(User, uuid.UUID(admin["user_id"]))
        # auto_publish_if_policy بدون policy → None (نه انتشار)
        assert await distribute_service.auto_publish_if_policy(
            db, "fatwa_submission", str(uuid.uuid4())) is None
        policy = await distribute_service.get_policy(db, "fatwa_submission")
        assert policy.policy == "never"


# ---------------------------------------------------------------------------
# ۸) وبهوک: دکمهٔ تأیید فتوا از تلگرام
# ---------------------------------------------------------------------------


async def _make_in_review_submission(tc, approver_headers):
    from app.models.models import User
    from app.modules.fatwa import submissions_service

    async with tc["maker"]() as db:
        user = await db.get(User, uuid.UUID(approver_headers["user_id"]))
        sub = await submissions_service.create_submission(
            db, author=user, title=_L("فتوای تلگرامی"), body="متن فتوا",
            madhab="hanafi", evidence=None)
        await submissions_service.transition(
            db, submission=sub, target="in_review", actor=user)
        return str(sub.id)


async def test_webhook_bad_secret_rejected(tc):
    client = tc["client"]
    r = await client.post(
        f"{BASE}/telegram/webhook",
        json={"callback_query": {"id": "1", "data": "tg:abc"}},
        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
    )
    assert r.status_code == 401


async def test_webhook_approves_fatwa_from_telegram(tc, fake_bot):
    from app.models.models import FatwaSubmission
    from app.modules.telegram import distribute_service

    approver = await _make_user(tc, ("fatwa.approve", "telegram.manage"))
    await _enable_bot(tc, fake_bot)
    sub_id = await _make_in_review_submission(tc, approver)

    # اعلان بازبینی با دکمه‌ها (بات جعلی)
    async with tc["maker"]() as db:
        from app.models.models import User
        actor = await db.get(User, uuid.UUID(approver["user_id"]))
        notified = await distribute_service.notify_review_request(
            db, "fatwa_submission", sub_id, actor=actor)
    assert notified["status"] == "notified"
    assert len(fake_bot.sent) == 1
    markup = fake_bot.sent[0]["reply_markup"]
    buttons = [b.callback_data for row in markup.inline_keyboard for b in row]
    assert len(buttons) == 2 and all(b.startswith("tg:") for b in buttons)

    # idempotency اعلان: دوباره → همان رکورد
    async with tc["maker"]() as db:
        actor = await db.get(User, uuid.UUID(approver["user_id"]))
        again = await distribute_service.notify_review_request(
            db, "fatwa_submission", sub_id, actor=actor)
    assert again["id"] == notified["id"]
    assert len(fake_bot.sent) == 1

    # تأیید از تلگرام → approved در پلتفرم
    client = tc["client"]
    from app.models.models import TelegramCallback
    async with tc["maker"]() as db:
        cbs = (await db.execute(
            select(TelegramCallback).where(
                TelegramCallback.source_content_id == sub_id))).scalars().all()
        approve_nonce = next(c.nonce for c in cbs if c.op == "approve")

    r = await client.post(
        f"{BASE}/telegram/webhook",
        json={"callback_query": {"id": "cq1", "data": f"tg:{approve_nonce}"}},
        headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret-123"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["result"]["to"] == "approved"

    async with tc["maker"]() as db:
        sub = await db.get(FatwaSubmission, uuid.UUID(sub_id))
        assert sub.workflow_status == "approved"

    # استفادهٔ دوباره از همان دکمه → ۴۰۹
    r = await client.post(
        f"{BASE}/telegram/webhook",
        json={"callback_query": {"id": "cq2", "data": f"tg:{approve_nonce}"}},
        headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret-123"},
    )
    assert r.status_code == 409

    # رد روی submission دیگر
    sub2 = await _make_in_review_submission(tc, approver)
    async with tc["maker"]() as db:
        actor = await db.get(User, uuid.UUID(approver["user_id"]))
        await distribute_service.notify_review_request(
            db, "fatwa_submission", sub2, actor=actor)
        cbs = (await db.execute(
            select(TelegramCallback).where(
                TelegramCallback.source_content_id == sub2))).scalars().all()
        reject2 = next(c.nonce for c in cbs if c.op == "reject")
    r = await client.post(
        f"{BASE}/telegram/webhook",
        json={"callback_query": {"id": "cq3", "data": f"tg:{reject2}"}},
        headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret-123"},
    )
    assert r.status_code == 200
    assert r.json()["result"]["to"] == "rejected"
    async with tc["maker"]() as db:
        sub = await db.get(FatwaSubmission, uuid.UUID(sub2))
        assert sub.workflow_status == "rejected"


async def test_webhook_tampered_signature_rejected(tc, fake_bot):
    from app.models.models import TelegramCallback
    from app.modules.telegram import distribute_service

    approver = await _make_user(tc, ("fatwa.approve", "telegram.manage"))
    await _enable_bot(tc, fake_bot)
    sub_id = await _make_in_review_submission(tc, approver)
    async with tc["maker"]() as db:
        from app.models.models import User
        actor = await db.get(User, uuid.UUID(approver["user_id"]))
        await distribute_service.notify_review_request(
            db, "fatwa_submission", sub_id, actor=actor)
        cb = (await db.execute(
            select(TelegramCallback).where(
                TelegramCallback.source_content_id == sub_id))).scalars().first()
        cb.signature = "0" * 64  # دست‌کاری
        await db.commit()
        nonce = cb.nonce

    client = tc["client"]
    r = await client.post(
        f"{BASE}/telegram/webhook",
        json={"callback_query": {"id": "cq9", "data": f"tg:{nonce}"}},
        headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret-123"},
    )
    assert r.status_code == 403


async def test_admin_library_source_type_filter(tc):
    """فیلتر source_type در فهرست مدیریتی + نمای admin (source_ref)."""
    from app.models.models import LibraryItem

    admin = await _make_user(tc, ("library.manage",))
    async with tc["maker"]() as db:
        db.add(LibraryItem(
            kind="audio", title={"fa": "واردشده از تلگرام"},
            media_key="tg/test1.mp3", workflow_status="in_review",
            source_type="telegram_import",
            source_ref={"origin": "telegram", "channel": "testchan", "message_id": 7},
        ))
        db.add(LibraryItem(
            kind="audio", title={"fa": "آپلود دستی"},
            media_key="up/test2.mp3", workflow_status="in_review",
            source_type="upload",
        ))
        await db.commit()

    client = tc["client"]
    r = await client.get(
        f"{BASE}/admin/library/items",
        params={"status": "in_review", "source_type": "telegram_import", "limit": 100},
        headers={"Authorization": admin["Authorization"]},
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    mine = [i for i in items if (i.get("source_ref") or {}).get("channel") == "testchan"]
    assert len(mine) == 1, f"expected our telegram_import row, got {len(mine)}"
    assert mine[0]["title"]["fa"] == "واردشده از تلگرام"
    # نمای مدیریتی باید source_ref را بدهد (پروکسی پیشرفت درون‌ریزی CRM)
    assert mine[0]["source_ref"]["channel"] == "testchan"
    # آیتم upload نباید در فیلتر telegram_import بیاید
    assert all(i["title"]["fa"] != "آپلود دستی" for i in items)
