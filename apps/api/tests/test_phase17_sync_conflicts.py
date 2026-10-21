"""تست‌های فاز ۱۷ (Track 2) — سناریوهای تعارض sync آفلاین: موارد سخت spec.

مکمل تست‌های فاز ۱۳ (تکراری نیست) — قرارداد ADR-0010:
- مسابقهٔ حذف-دربرابر-ویرایش: ویرایش آفلاین روی یادداشت حذف‌شده → تعارض
  (هر دو نسخه حفظ)، نه دورریز بی‌صدا و نه احیای ناخواسته
- احیا: ویرایش با base_version جدیدتر از tombstone → احیای صریح
- تاریخچهٔ حل تعارض: تعارض دوم روی همان یادداشت، رکورد جدید می‌سازد؛
  رکورد حل‌شده دست‌نخورده می‌ماند (audit trail)
- شکاف کرسر: pull افزایشی هیچ ورودی‌ای را جا نمی‌اندازد (seqهای پیوسته)
- طوفان retry: بازپخش ۲۰بارهٔ همان batch → همان نتایج، یک ورودی changelog
"""
from __future__ import annotations

import itertools
import uuid

from sqlalchemy import func, select

BASE = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _register(client, email: str) -> dict:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست سینک p17",
            "email": email,
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, email: str) -> str:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "TestPass123"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _user_token(client, email: str) -> str:
    await _register(client, email)
    return await _login(client, email)


async def _create_note(client, token: str, text: str = "یادداشت p17") -> dict:
    r = await client.post(
        f"{BASE}/quran/notes",
        json={"surah": 2, "ayah": 152, "note_text": text, "is_private": True},
        headers=_auth(token),
    )
    assert r.status_code == 201, r.text
    return r.json()


def _op(client_op_id: str, entity_type: str, entity_id: str, op_type: str,
        payload: dict | None = None, base_version: int = 0) -> dict:
    return {
        "client_op_id": client_op_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "op_type": op_type,
        "payload": payload or {},
        "base_version": base_version,
    }


