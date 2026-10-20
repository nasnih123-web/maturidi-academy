"""تست‌های فاز ۹ — کتابخانهٔ چندرسانه‌ای (DMS).

پوشش (معیارهای پذیرش فاز ۹):
- ویرایش → نسخهٔ قبلی بایگانی می‌شود (قابل بازیابی)؛ revert اول وضعیت فعلی را بایگانی می‌کند
- scholars_only: بدون signed URL معتبر قابل دسترسی نیست (stream ناشناس → ۴۰۴؛
  کلید خام storage هرگز در پاسخ‌ها افشا نمی‌شود)
- جست‌وجوی واژه‌ای از داخل transcript → همان ویدیو پیدا می‌شود
- آپلود با پسوند جعلی (.pdf که واقعاً exe است) → 422
- index-ai با fatwa scope → chunk از طریق retrieval فاز ۶ قابل استناد است و
  استناد به صفحهٔ آیتم کتابخانه اشاره می‌کند (index → ask → citation)
- import برنامه‌ریزی‌شده همیشه در in_review می‌نشیند
- گذار نامعتبر گردش‌کار → 422
"""
from __future__ import annotations

import json
import uuid

from sqlalchemy import select

BASE = "/api/v1"

# حداقل بایت‌های معتبر برای عبور از magic-byte
PDF_BYTES = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
MP4_BYTES = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x01isom"
WAV_BYTES = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
EXE_BYTES = b"MZ" + b"\x90" * 64  # هدر اجرایی ویندوز — پسوند جعلی .pdf باید رد شود


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...] = (), role: str | None = None):
    """کاربر تست + توکن؛ با مجوزهای داده‌شده و نقش اختیاری (RBAC واقعی از جدول‌ها)."""
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        perms = []
        for key in permissions:
            p = (await db.execute(select(Permission).where(Permission.key == key))).scalar_one_or_none()
            if p is None:
                p = Permission(key=key, description=key)
                db.add(p)
                await db.flush()
            perms.append(p)
        role_obj = None
        if role:
            role_obj = (await db.execute(select(Role).where(Role.name == role))).scalar_one_or_none()
            if role_obj is None:
                role_obj = Role(name=role, description="test role")
                db.add(role_obj)
                await db.flush()
        test_role = Role(name=f"lib_test_role_{suffix}", description="library test role")
        db.add(test_role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=test_role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست کتابخانه",
            email=f"lib-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=test_role.id))
        if role_obj is not None:
            db.add(UserRole(user_id=user.id, role_id=role_obj.id))
        await db.commit()
    token = create_access_token(str(user.id))
    return {"Authorization": f"Bearer {token}", "user_id": str(user.id)}


def _meta(kind: str, **over) -> dict:
    m = {
        "kind": kind,
        "title": _L(f"آیتم تست {kind}"),
        "description": _L("توضیح تست"),
        "topic_tags": ["test"],
        "visibility": "registered",
    }
    m.update(over)
    return m


async def _upload(client, headers, kind, filename, content, **meta_over):
    meta = _meta(kind, **meta_over)
    files = {"file": (filename, content, "application/octet-stream")}
    r = await client.post(
        f"{BASE}/admin/library/items",
        data={"metadata": json.dumps(meta)},
        files=files,
        headers=headers,
    )
    return r


async def _publish(client, headers, item_id):
    for to in ("in_review", "approved", "published"):
        r = await client.post(
            f"{BASE}/admin/library/items/{item_id}/transition",
            json={"to": to}, headers=headers,
        )
        assert r.status_code == 200, r.text


async def test_version_archived_on_edit(tc):
    """ویرایش، نسخهٔ قبلی را بایگانی می‌کند (نه حذف)؛ revert اول فعلی را بایگانی می‌کند."""
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))

    r = await _upload(client, admin, "pdf", "doc.pdf", PDF_BYTES)
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["version"] == 1

    new_title = _L("عنوان ویرایش‌شده")
    r = await client.put(
        f"{BASE}/admin/library/items/{item['id']}",
        data={"metadata": json.dumps({"title": new_title, "note": "test edit"})},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["version"] == 2
    assert updated["title"]["fa"] == "عنوان ویرایش‌شده"

    r = await client.get(f"{BASE}/admin/library/items/{item['id']}/versions", headers=admin)
    assert r.status_code == 200, r.text
    versions = r.json()
    assert len(versions) == 1
    assert versions[0]["version"] == 1
    assert versions[0]["snapshot"]["title"]["fa"] == "آیتم تست pdf"  # نسخهٔ قدیمی قابل بازیابی
    assert versions[0]["note"] == "test edit"

    # revert → اول وضعیت فعلی بایگانی می‌شود، بعد بازگردانی
    r = await client.post(
        f"{BASE}/admin/library/items/{item['id']}/versions/1/revert",
        json={"note": "rollback test"}, headers=admin,
    )
    assert r.status_code == 200, r.text
    reverted = r.json()
    assert reverted["version"] == 3
    assert reverted["title"]["fa"] == "آیتم تست pdf"
    r = await client.get(f"{BASE}/admin/library/items/{item['id']}/versions", headers=admin)
    assert len(r.json()) == 2  # v1 + v2 (وضعیت فعلیِ قبل از revert)


async def test_scholars_only_signed_url_enforcement(tc):
    """آیتم scholars_only بدون signed URL معتبر قابل دسترسی نیست؛ کلید خام هرگز افشا نمی‌شود."""
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))
    scholar = await _make_user(tc, (), role="scholar")
    plain = await _make_user(tc, ())

    r = await _upload(client, admin, "pdf", "secret.pdf", PDF_BYTES, visibility="scholars_only")
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]
    await _publish(client, admin, item_id)

    # ناشناس: همه‌جا ۴۰۴ (نه ۴۰۳ — عدم افشای وجود)
    assert (await client.get(f"{BASE}/library/items/{item_id}")).status_code == 404
    r = await client.get(f"{BASE}/library/items/{item_id}/stream")
    assert r.status_code == 404, r.text
    r = await client.get(f"{BASE}/library/items")
    assert all(i["id"] != item_id for i in r.json()["items"])
    # کاربر عادی هم ۴۰۴
    assert (await client.get(f"{BASE}/library/items/{item_id}", headers=plain)).status_code == 404

    # عالم: دسترسی با signed URL
    r = await client.get(f"{BASE}/library/items/{item_id}", headers=scholar)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["media_url"] and "sig=" in body["media_url"]
    assert body["media_url"].startswith("http")
    # کلید خام storage به‌عنوان فیلد جدا در هیچ پاسخی نیست؛ فقط داخل
    # URL امضاشده (با HMAC و انقضای ۳۰۰ ثانیه‌ای) می‌آید — بدون امضای معتبر
    # همان کلید هم قابل دانلود نیست:
    dump = json.dumps(body)
    assert "media_key" not in dump
    r = await client.get(f"{BASE}/library/download-by-ref",
                         params={"key": "library/pdf/xxx.pdf", "exp": 9999999999, "sig": "bad"})
    assert r.status_code == 403, r.text

    # stream برای عالم → 302 به signed URL
    r = await client.get(f"{BASE}/library/items/{item_id}/stream", headers=scholar,
                         follow_redirects=False)
    assert r.status_code == 302, r.text
    assert "sig=" in r.headers["location"]
    assert "/api/v1/library/download-by-ref" in r.headers["location"]


