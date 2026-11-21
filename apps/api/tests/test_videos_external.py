"""تست‌های ویدیوی خارجی (یوتیوب) — ساخت با لینک، بدون آپلود فایل.

پوشش:
- تجزیه‌گر URL یوتیوب: همهٔ فرم‌های پذیرفته + ردشده‌ها
- ساخت آیتم ویدیویی با external_url و بدون فایل (۲۰۱، media_key خالی،
  URL کانونیک ذخیره می‌شود) — این مسیر اسکن ClamAV را دور می‌زند
- لینک خارجی روی kind غیر ویدیویی → 422 external_url_not_allowed
- لینک نامعتبر → 422 invalid_youtube_url؛ نه فایل نه لینک → 422 file_required
- عنوان خودکار از oEmbed (مانکی‌پچ): موفق → عنوان در هر سه زبان؛
  ناموفق و بدون عنوان دستی → 422 title_required؛ با عنوان دستی oEmbed
  اصلاً صدا زده نمی‌شود
- قاعدهٔ «فایل برنده است»: آپلود فایل روی آیتم خارجی، لینک را پاک می‌کند
- payload فهرست/تماشا: embed_url + stream_url=null + کاور بندانگشتی یوتیوب
- پیشرفت پخش روی آیتم خارجی: PUT → 422 external_video؛ GET → ۲۰۰ با nullها

همهٔ تست‌ها آفلاین‌اند (oEmbed مانکی‌پچ می‌شود).
"""
from __future__ import annotations

import json
import uuid

from sqlalchemy import select

BASE = "/api/v1"