async def _push(client, token: str, device_id: str, ops: list[dict]) -> list[dict]:
    r = await client.post(
        f"{BASE}/sync/push",
        json={"device_id": device_id, "ops": ops},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    return r.json()["results"]


async def _pull(client, token: str, device_id: str, cursor: int) -> dict:
    r = await client.get(
        f"{BASE}/sync/pull",
        params={"cursor": cursor, "device_id": device_id},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _conflicts(client, token: str, only_pending: bool = True) -> dict:
    r = await client.get(
        f"{BASE}/sync/conflicts",
        params={"only_pending": str(only_pending).lower()},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    return r.json()


# --- ۱) مسابقهٔ حذف-دربرابر-ویرایش ----------------------------------------------


async def test_delete_vs_edit_race_note_conflict_both_preserved(tc):
    """دستگاه A حذف می‌کند (tombstone)؛ دستگاه B آفلاین ویرایش کرده بود
    (base_version قدیمی‌تر از حذف) → تعارض: هیچ‌چیز دور ریخته نمی‌شود."""
    from app.models.models import SyncTombstone, UserAyahNote

    client = tc["client"]
    token = await _user_token(client, f"p17del-{uuid.uuid4().hex[:8]}@example.com")
    note = await _create_note(client, token, "متن اصلی p17")
    note_id = note["id"]

    # دستگاه A: حذف (tombstone نسخهٔ ۱)
    res = await _push(client, token, "dev-a", [
        _op("p17-del-1", "user_ayah_note", note_id, "delete", base_version=1),
    ])
    assert res[0]["status"] == "applied"

    # دستگاه B: ویرایش آفلاین با base_version=1 (قدیمی‌تر/مساوی حذف)
    res = await _push(client, token, "dev-b", [
        _op("p17-del-2", "user_ayah_note", note_id, "upsert",
            {"note_text": "ویرایش آفلاین دستگاه B", "is_private": False,
             "surah": 2, "ayah": 152}, base_version=1),
    ])
    assert res[0]["status"] == "conflicted", res
    assert res[0]["conflict_id"] is not None

    # رکورد تعارض: نسخهٔ B حفظ شده، سمت سرور «حذف‌شده» است
    body = await _conflicts(client, token)
    assert body["total"] == 1
    c = body["items"][0]
    assert c["local_payload"]["note_text"] == "ویرایش آفلاین دستگاه B"
    assert c["remote_payload"] is None  # سرور نسخه‌ای ندارد — حذف شده
    assert c["entity_id"] == note_id

    # ردیف یادداشت واقعاً رفته و tombstone هست
    async with tc["maker"]() as db:
        assert await db.get(UserAyahNote, uuid.UUID(note_id)) is None
        ts = (
            await db.execute(
                select(SyncTombstone).where(
                    SyncTombstone.entity_type == "user_ayah_note",
                    SyncTombstone.entity_id == note_id,
                )
            )
        ).scalar_one_or_none()
        assert ts is not None


async def test_edit_newer_than_tombstone_resurrects(tc):
    """ویرایش با base_version جدیدتر از حذف → احیای صریح (نه تعارض)."""
    from app.models.models import SyncTombstone, UserAyahNote

    client = tc["client"]
    token = await _user_token(client, f"p17res-{uuid.uuid4().hex[:8]}@example.com")
    note = await _create_note(client, token, "متن اصلی احیا")
    note_id = note["id"]

    await _push(client, token, "dev-a", [
        _op("p17-res-1", "user_ayah_note", note_id, "delete", base_version=1),
    ])
    # کلاینت حذف را دیده و با نسخهٔ جدیدتر بازمی‌گرداند
    res = await _push(client, token, "dev-a", [
        _op("p17-res-2", "user_ayah_note", note_id, "upsert",
            {"note_text": "احیاشده با آگاهی از حذف", "is_private": True,
             "surah": 2, "ayah": 152}, base_version=2),
    ])
    assert res[0]["status"] == "applied", res

    async with tc["maker"]() as db:
        row = await db.get(UserAyahNote, uuid.UUID(note_id))
        assert row is not None
        assert row.note_text == "احیاشده با آگاهی از حذف"
        ts = (
            await db.execute(
                select(SyncTombstone).where(
                    SyncTombstone.entity_type == "user_ayah_note",
                    SyncTombstone.entity_id == note_id,
                )
            )
        ).scalar_one_or_none()
        assert ts is None  # tombstone برداشته شد


# --- ۲) تاریخچهٔ حل تعارض ----------------------------------------------------------


async def test_second_conflict_keeps_resolution_history(tc):
    """تعارض دوم روی همان یادداشت → رکورد جدید؛ رکورد حل‌شده دست‌نخورده."""
    client = tc["client"]
    token = await _user_token(client, f"p17hist-{uuid.uuid4().hex[:8]}@example.com")
    note = await _create_note(client, token, "متن پایه")
    note_id = note["id"]

    # تعارض اول: A نسخهٔ ۲ را اعمال می‌کند، B بازنده می‌شود
    await _push(client, token, "dev-a", [
        _op("p17-h-1", "user_ayah_note", note_id, "upsert",
            {"note_text": "نسخهٔ A", "is_private": True}, base_version=1),
    ])
    res = await _push(client, token, "dev-b", [
        _op("p17-h-2", "user_ayah_note", note_id, "upsert",
            {"note_text": "نسخهٔ B", "is_private": True}, base_version=1),
    ])
    assert res[0]["status"] == "conflicted"
    cid1 = res[0]["conflict_id"]

    # حل با keep_local → نسخهٔ B اعمال می‌شود (نسخهٔ ۳)
    r = await client.post(
        f"{BASE}/sync/conflicts/{cid1}/resolve",
        json={"resolution": "keep_local"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["applied_version"] == 3

    # تعارض دوم: دستگاه C با base_version=2 (کهنه) ویرایش می‌کند
    res = await _push(client, token, "dev-c", [
        _op("p17-h-3", "user_ayah_note", note_id, "upsert",
            {"note_text": "نسخهٔ C", "is_private": True}, base_version=2),
    ])
    assert res[0]["status"] == "conflicted", res
    cid2 = res[0]["conflict_id"]
    assert cid2 != cid1

    # هر دو رکورد موجودند: اولی حل‌شده، دومی در انتظار
    body = await _conflicts(client, token, only_pending=False)
    assert body["total"] == 2
    by_id = {c["id"]: c for c in body["items"]}
    assert by_id[cid1]["resolution"] == "keep_local"
    assert by_id[cid1]["local_payload"]["note_text"] == "نسخهٔ B"  # دست‌نخورده
    assert by_id[cid2]["resolution"] == "pending"
    assert by_id[cid2]["local_payload"]["note_text"] == "نسخهٔ C"
    assert by_id[cid2]["remote_payload"]["note_text"] == "نسخهٔ B"  # برندهٔ فعلی


# --- ۳) شکاف کرسر ------------------------------------------------------------------


async def test_pull_cursor_has_no_gaps(tc):
    """pull افزایشی: هیچ ورودی‌ای بین دو pull جا نمی‌ماند؛ seqها پیوسته‌اند."""
    client = tc["client"]
    token = await _user_token(client, f"p17cur-{uuid.uuid4().hex[:8]}@example.com")

    # دستگاه X سه یادداشت می‌سازد (۳ ورودی changelog)
    ops = []
    for i in range(3):
        nid = str(uuid.uuid4())
        ops.append(_op(f"p17-cur-a{i}", "user_ayah_note", nid, "upsert",
                       {"note_text": f"یادداشت {i}", "is_private": True,
                        "surah": 1, "ayah": 1}, base_version=0))
    await _push(client, token, "dev-x", ops)

    p1 = await _pull(client, token, "dev-y", 0)
    assert len(p1["changes"]) == 3
    seqs = [c["seq"] for c in p1["changes"]]
    assert seqs == sorted(seqs)
    assert all(b - a == 1 for a, b in itertools.pairwise(seqs)), "seqها باید پیوسته باشند"
    cursor = p1["new_cursor"]

    # pull دوباره با کرسر جدید → خالی
    p2 = await _pull(client, token, "dev-y", cursor)
    assert p2["changes"] == []
    assert p2["new_cursor"] == cursor

    # دستگاه X: یک یادداشت جدید + حذف یکی از قبلی‌ها
    new_id = str(uuid.uuid4())
    await _push(client, token, "dev-x", [
        _op("p17-cur-b1", "user_ayah_note", new_id, "upsert",
            {"note_text": "یادداشت جدید", "is_private": True,
             "surah": 1, "ayah": 1}, base_version=0),
        _op("p17-cur-b2", "user_ayah_note", p1["changes"][0]["entity_id"],
            "delete", base_version=1),
    ])

    p3 = await _pull(client, token, "dev-y", cursor)
    assert len(p3["changes"]) == 2
    seqs3 = [c["seq"] for c in p3["changes"]]
    assert all(s > cursor for s in seqs3)
    assert all(b - a == 1 for a, b in itertools.pairwise(seqs3))
    assert {c["op_type"] for c in p3["changes"]} == {"upsert", "delete"}


# --- ۴) طوفان retry -----------------------------------------------------------------


async def test_push_retry_storm_idempotent_single_changelog_entry(tc):
    """بازپخش ۲۰بارهٔ همان batch: نتایج یکسان، فقط یک ورودی changelog."""
    from app.models.models import SyncChangeLog, SyncOperation, UserAyahNote

    client = tc["client"]
    token = await _user_token(client, f"p17storm-{uuid.uuid4().hex[:8]}@example.com")
    note_id = str(uuid.uuid4())
    ops = [
        _op("p17-storm-1", "user_ayah_note", note_id, "upsert",
            {"note_text": "یادداشت طوفان", "is_private": True,
             "surah": 3, "ayah": 4}, base_version=0),
    ]

    first = await _push(client, token, "dev-storm", ops)
    assert first[0]["status"] == "applied"
    assert first[0]["version"] == 1

    for _ in range(19):
        again = await _push(client, token, "dev-storm", ops)
        assert again == first  # دقیقاً همان نتیجه، بدون اعمال دوباره

    async with tc["maker"]() as db:
        n_ops = (
            await db.execute(
                select(func.count()).select_from(SyncOperation).where(
                    SyncOperation.client_op_id == "p17-storm-1"
                )
            )
        ).scalar()
        assert n_ops == 1
        n_log = (
            await db.execute(
                select(func.count()).select_from(SyncChangeLog).where(
                    SyncChangeLog.entity_type == "user_ayah_note",
                    SyncChangeLog.entity_id == note_id,
                )
            )
        ).scalar()
        assert n_log == 1  # فقط یک ورودی changelog
        row = await db.get(UserAyahNote, uuid.UUID(note_id))
        assert row.version == 1  # نسخه فقط یک‌بار بالا رفته