async def test_transcript_search_finds_video(tc):
    """جست‌وجوی واژه‌ای از داخل transcript، همان ویدیو را پیدا می‌کند."""
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))

    r = await _upload(client, admin, "video", "clip.mp4", MP4_BYTES, visibility="public")
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]
    await _publish(client, admin, item_id)

    # transcript را مستقیم در DB می‌گذاریم (پایپ‌لاین Whisper در CI غایب است — رفتار graceful)
    from app.models.models import LibraryItem
    async with tc["maker"]() as db:
        item = await db.get(LibraryItem, uuid.UUID(item_id))
        item.transcript = "واژهٔ کاملاً منحصر‌به‌فرد آزمون: زَقّوم‌آزمایی"
        item.transcript_status = "done"
        await db.commit()

    r = await client.get(f"{BASE}/library/search", params={"q": "زَقّوم‌آزمایی"})
    assert r.status_code == 200, r.text
    hits = r.json()["hits"]
    assert len(hits) == 1
    assert hits[0]["item"]["id"] == item_id
    assert "transcript" in hits[0]["matched_in"]
    assert hits[0]["score"] > 0


async def test_fake_extension_upload_rejected(tc):
    """فایل exe با پسوند .pdf رد می‌شود (magic-byte، نه فقط پسوند)."""
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))

    r = await _upload(client, admin, "pdf", "evil.pdf", EXE_BYTES)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "file_content_mismatch"

    # و پسوند نامرتبط با kind هم رد می‌شود
    r = await _upload(client, admin, "pdf", "clip.mp4", MP4_BYTES)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "invalid_file_extension"


