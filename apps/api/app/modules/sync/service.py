"""سرویس sync — منطق ادغام آفلاین (فاز ۱۳، ADR-0010).

همهٔ منطق کسب‌وکار این‌جاست (§۱۵.۲)؛ router فقط سیم‌کشی است (§۱۵.۶).

قرارداد entity_idها (پایدار و آفلاین‌سازگار):
- user_ayah_note: ‏str(note.id) — کلاینت هنگام ساخت آفلاین UUID خودش می‌سازد
- user_progress: ‏str(lesson_id) — کلید طبیعی، بدون نیاز به id ردیف
- dhikr_daily_count: ‏"{date_iso}:{dhikr_text}" — کلید طبیعی سه‌تایی

سیاست ادغام:
- اسکالرها (user_progress, dhikr_daily_count): max-wins قطعی، هرگز تعارض.
- محتوای نوشته‌شدهٔ کاربر (user_ayah_note): نسخه‌بندی خوش‌بینانه؛
  base_version < نسخهٔ فعلی و محتوا متفاوت → تعارض، هیچ نسخه‌ای بی‌صدا
  دور ریخته نمی‌شود (هر دو در conflict_records).
- حذف: tombstone ماندگار؛ pull حذف‌ها را هم منتشر می‌کند.
"""
from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.events import emit_event
from app.models.models import (
    ConflictRecord,
    DeviceCursor,
    DhikrDailyCount,
    Lesson,
    LibraryItem,
    SocialFollow,
    SyncChangeLog,
    SyncOperation,
    SyncTombstone,
    User,
    UserAyahNote,
    UserProgress,
)


def _utcnow() -> datetime:
    return datetime.now(UTC)


SYNCABLE_TYPES = ("user_ayah_note", "user_progress", "dhikr_daily_count")

# رتبهٔ وضعیت پیشرفت برای max-wins
_STATUS_RANK = {"not_started": 0, "in_progress": 1, "completed": 2}


# ---------------------------------------------------------------------------
# ابزار مشترک: ثبت تغییر در ژورنال (برای استفادهٔ سرویس‌های quran و lms هم)
# ---------------------------------------------------------------------------


async def record_entity_change(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    device_id: str | None,
    entity_type: str,
    entity_id: str,
    op_type: str,
    payload: dict | None,
    version: int,
) -> int:
    """ثبت یک تغییر در sync_changelog — تنها منبع pull.

    سرویس‌های quran/lms روی هر جهش مستقیم (آنلاین) هم این را صدا می‌زنند تا
    pull دستگاه‌ها کامل بماند؛ منطق ادغام این‌جا نیست، فقط ثبت است (§۱۵.۲).
    """
    entry = SyncChangeLog(
        user_id=user_id,
        device_id=device_id,
        entity_type=entity_type,
        entity_id=entity_id,
        op_type=op_type,
        payload=payload,
        version=version,
    )
    db.add(entry)
    await db.flush()
    return entry.seq


# ---------------------------------------------------------------------------
# push — پردازش batch عملیات
# ---------------------------------------------------------------------------


async def push_batch(
    db: AsyncSession, user: User, *, device_id: str, ops: list[dict]
) -> list[dict]:
    results: list[dict] = []
    for op in ops:
        results.append(await _apply_op(db, user, device_id=device_id, op=op))
    await db.commit()
    return results