MP4_BYTES = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x01isom"
VIDEO_ID = "dQw4w9WgXcQ"
WATCH_URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"
EMBED_URL = f"https://www.youtube-nocookie.com/embed/{VIDEO_ID}"
THUMB_URL = f"https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg"


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    """کاربر تست + توکن؛ با مجوزهای داده‌شده (الگوی تست‌های کتابخانه)."""
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
        test_role = Role(name=f"ext_test_role_{suffix}", description="external test role")
        db.add(test_role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=test_role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست لینک خارجی",
            email=f"ext-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=test_role.id))
        await db.commit()
        token = create_access_token(str(user.id))
        user_id = str(user.id)
    return {"Authorization": f"Bearer {token}", "user_id": user_id}


async def _admin(tc):
    return await _make_user(tc, permissions=("library.manage",))


def _meta(kind: str, **over) -> dict:
    m = {
        "kind": kind,
        "title": _L(f"آیتم تست {kind}"),
        "description": _L("توضیح تست"),
        "topic_tags": ["test"],
        "visibility": "public",
    }
    m.update(over)
    return m


async def _create_link(client, headers, meta: dict):
    """ساخت بدون فایل — فقط فیلد metadata (مسیر لینک خارجی)."""
    return await client.post(
        f"{BASE}/admin/library/items",
        data={"metadata": json.dumps(meta)},
        headers=headers,
    )


async def _make_external_item(tc, **over) -> str:
    """آیتم خارجی منتشرشده، مستقیم در دیتابیس (الگوی تست‌های پیشرفت)."""
    from app.models.models import LibraryItem

    fields = {
        "kind": "video",
        "title": _L("ویدیوی خارجی تست"),
        "description": _L("توضیح تست"),
        "cover_media_key": None,
        "media_key": None,
        "external_url": WATCH_URL,
        "topic_tags": [],
        "visibility": "public",
        "workflow_status": "published",
        "duration_seconds": None,
    }
    fields.update(over)
    async with tc["maker"]() as db:
        item = LibraryItem(**fields)
        db.add(item)
        await db.commit()
        return str(item.id)


# ---------------------------------------------------------------------------
# تجزیه‌گر URL یوتیوب
# ---------------------------------------------------------------------------


def test_youtube_parser_accepts_all_forms():
    from app.modules.videos.youtube import parse_youtube_video_id

    accepted = [
        f"https://www.youtube.com/watch?v={VIDEO_ID}",
        f"https://youtube.com/watch?v={VIDEO_ID}",
        f"https://m.youtube.com/watch?v={VIDEO_ID}",
        f"https://www.youtube.com/watch?v={VIDEO_ID}&t=42s&list=PLx",
        f"https://youtu.be/{VIDEO_ID}",
        f"https://youtu.be/{VIDEO_ID}?si=abc123",
        f"https://www.youtube.com/shorts/{VIDEO_ID}",
        f"https://www.youtube.com/live/{VIDEO_ID}",
        f"https://www.youtube.com/embed/{VIDEO_ID}",
        f"http://www.youtube.com/watch?v={VIDEO_ID}",
    ]
    for url in accepted:
        assert parse_youtube_video_id(url) == VIDEO_ID, url


def test_youtube_parser_rejects_non_youtube_and_bad_ids():
    from app.modules.videos.youtube import parse_youtube_video_id

    rejected = [
        None,
        "",
        "not a url",
        "https://vimeo.com/12345678901",
        "https://www.youtube.com/watch?v=short",
        f"https://www.youtube.com/watch?v={VIDEO_ID}extra",
        "https://www.youtube.com/watch",
        "https://www.youtube.com/feed/subscriptions",
        f"https://evil-youtube.com/watch?v={VIDEO_ID}",
        f"https://www.youtube.com.evil.com/watch?v={VIDEO_ID}",
        f"ftp://youtu.be/{VIDEO_ID}",
        f"https://youtu.be/{VIDEO_ID}/extra",
    ]
    for url in rejected:
        assert parse_youtube_video_id(url) is None, url


def test_youtube_derived_urls():
    from app.modules.videos.youtube import (
        canonical_watch_url,
        embed_url,
        thumbnail_url,
    )

    assert canonical_watch_url(VIDEO_ID) == WATCH_URL
    assert embed_url(VIDEO_ID) == EMBED_URL
    assert thumbnail_url(VIDEO_ID) == THUMB_URL


# ---------------------------------------------------------------------------
# ساخت با لینک (بدون فایل)
# ---------------------------------------------------------------------------


async def test_create_external_video_without_file(tc):
    from app.models.models import LibraryItem

    client = tc["client"]
    admin = await _admin(tc)
    r = await _create_link(
        client, admin, _meta("video", external_url=f"https://youtu.be/{VIDEO_ID}")
    )
    assert r.status_code == 201, r.text
    body = r.json()
    # URL کانونیک ذخیره/برگردانده می‌شود، نه فرم کوتاه youtu.be
    assert body["external_url"] == WATCH_URL
    assert body["media_url"] is None
    assert body["file_size_bytes"] is None
    async with tc["maker"]() as db:
        item = await db.get(LibraryItem, uuid.UUID(body["id"]))
        assert item is not None
        assert item.media_key is None
        assert item.external_url == WATCH_URL


async def test_create_external_rejected_for_non_video_kind(tc):
    client = tc["client"]
    admin = await _admin(tc)
    r = await _create_link(
        client, admin, _meta("pdf", external_url=WATCH_URL)
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "external_url_not_allowed"


async def test_create_external_invalid_url_422(tc):
    client = tc["client"]
    admin = await _admin(tc)
    r = await _create_link(
        client, admin, _meta("video", external_url="https://vimeo.com/12345")
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "invalid_youtube_url"


async def test_create_without_file_or_link_422(tc):
    client = tc["client"]
    admin = await _admin(tc)
    r = await _create_link(client, admin, _meta("video"))
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "file_required"


# ---------------------------------------------------------------------------
# عنوان خودکار از oEmbed
# ---------------------------------------------------------------------------


async def test_create_external_title_from_oembed(tc, monkeypatch):
    from app.modules.videos import youtube

    async def fake_fetch(url: str):
        assert url == WATCH_URL
        return "سخنرانی تست یوتیوب"

    monkeypatch.setattr(youtube, "fetch_youtube_title", fake_fetch)
    client = tc["client"]
    admin = await _admin(tc)
    meta = _meta("video", external_url=WATCH_URL)
    del meta["title"]
    r = await _create_link(client, admin, meta)
    assert r.status_code == 201, r.text
    # عنوان oEmbed عیناً در هر سه زبان می‌نشیند (الگوی تک‌متنی LocalizedText)
    assert r.json()["title"] == {
        "fa": "سخنرانی تست یوتیوب",
        "ar": "سخنرانی تست یوتیوب",
        "en": "سخنرانی تست یوتیوب",
    }


async def test_create_external_oembed_failure_requires_title(tc, monkeypatch):
    from app.modules.videos import youtube

    async def fake_fetch(url: str):
        return None

    monkeypatch.setattr(youtube, "fetch_youtube_title", fake_fetch)
    client = tc["client"]
    admin = await _admin(tc)
    meta = _meta("video", external_url=WATCH_URL)
    del meta["title"]
    r = await _create_link(client, admin, meta)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "title_required"


async def test_create_external_with_title_skips_oembed(tc, monkeypatch):
    from app.modules.videos import youtube

    async def forbidden_fetch(url: str):
        raise AssertionError("oEmbed نباید با عنوان دستی صدا زده شود")

    monkeypatch.setattr(youtube, "fetch_youtube_title", forbidden_fetch)
    client = tc["client"]
    admin = await _admin(tc)
    r = await _create_link(client, admin, _meta("video", external_url=WATCH_URL))
    assert r.status_code == 201, r.text
    assert r.json()["title"] == _L("آیتم تست video")


# ---------------------------------------------------------------------------
# قاعدهٔ «فایل برنده است»
# ---------------------------------------------------------------------------


async def test_uploading_file_clears_external_url(tc):
    client = tc["client"]
    admin = await _admin(tc)
    r = await _create_link(client, admin, _meta("video", external_url=WATCH_URL))
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]

    r = await client.put(
        f"{BASE}/admin/library/items/{item_id}",
        data={"metadata": json.dumps({})},
        files={"file": ("lecture.mp4", MP4_BYTES, "video/mp4")},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["external_url"] is None
    assert body["media_url"] is not None


async def test_set_external_url_on_item_with_file_rejected(tc):
    client = tc["client"]
    admin = await _admin(tc)
    # ساخت با فایل واقعی
    r = await client.post(
        f"{BASE}/admin/library/items",
        data={"metadata": json.dumps(_meta("video"))},
        files={"file": ("lecture.mp4", MP4_BYTES, "video/mp4")},
        headers=admin,
    )
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]

    r = await client.put(
        f"{BASE}/admin/library/items/{item_id}",
        data={"metadata": json.dumps({"external_url": WATCH_URL})},
        headers=admin,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "external_url_not_allowed"


# ---------------------------------------------------------------------------
# payloadهای بخش ویدیوها + پیشرفت پخش
# ---------------------------------------------------------------------------


async def test_external_watch_and_list_payloads(tc):
    client = tc["client"]
    item_id = await _make_external_item(tc)

    r = await client.get(f"{BASE}/videos")
    assert r.status_code == 200, r.text
    found = [i for i in r.json()["items"] if i["id"] == item_id]
    assert len(found) == 1
    entry = found[0]
    assert entry["external_url"] == WATCH_URL
    assert entry["embed_url"] == EMBED_URL
    # کاور خودی ندارد → بندانگشتی یوتیوب
    assert entry["cover_url"] == THUMB_URL

    r = await client.get(f"{BASE}/videos/{item_id}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stream_url"] is None
    assert body["item"]["external_url"] == WATCH_URL
    assert body["item"]["embed_url"] == EMBED_URL
    assert body["item"]["cover_url"] == THUMB_URL


async def test_external_progress_put_422_get_nulls(tc):
    client = tc["client"]
    headers = await _make_user(tc)
    item_id = await _make_external_item(tc)
    url = f"{BASE}/videos/{item_id}/progress"

    r = await client.put(url, json={"position_seconds": 30}, headers=headers)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "external_video"

    r = await client.get(url, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["position_seconds"] is None
    assert body["duration_seconds"] is None
    assert body["updated_at"] is None


# ---------------------------------------------------------------------------
# لینک مستقیم فایل ویدیو (پخش با پلیر بومی سایت)
# ---------------------------------------------------------------------------

FILE_URL = "https://cdn.example.com/media/lecture-1.mp4"
FILE_URL_WEBM = "https://cdn.example.com/media/Lecture-2.WEBM?dl=1"


async def test_create_direct_file_video_without_upload(tc):
    from app.models.models import LibraryItem

    client = tc["client"]
    admin = await _admin(tc)
    r = await _create_link(client, admin, _meta("video", external_url=FILE_URL))
    assert r.status_code == 201, r.text
    body = r.json()
    # لینک فایل عیناً ذخیره می‌شود (برخلاف یوتیوب، کانونیک‌سازی ندارد)
    assert body["external_url"] == FILE_URL
    assert body["media_url"] is None
    assert body["file_size_bytes"] is None
    async with tc["maker"]() as db:
        item = await db.get(LibraryItem, uuid.UUID(body["id"]))
        assert item is not None
        assert item.media_key is None
        assert item.external_url == FILE_URL


async def test_create_direct_file_url_variants(tc):
    client = tc["client"]
    admin = await _admin(tc)
    # پسوند بزرگ + کوئری‌استرینگ: پسوند از روی path خوانده می‌شود و URL
    # با همان کوئری ذخیره می‌شود؛ فاصله‌های دو سر هم بریده می‌شوند
    r = await _create_link(
        client, admin, _meta("video", external_url=f"  {FILE_URL_WEBM}  ")
    )
    assert r.status_code == 201, r.text
    assert r.json()["external_url"] == FILE_URL_WEBM


async def test_create_direct_file_without_title_422_no_oembed(tc, monkeypatch):
    from app.modules.videos import youtube

    async def forbidden_fetch(url: str):
        raise AssertionError("oEmbed برای لینک فایل نباید صدا زده شود")

    monkeypatch.setattr(youtube, "fetch_youtube_title", forbidden_fetch)
    client = tc["client"]
    admin = await _admin(tc)
    meta = _meta("video", external_url=FILE_URL)
    del meta["title"]
    r = await _create_link(client, admin, meta)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "title_required"


async def test_create_non_file_non_youtube_url_422(tc):
    client = tc["client"]
    admin = await _admin(tc)
    for bad in (
        "https://example.com/watch",
        "https://example.com/video.avi",
        "http://cdn.example.com/media/lecture-1.mp4",  # فقط https
        "https://example.com/video.mp4/",  # پسوند در انتهای path نیست
    ):
        r = await _create_link(client, admin, _meta("video", external_url=bad))
        assert r.status_code == 422, (bad, r.text)
        assert r.json()["error"]["code"] == "invalid_youtube_url"


async def test_create_direct_file_rejected_for_non_video_kind(tc):
    client = tc["client"]
    admin = await _admin(tc)
    r = await _create_link(client, admin, _meta("pdf", external_url=FILE_URL))
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "external_url_not_allowed"


async def test_update_external_url_to_direct_file(tc):
    client = tc["client"]
    admin = await _admin(tc)
    r = await _create_link(client, admin, _meta("video", external_url=WATCH_URL))
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]

    r = await client.put(
        f"{BASE}/admin/library/items/{item_id}",
        data={"metadata": json.dumps({"external_url": FILE_URL})},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.json()["external_url"] == FILE_URL


async def test_direct_file_watch_and_list_payloads(tc):
    client = tc["client"]
    item_id = await _make_external_item(tc, external_url=FILE_URL)

    r = await client.get(f"{BASE}/videos")
    assert r.status_code == 200, r.text
    found = [i for i in r.json()["items"] if i["id"] == item_id]
    assert len(found) == 1
    entry = found[0]
    assert entry["external_url"] == FILE_URL
    # نه امبد یوتیوب ساخته می‌شود، نه بندانگشتی از یوتیوب می‌آید
    assert entry["embed_url"] is None
    assert entry["cover_url"] is None

    r = await client.get(f"{BASE}/videos/{item_id}")
    assert r.status_code == 200, r.text
    body = r.json()
    # پخش با پلیر بومی: stream_url خودِ URL فایل است و زیرنویس ندارد
    assert body["stream_url"] == FILE_URL
    assert body["item"]["external_url"] == FILE_URL
    assert body["item"]["embed_url"] is None
    assert body["subtitles"] == []