async def test_fatwa_scope_index_citation(tc):
    """index-ai با fatwa scope → chunk از retrieval فاز ۶ قابل استناد است و
    استناد به صفحهٔ آیتم کتابخانه اشاره می‌کند (index → ask → citation)."""
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage", "fatwa.approve"))

    r = await _upload(
        client, admin, "audio", "dars.wav", WAV_BYTES,
        visibility="public", include_in_fatwa_rag=True,
    )
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]
    await _publish(client, admin, item_id)

    from app.models.models import LibraryItem
    async with tc["maker"]() as db:
        item = await db.get(LibraryItem, uuid.UUID(item_id))
        item.transcript = "احکام طهارت در فقه حنفی بر مبنای اصول ماتریدیه بررسی می‌شود"
        item.transcript_status = "done"
        await db.commit()

    r = await client.post(f"{BASE}/admin/library/items/{item_id}/index-ai", headers=admin)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["ai_indexed"] is True
    assert result["chunks_created"] >= 1
    assert result["chunks_approved"] == result["chunks_created"]
    assert "fatwa" in result["scopes"]

    # سطح مدل: chunk با ارجاع درست به آیتم کتابخانه
    from app.models.models import FiqhKnowledgeChunk
    async with tc["maker"]() as db:
        ch = await db.get(FiqhKnowledgeChunk, uuid.UUID(result["chunk_ids"][0]))
        assert ch.source_ref["type"] == "library_item"
        assert ch.source_ref["id"] == item_id
        assert ch.source_library_item_ref == item_id
        assert ch.workflow_status == "approved"
        assert "fatwa" in (ch.ai_scopes or [])

    # سطح retrieval فاز ۶: chunk پیدا و قابل استناد است
    from app.modules.fatwa.embeddings import ChunkIndex, get_embedding_provider

    async with tc["maker"]() as db:
        provider = await get_embedding_provider(db, "hash")
        index = ChunkIndex(provider)
        scored = await index.search(db, "احکام طهارت در فقه حنفی", top_k=5, ai_scope="fatwa")
    lib_hits = [s for s in scored if (s.source_citation or {}).get("library_item_id") == item_id]
    assert lib_hits, "chunk آیتم کتابخانه در retrieval فاز ۶ پیدا نشد"
    assert f"/library/items/{item_id}" in (lib_hits[0].source_citation or {}).get("url", "")

    # end-to-end: ask → citation به آیتم اشاره می‌کند
    r = await client.post(
        f"{BASE}/fatwa/ask",
        json={"question": "احکام طهارت در فقه حنفی چیست؟", "locale": "fa"},
    )
    assert r.status_code == 200, r.text
    citations = r.json()["citations"]
    assert citations, "ask باید استناد برگرداند"
    urls = [c.get("source_citation", {}).get("url", "") for c in citations]
    assert any(item_id in u for u in urls), f"استناد به آیتم اشاره نکرد: {urls}"