async def _apply_op(
    db: AsyncSession, user: User, *, device_id: str, op: dict
) -> dict:
    client_op_id = op["client_op_id"]
    entity_type = op["entity_type"]
    entity_id = op["entity_id"]
    op_type = op["op_type"]

    # --- idempotency: بازپخش همان client_op_id دقیقاً همان نتیجه را می‌دهد ---
    existing = (
        await db.execute(
            select(SyncOperation).where(SyncOperation.client_op_id == client_op_id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.user_id != user.id:
            raise APIError(409, "sync_op_id_conflict",
                           "شناسهٔ عملیات متعلق به کاربر دیگری است")
        return dict(existing.result or {})

    if entity_type not in SYNCABLE_TYPES:
        return await _store_op(
            db, user, device_id, op,
            status="rejected", detail="entity_type_not_syncable",
        )

    record = SyncOperation(
        user_id=user.id,
        device_id=device_id,
        client_op_id=client_op_id,
        entity_type=entity_type,
        entity_id=entity_id,
        op_type=op_type,
        payload=op.get("payload") or {},
        base_version=op.get("base_version") or 0,
        status="pending",
    )
    db.add(record)
    await db.flush()

    if op_type == "delete":
        outcome = await _apply_delete(db, user, device_id, record)
    elif op_type == "upsert":
        outcome = await _apply_upsert(db, user, device_id, record)
    else:
        outcome = {"status": "rejected", "detail": "unknown_op_type"}

    record.status = outcome["status"]
    record.result = {
        "client_op_id": client_op_id,
        "status": outcome["status"],
        "entity_type": entity_type,
        "entity_id": entity_id,
        "version": outcome.get("version"),
        "conflict_id": str(outcome["conflict_id"]) if outcome.get("conflict_id") else None,
        "detail": outcome.get("detail"),
    }
    record.applied_at = _utcnow()
    await db.flush()
    return record.result


async def _store_op(
    db: AsyncSession, user: User, device_id: str, op: dict, *,
    status: str, detail: str | None = None,
    version: int | None = None, conflict_id: uuid.UUID | None = None,
) -> dict:
    record = SyncOperation(
        user_id=user.id,
        device_id=device_id,
        client_op_id=op["client_op_id"],
        entity_type=op["entity_type"],
        entity_id=op["entity_id"],
        op_type=op["op_type"],
        payload=op.get("payload") or {},
        base_version=op.get("base_version") or 0,
        status=status,
        result={
            "client_op_id": op["client_op_id"],
            "status": status,
            "entity_type": op["entity_type"],
            "entity_id": op["entity_id"],
            "version": version,
            "conflict_id": str(conflict_id) if conflict_id else None,
            "detail": detail,
        },
        applied_at=_utcnow(),
    )
    db.add(record)
    await db.flush()
    return dict(record.result or {})


async def _get_tombstone(
    db: AsyncSession, user_id: uuid.UUID, entity_type: str, entity_id: str
) -> SyncTombstone | None:
    return (
        await db.execute(
            select(SyncTombstone).where(
                SyncTombstone.user_id == user_id,
                SyncTombstone.entity_type == entity_type,
                SyncTombstone.entity_id == entity_id,
            )
        )
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# upsert به‌تفکیک نوع موجودیت
# ---------------------------------------------------------------------------


async def _apply_upsert(
    db: AsyncSession, user: User, device_id: str, record: SyncOperation
) -> dict:
    entity_type = record.entity_type
    entity_id = record.entity_id
    base_version = record.base_version or 0
    payload = record.payload or {}

    tombstone = await _get_tombstone(db, user.id, entity_type, entity_id)
    if tombstone is not None and base_version <= (tombstone.version or 0):
        # موجودیت حذف شده و نسخهٔ کلاینت قدیمی‌تر/مساوی حذف است
        if entity_type == "user_ayah_note":
            return await _note_conflict(
                db, user, device_id, record,
                remote_payload=None, remote_version=None,
                detail="upsert_on_tombstone",
            )
        return {
            "status": "rejected", "detail": "tombstoned",
            "version": None, "conflict_id": None,
        }
    if tombstone is not None:
        # نسخهٔ کلاینت جدیدتر از حذف است → احیا (tombstone برداشته می‌شود)
        await db.delete(tombstone)
        await db.flush()

    if entity_type == "user_ayah_note":
        return await _upsert_note(db, user, device_id, record, payload, base_version)
    if entity_type == "user_progress":
        return await _upsert_progress(db, user, device_id, record, payload)
    if entity_type == "dhikr_daily_count":
        return await _upsert_dhikr(db, user, device_id, record, payload)
    return {"status": "rejected", "detail": "entity_type_not_syncable"}


def _parse_note_id(entity_id: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(entity_id)
    except (ValueError, AttributeError, TypeError):
        return None


def _note_snapshot(note: UserAyahNote) -> dict:
    return {
        "id": str(note.id),
        "surah": note.surah,
        "ayah": note.ayah,
        "note_text": note.note_text,
        "is_private": note.is_private,
        "version": note.version,
    }


def _note_content_equal(a: dict, b: dict) -> bool:
    return (
        (a.get("note_text") or "").strip() == (b.get("note_text") or "").strip()
        and bool(a.get("is_private", True)) == bool(b.get("is_private", True))
    )


async def _upsert_note(
    db: AsyncSession, user: User, device_id: str,
    record: SyncOperation, payload: dict, base_version: int,
) -> dict:
    note_id = _parse_note_id(record.entity_id)
    if note_id is None:
        return {"status": "rejected", "detail": "invalid_note_id"}
    note = await db.get(UserAyahNote, note_id)
    if note is not None and note.user_id != user.id:
        return {"status": "rejected", "detail": "not_owner"}

    if note is None:
        # ساخت آفلاین — کلاینت UUID خودش را داده است
        try:
            surah = int(payload["surah"])
            ayah = int(payload["ayah"])
            note_text = str(payload["note_text"]).strip()
        except (KeyError, TypeError, ValueError):
            return {"status": "rejected", "detail": "missing_note_fields"}
        if not note_text:
            return {"status": "rejected", "detail": "empty_note_text"}
        note = UserAyahNote(
            id=note_id, user_id=user.id, surah=surah, ayah=ayah,
            note_text=note_text,
            is_private=bool(payload.get("is_private", True)),
            version=1,
        )
        db.add(note)
        await db.flush()
        await record_entity_change(
            db, user_id=user.id, device_id=device_id,
            entity_type="user_ayah_note", entity_id=str(note.id),
            op_type="upsert", payload=_note_snapshot(note), version=1,
        )
        return {"status": "applied", "version": 1}

    current_version = note.version or 1
    incoming: dict[str, object] = {
        "note_text": str(payload.get("note_text", note.note_text)),
        "is_private": bool(payload.get("is_private", note.is_private)),
    }
    incoming_text = str(incoming["note_text"])
    incoming_private = bool(incoming["is_private"])
    if base_version >= current_version:
        # بدون ویرایش هم‌زمان (یا کلاینت جلوتر است — ناهنجاری، ولی محتوا صریحاً
        # از کاربر آمده پس اعمال می‌شود؛ نسخه یکنوا بالا می‌رود)
        note.note_text = incoming_text.strip()
        note.is_private = incoming_private
        note.version = max(current_version, base_version) + 1
        note.updated_at = _utcnow()
        await db.flush()
        await record_entity_change(
            db, user_id=user.id, device_id=device_id,
            entity_type="user_ayah_note", entity_id=str(note.id),
            op_type="upsert", payload=_note_snapshot(note), version=note.version,
        )
        return {"status": "applied", "version": note.version}

    # base_version < current_version → ویرایش هم‌زمان؟
    if _note_content_equal(incoming, _note_snapshot(note)):
        # همان محتوا از دو دستگاه — تغییری لازم نیست، ولی applied گزارش می‌شود
        return {"status": "applied", "version": current_version,
                "detail": "already_in_sync"}
    return await _note_conflict(
        db, user, device_id, record,
        remote_payload=_note_snapshot(note), remote_version=current_version,
        detail="concurrent_edit",
    )


async def _note_conflict(
    db: AsyncSession, user: User, device_id: str, record: SyncOperation, *,
    remote_payload: dict | None, remote_version: int | None, detail: str,
) -> dict:
    """ثبت تعارض یادداشت — نسخهٔ سرور نگه داشته می‌شود، نسخهٔ کلاینت
    در conflict_records ذخیره می‌شود؛ هیچ‌چیز بی‌صدا دور ریخته نمی‌شود."""
    payload = record.payload or {}
    conflict = ConflictRecord(
        user_id=user.id,
        entity_type="user_ayah_note",
        entity_id=record.entity_id,
        local_payload={
            "note_text": str(payload.get("note_text", "")),
            "is_private": bool(payload.get("is_private", True)),
            "surah": payload.get("surah"),
            "ayah": payload.get("ayah"),
            "device_id": device_id,
            "client_op_id": record.client_op_id,
        },
        remote_payload=remote_payload,
        local_version=record.base_version or 0,
        remote_version=remote_version,
    )
    db.add(conflict)
    await db.flush()
    await emit_event(
        db,
        aggregate_type="sync_conflict",
        aggregate_id=str(conflict.id),
        event_type="sync.conflict_detected",
        payload={
            "user_id": str(user.id),
            "entity_type": "user_ayah_note",
            "entity_id": record.entity_id,
            "local_version": record.base_version or 0,
            "remote_version": remote_version,
            "device_id": device_id,
        },
        source_client=device_id,
        idempotency_key=f"sync-conflict:{record.client_op_id}",
    )
    return {
        "status": "conflicted", "detail": detail,
        "version": remote_version, "conflict_id": conflict.id,
    }


def _parse_progress_id(entity_id: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(entity_id)
    except (ValueError, AttributeError, TypeError):
        return None


async def _upsert_progress(
    db: AsyncSession, user: User, device_id: str, record: SyncOperation, payload: dict,
) -> dict:
    """max-wins قطعی برای پیشرفت: position_seconds → بیشینه؛ status → پیشرفته‌ترین.
    هرگز تعارض ندارد (قاعدهٔ ساده برای دادهٔ ساده — ADR-0010)."""
    lesson_id = _parse_progress_id(record.entity_id)
    if lesson_id is None:
        return {"status": "rejected", "detail": "invalid_lesson_id"}
    lesson = await db.get(Lesson, lesson_id)
    if lesson is None:
        return {"status": "rejected", "detail": "lesson_not_found"}

    prog = (
        await db.execute(
            select(UserProgress).where(
                UserProgress.user_id == user.id,
                UserProgress.lesson_id == lesson_id,
            )
        )
    ).scalar_one_or_none()

    incoming_status = str(payload.get("status", "in_progress"))
    if incoming_status not in _STATUS_RANK:
        return {"status": "rejected", "detail": "invalid_status"}
    incoming_pos = max(0, int(payload.get("position_seconds", 0) or 0))

    now = _utcnow()
    if prog is None:
        prog = UserProgress(
            user_id=user.id, lesson_id=lesson_id,
            status=incoming_status, position_seconds=incoming_pos,
            version=1,
        )
        if incoming_status == "completed":
            prog.completed_at = now
        db.add(prog)
        await db.flush()
    else:
        prog.position_seconds = max(prog.position_seconds or 0, incoming_pos)
        if _STATUS_RANK[incoming_status] > _STATUS_RANK.get(prog.status or "not_started", 0):
            prog.status = incoming_status
            if incoming_status == "completed" and prog.completed_at is None:
                prog.completed_at = now
        if prog.status != "completed":
            prog.completed_at = None
        prog.version = (prog.version or 1) + 1
        prog.updated_at = now
        await db.flush()

    await record_entity_change(
        db, user_id=user.id, device_id=device_id,
        entity_type="user_progress", entity_id=str(lesson_id),
        op_type="upsert",
        payload={
            "lesson_id": str(lesson_id),
            "status": prog.status,
            "position_seconds": prog.position_seconds,
            "version": prog.version,
        },
        version=prog.version,
    )
    return {"status": "applied", "version": prog.version}


def _parse_dhikr_id(entity_id: str) -> tuple[date | None, str | None]:
    """entity_id شکل "{date_iso}:{dhikr_text}"."""
    try:
        day_s, _, text = entity_id.partition(":")
        day = date.fromisoformat(day_s)
    except (ValueError, AttributeError):
        return None, None
    text = (text or "").strip()
    if not text:
        return None, None
    return day, text


async def _upsert_dhikr(
    db: AsyncSession, user: User, device_id: str, record: SyncOperation, payload: dict,
) -> dict:
    """max-wins برای شمارش روزانهٔ ذکر — هرگز تعارض ندارد."""
    day, text = _parse_dhikr_id(record.entity_id)
    if day is None or text is None:
        return {"status": "rejected", "detail": "invalid_dhikr_id"}
    # payload هم می‌تواند روز/متن را بدهد؛ ناسازگاری → رد صادقانه
    p_day = payload.get("date")
    p_text = str(payload.get("dhikr_text", "") or "").strip()
    if p_day and p_day != day.isoformat():
        return {"status": "rejected", "detail": "dhikr_id_payload_mismatch"}
    if p_text and p_text != text:
        return {"status": "rejected", "detail": "dhikr_id_payload_mismatch"}

    incoming = max(0, int(payload.get("total_count", 0) or 0))
    row = (
        await db.execute(
            select(DhikrDailyCount).where(
                DhikrDailyCount.user_id == user.id,
                DhikrDailyCount.date == day,
                DhikrDailyCount.dhikr_text == text,
            )
        )
    ).scalar_one_or_none()
    now = _utcnow()
    if row is None:
        row = DhikrDailyCount(
            user_id=user.id, date=day, dhikr_text=text,
            total_count=incoming, version=1, updated_at=now,
        )
        db.add(row)
        await db.flush()
    else:
        row.total_count = max(row.total_count or 0, incoming)
        row.version = (row.version or 1) + 1
        row.updated_at = now
        await db.flush()

    await record_entity_change(
        db, user_id=user.id, device_id=device_id,
        entity_type="dhikr_daily_count", entity_id=record.entity_id,
        op_type="upsert",
        payload={
            "date": day.isoformat(), "dhikr_text": text,
            "total_count": row.total_count, "version": row.version,
        },
        version=row.version,
    )
    return {"status": "applied", "version": row.version}


# ---------------------------------------------------------------------------
# delete — tombstone
# ---------------------------------------------------------------------------


async def _apply_delete(
    db: AsyncSession, user: User, device_id: str, record: SyncOperation
) -> dict:
    entity_type = record.entity_type
    entity_id = record.entity_id
    now = _utcnow()

    entity_version = record.base_version or 0
    deleted_row = await _delete_entity_row(db, user, entity_type, entity_id)
    if deleted_row is not None:
        entity_version = max(entity_version, deleted_row)

    tombstone = await _get_tombstone(db, user.id, entity_type, entity_id)
    if tombstone is None:
        tombstone = SyncTombstone(
            user_id=user.id, entity_type=entity_type, entity_id=entity_id,
            deleted_by=user.id, deleted_at=now, version=entity_version,
        )
        db.add(tombstone)
    else:
        tombstone.version = max(tombstone.version or 0, entity_version)
        tombstone.deleted_at = now
        tombstone.deleted_by = user.id
    await db.flush()

    await record_entity_change(
        db, user_id=user.id, device_id=device_id,
        entity_type=entity_type, entity_id=entity_id,
        op_type="delete", payload=None, version=tombstone.version,
    )
    return {"status": "applied", "version": tombstone.version}


async def _delete_entity_row(
    db: AsyncSession, user: User, entity_type: str, entity_id: str
) -> int | None:
    """حذف فیزیکی ردیفِ موجودیتِ متعلق به کاربر؛ نسخهٔ حذف‌شده را برمی‌گرداند."""
    if entity_type == "user_ayah_note":
        note_id = _parse_note_id(entity_id)
        if note_id is None:
            return None
        note = await db.get(UserAyahNote, note_id)
        if note is None or note.user_id != user.id:
            return None
        version = note.version or 1
        await db.delete(note)
        await db.flush()
        return version
    if entity_type == "user_progress":
        lesson_id = _parse_progress_id(entity_id)
        if lesson_id is None:
            return None
        prog = (
            await db.execute(
                select(UserProgress).where(
                    UserProgress.user_id == user.id,
                    UserProgress.lesson_id == lesson_id,
                )
            )
        ).scalar_one_or_none()
        if prog is None:
            return None
        version = prog.version or 1
        await db.delete(prog)
        await db.flush()
        return version
    if entity_type == "dhikr_daily_count":
        day, text = _parse_dhikr_id(entity_id)
        if day is None or text is None:
            return None
        row = (
            await db.execute(
                select(DhikrDailyCount).where(
                    DhikrDailyCount.user_id == user.id,
                    DhikrDailyCount.date == day,
                    DhikrDailyCount.dhikr_text == text,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        version = row.version or 1
        await db.delete(row)
        await db.flush()
        return version
    return None


# ---------------------------------------------------------------------------
# pull / cursor
# ---------------------------------------------------------------------------


async def get_cursor(db: AsyncSession, user: User, device_id: str) -> int:
    row = (
        await db.execute(
            select(DeviceCursor).where(
                DeviceCursor.user_id == user.id,
                DeviceCursor.device_id == device_id,
            )
        )
    ).scalar_one_or_none()
    return int(row.cursor_seq) if row else 0


async def list_devices(
    db: AsyncSession, user: User | None = None, limit: int = 100
) -> list[dict]:
    """دستگاه‌های ثبت‌شده: owner-scoped (user داده شود) یا همه (ادمین).

    برای داشبورد sync در CRM — آخرین کرسر و آخرین دیده‌شدن هر دستگاه.
    اجتماع user_devices (ثبت‌شده با توکن) و device_cursors (فقط sync کرده):
    دستگاهی که فقط sync کرده ولی توکن ثبت نکرده هم دیده می‌شود.
    """
    def _scope(q):
        return q if user is None else q.where(DeviceCursor.user_id == user.id)

    cursor_rows = (
        await db.execute(_scope(select(DeviceCursor).order_by(DeviceCursor.updated_at.desc()).limit(limit)))
    ).scalars().all()
    from app.models.models import UserDevice

    uq = select(UserDevice)
    if user is not None:
        uq = uq.where(UserDevice.user_id == user.id)
    dev_rows = (await db.execute(uq.limit(limit))).scalars().all()

    merged: dict[tuple, dict] = {}
    for r in cursor_rows:
        merged[(r.user_id, r.device_id)] = {
            "user_id": r.user_id,
            "device_id": r.device_id,
            "cursor_seq": int(r.cursor_seq or 0),
            "updated_at": r.updated_at,
            "platform": None,
        }
    for r in dev_rows:
        key = (r.user_id, r.device_id)
        entry = merged.get(key)
        if entry is None:
            merged[key] = {
                "user_id": r.user_id,
                "device_id": r.device_id,
                "cursor_seq": 0,
                "updated_at": r.last_seen,
                "platform": r.platform,
            }
        else:
            entry["platform"] = r.platform
            if r.last_seen and (entry["updated_at"] is None or r.last_seen > entry["updated_at"]):
                entry["updated_at"] = r.last_seen
    return sorted(merged.values(), key=lambda e: e["updated_at"] or "", reverse=True)[:limit]


async def pull_changes(
    db: AsyncSession, user: User, *, device_id: str, cursor: int, limit: int = 200
) -> tuple[list[dict], int]:
    """تغییرات seq > cursor همان کاربر، به ترتیب seq؛ کرسر دستگاه جلو می‌رود."""
    limit = min(max(limit, 1), 500)
    rows = list(
        (
            await db.execute(
                select(SyncChangeLog)
                .where(
                    SyncChangeLog.user_id == user.id,
                    SyncChangeLog.seq > cursor,
                )
                .order_by(SyncChangeLog.seq.asc())
                .limit(limit + 1)
            )
        )
        .scalars()
        .all()
    )
    rows = rows[:limit]
    changes = [
        {
            "seq": r.seq,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "op_type": r.op_type,
            "payload": r.payload,
            "version": r.version,
            "device_id": r.device_id,
            "created_at": r.created_at,
        }
        for r in rows
    ]
    new_cursor = max([cursor] + [r.seq for r in rows]) if rows else cursor
    if rows:
        await _advance_cursor(db, user, device_id, new_cursor)
        await db.commit()
    return changes, new_cursor


async def _advance_cursor(
    db: AsyncSession, user: User, device_id: str, seq: int
) -> None:
    row = (
        await db.execute(
            select(DeviceCursor).where(
                DeviceCursor.user_id == user.id,
                DeviceCursor.device_id == device_id,
            )
        )
    ).scalar_one_or_none()
    now = _utcnow()
    if row is None:
        db.add(DeviceCursor(
            user_id=user.id, device_id=device_id,
            cursor_seq=seq, updated_at=now,
        ))
    elif seq > (row.cursor_seq or 0):
        row.cursor_seq = seq
        row.updated_at = now
    await db.flush()


# ---------------------------------------------------------------------------
# تعارض‌ها — فهرست و حل
# ---------------------------------------------------------------------------


async def list_conflicts(
    db: AsyncSession, user: User, *, only_pending: bool = True, limit: int = 50
) -> tuple[list[ConflictRecord], int]:
    stmt = select(ConflictRecord).where(ConflictRecord.user_id == user.id)
    if only_pending:
        stmt = stmt.where(ConflictRecord.resolution == "pending")
    total = (
        await db.execute(
            select(func.count()).select_from(stmt.subquery())
        )
    ).scalar_one()
    rows = list(
        (
            await db.execute(
                stmt.order_by(ConflictRecord.created_at.desc()).limit(min(limit, 100))
            )
        )
        .scalars()
        .all()
    )
    return rows, int(total)


async def resolve_conflict(
    db: AsyncSession, user: User, conflict_id: uuid.UUID, *,
    resolution: str, merged_payload: dict | None, note: str | None,
    device_id: str = "api",
) -> dict:
    conflict = await db.get(ConflictRecord, conflict_id)
    if conflict is None or conflict.user_id != user.id:
        raise APIError(404, "conflict_not_found", "تعارضی با این شناسه یافت نشد")
    if conflict.resolution != "pending":
        raise APIError(409, "conflict_already_resolved", "این تعارض قبلاً حل شده است")
    if conflict.entity_type != "user_ayah_note":
        raise APIError(422, "unsupported_entity_resolution",
                       "حل تعارض فقط برای یادداشت آیه پشتیبانی می‌شود")

    now = _utcnow()
    if resolution == "keep_remote":
        applied_version = conflict.remote_version
    else:
        payload = conflict.local_payload if resolution == "keep_local" else (merged_payload or {})
        if resolution == "merged" and not merged_payload:
            raise APIError(422, "merged_payload_required",
                           "برای ادغام دستی، merged_payload الزامی است")
        applied_version = await _apply_resolution_payload(
            db, user, device_id, conflict, payload or {},
        )

    conflict.resolution = resolution
    conflict.resolved_by = user.id
    conflict.resolved_at = now
    conflict.resolution_note = (note or "").strip() or None
    await db.flush()
    await emit_event(
        db,
        aggregate_type="sync_conflict",
        aggregate_id=str(conflict.id),
        event_type="sync.conflict_resolved",
        payload={
            "user_id": str(user.id),
            "entity_type": conflict.entity_type,
            "entity_id": conflict.entity_id,
            "resolution": resolution,
            "applied_version": applied_version,
        },
        source_client=device_id,
        idempotency_key=f"sync-resolve:{conflict.id}:{resolution}",
    )
    await db.commit()
    return {
        "id": conflict.id,
        "resolution": resolution,
        "applied_version": applied_version,
    }


async def _apply_resolution_payload(
    db: AsyncSession, user: User, device_id: str,
    conflict: ConflictRecord, payload: dict,
) -> int:
    """اعمال نسخهٔ برندهٔ تعارض روی یادداشت (یا احیای آن پس از tombstone)."""
    note_id = _parse_note_id(conflict.entity_id)
    if note_id is None:
        raise APIError(422, "invalid_note_id", "شناسهٔ یادداشت نامعتبر است")
    note = await db.get(UserAyahNote, note_id)
    now = _utcnow()
    if note is None:
        # احیا پس از حذف (تعارض upsert_on_tombstone با keep_local/merged)
        surah = payload.get("surah") or (conflict.remote_payload or {}).get("surah")
        ayah = payload.get("ayah") or (conflict.remote_payload or {}).get("ayah")
        note_text = str(payload.get("note_text") or "").strip()
        if surah is None or ayah is None or not note_text:
            raise APIError(422, "insufficient_payload",
                           "برای احیای یادداشت، surah/ayah/note_text لازم است")
        note = UserAyahNote(
            id=note_id, user_id=user.id, surah=int(surah), ayah=int(ayah),
            note_text=note_text,
            is_private=bool(payload.get("is_private", True)),
            version=1,
        )
        db.add(note)
        tombstone = await _get_tombstone(
            db, user.id, "user_ayah_note", conflict.entity_id)
        if tombstone is not None:
            await db.delete(tombstone)
        await db.flush()
    else:
        if note.user_id != user.id:
            raise APIError(404, "conflict_not_found", "تعارضی با این شناسه یافت نشد")
        note_text = str(payload.get("note_text", note.note_text) or "").strip()
        if not note_text:
            raise APIError(422, "empty_note_text", "متن یادداشت نمی‌تواند خالی باشد")
        note.note_text = note_text
        note.is_private = bool(payload.get("is_private", note.is_private))
        note.version = (note.version or 1) + 1
        note.updated_at = now
        await db.flush()

    await record_entity_change(
        db, user_id=user.id, device_id=device_id,
        entity_type="user_ayah_note", entity_id=str(note.id),
        op_type="upsert", payload=_note_snapshot(note), version=note.version,
    )
    return note.version


# ---------------------------------------------------------------------------
# offline-pack — اولویت دانلود آفلاین (امتیازدهی ساده و صادقانه، بدون ML)
# ---------------------------------------------------------------------------

_PACK_STARTED_IN_PROGRESS = 100
_PACK_STARTED_COMPLETED = 90
_PACK_FOLLOWED = 70
_PACK_POPULAR = 50
_PACK_LIMIT = 50


async def offline_pack(db: AsyncSession, user: User) -> list[dict]:
    """شروع‌شده > دنبال‌شده > محبوب.

    - شروع‌شده: درس‌هایی که user_progress دارند (in_progress بالاتر از completed).
    - دنبال‌شده: آیتم‌های کتابخانهٔ منتشرشده از اساتیدی که کاربر دنبال می‌کند.
    - محبوب: جدیدترین آیتم‌های منتشرشدهٔ کتابخانه (پروکسی صادقانهٔ «محبوب» —
      شمارندهٔ دانلود/بازدید در این فاز وجود ندارد؛ ADR-0010).
    """
    items: list[dict] = []
    seen: set[tuple[str, str]] = set()

    # ۱) شروع‌شده
    prog_rows = list(
        (
            await db.execute(
                select(UserProgress, Lesson)
                .join(Lesson, Lesson.id == UserProgress.lesson_id)
                .where(UserProgress.user_id == user.id)
                .order_by(UserProgress.updated_at.desc())
                .limit(_PACK_LIMIT)
            )
        ).all()
    )
    for prog, lesson in prog_rows:
        key = ("lesson", str(lesson.id))
        if key in seen:
            continue
        seen.add(key)
        items.append({
            "kind": "lesson",
            "ref_id": str(lesson.id),
            "title": lesson.title or {},
            "score": _PACK_STARTED_IN_PROGRESS
            if prog.status == "in_progress" else _PACK_STARTED_COMPLETED,
            "reason": "started",
        })

    # ۲) دنبال‌شده — آیتم‌های منتشرشدهٔ اساتید دنبال‌شده
    followed_ids = list(
        (
            await db.execute(
                select(SocialFollow.followed_id).where(
                    SocialFollow.follower_id == user.id
                )
            )
        ).scalars().all()
    )
    if followed_ids:
        lib_rows = list(
            (
                await db.execute(
                    select(LibraryItem)
                    .where(
                        LibraryItem.scholar_id.in_(followed_ids),
                        LibraryItem.workflow_status.in_(("approved", "published")),
                        LibraryItem.visibility.in_(("public", "registered")),
                    )
                    .order_by(LibraryItem.published_at.desc().nullslast())
                    .limit(_PACK_LIMIT)
                )
            ).scalars().all()
        )
        for item in lib_rows:
            key = ("library_item", str(item.id))
            if key in seen:
                continue
            seen.add(key)
            items.append({
                "kind": "library_item",
                "ref_id": str(item.id),
                "title": item.title or {},
                "score": _PACK_FOLLOWED,
                "reason": "followed",
            })

    # ۳) محبوب — جدیدترین‌های منتشرشده (پروکسی recency؛ صادقانه در ADR)
    popular_rows = list(
        (
            await db.execute(
                select(LibraryItem)
                .where(
                    LibraryItem.workflow_status.in_(("approved", "published")),
                    LibraryItem.visibility.in_(("public", "registered")),
                )
                .order_by(LibraryItem.published_at.desc().nullslast())
                .limit(_PACK_LIMIT)
            )
        ).scalars().all()
    )
    for item in popular_rows:
        key = ("library_item", str(item.id))
        if key in seen:
            continue
        seen.add(key)
        items.append({
            "kind": "library_item",
            "ref_id": str(item.id),
            "title": item.title or {},
            "score": _PACK_POPULAR,
            "reason": "popular",
        })

    items.sort(key=lambda i: (-i["score"], i["kind"], i["ref_id"]))
    return items[:_PACK_LIMIT]