async def test_import_lands_in_review(tc):
    """ایجاد برنامه‌ریزی‌شده (تلگرام) همیشه در in_review می‌نشیند."""
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))

    body = {
        "kind": "audio",
        "title": _L("صوت وارداتی از تلگرام"),
        "topic_tags": ["telegram"],
        "source_ref": {"chat_id": -100123, "message_id": 456, "file_unique_id": "abc123"},
    }
    r = await client.post(f"{BASE}/admin/library/import", json=body, headers=admin)
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["workflow_status"] == "in_review"
    assert item["source_type"] == "telegram_import"
    assert item["source_ref"]["message_id"] == 456
    # بدون بازبینی انسانی در فهرست عمومی نیست
    r = await client.get(f"{BASE}/library/items")
    assert all(i["id"] != item["id"] for i in r.json()["items"])


async def test_invalid_workflow_transition_422(tc):
    """گذار نامعتبر گردش‌کار (draft → published مستقیم) → 422."""
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))

    r = await _upload(client, admin, "pdf", "doc.pdf", PDF_BYTES)
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]

    r = await client.post(
        f"{BASE}/admin/library/items/{item_id}/transition",
        json={"to": "published"}, headers=admin,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "invalid_transition"

    # و وضعیت ناموجود هم 422
    r = await client.post(
        f"{BASE}/admin/library/items/{item_id}/transition",
        json={"to": "nonsense"}, headers=admin,
    )
    assert r.status_code == 422


async def test_delete_is_soft_archive(tc):
    """DELETE یعنی بایگانی (archived) — رکورد هرگز فیزیکی حذف نمی‌شود."""
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))

    r = await _upload(client, admin, "pdf", "doc.pdf", PDF_BYTES)
    item_id = r.json()["id"]
    r = await client.delete(f"{BASE}/admin/library/items/{item_id}", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["workflow_status"] == "archived"

    from app.models.models import LibraryItem
    async with tc["maker"]() as db:
        assert await db.get(LibraryItem, uuid.UUID(item_id)) is not None


async def test_reprocess_enqueues_and_resets_status(tc):
    """POST /reprocess: وضعیت pending + صف‌بندی job (ورکر آفلاین هم خطا نیست)."""
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))

    r = await _upload(client, admin, "audio", "clip.wav", WAV_BYTES)
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]

    r = await client.post(
        f"{BASE}/admin/library/items/{item_id}/reprocess",
        json={"job": "transcribe"}, headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.json()["transcript_status"] == "pending"

    r = await client.post(
        f"{BASE}/admin/library/items/{item_id}/reprocess",
        json={"job": "bogus"}, headers=admin,
    )
    assert r.status_code == 422, r.text


async def test_transition_note_recorded_in_audit(tc):
    """یادداشت بازبینی در audit ثبت می‌شود."""
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))

    r = await _upload(client, admin, "pdf", "doc.pdf", PDF_BYTES)
    item_id = r.json()["id"]

    r = await client.post(
        f"{BASE}/admin/library/items/{item_id}/transition",
        json={"to": "in_review", "note": "کیفیت صوت بررسی شد"},
        headers=admin,
    )
    assert r.status_code == 200, r.text

    from app.models.models import AuditLog
    async with tc["maker"]() as db:
        logs = (await db.execute(
            select(AuditLog).where(
                AuditLog.entity_type == "library_item",
                AuditLog.entity_id == item_id,
                AuditLog.action == "library.item.transition",
            )
        )).scalars().all()
        assert any((l.new_values or {}).get("note") == "کیفیت صوت بررسی شد" for l in logs)
