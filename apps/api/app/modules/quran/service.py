"""منطق کسب‌وکار فاز ۵ — قرآن / یادداشت آیه / تسبیح / اذان.

قرارداد §۱۵.۶: روتر هرگز مستقیم به دیتابیس دسترسی ندارد — همه‌چیز اینجاست.
متن قرآن فقط خوانده می‌شود (provider)؛ هیچ تابعی متن را تغییر نمی‌دهد.
"""
from __future__ import annotations

import base64
import json
import threading
import time
import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.events import emit_event
from app.core.platform_settings import get_typed_setting
from app.models.models import (
    DhikrDailyCount,
    DhikrSession,
    SyncTombstone,
    User,
    UserAyahNote,
)
from app.modules.sync.service import record_entity_change

from . import adhan as adhan_calc
from . import adhan_data
from . import geocode as geocode_mod
from . import jalali as jalali_mod
from . import providers as quran_providers
from .surahs import SURAHS, get_surah

# --- پیش‌فرض‌های تنظیمات قرآن (وقتی کلید seed نشده باشد) ---
_DEFAULTS: dict[str, object] = {
    "quran.provider": "alquran_cloud",
    "quran.translations": ["en.sahih", "fa.makarem"],
    "quran.tafsirs": ["ar.muyassar"],
    "quran.reciters": [
        "ar.alafasy",
        "ar.abdulbasitmurattal",
        "ar.abdullahbasfar",
        "ar.abdurrahmaansudais",
        "ar.abdulsamad",
        "ar.shaatree",
        "ar.ahmedajamy",
        "ar.hanirifai",
        "ar.husary",
        "ar.husarymujawwad",
        "ar.hudhaify",
        "ar.ibrahimakhbar",
        "ar.mahermuaiqly",
        "ar.minshawi",
        "ar.minshawimujawwad",
        "ar.muhammadayyoub",
        "ar.muhammadjibreel",
        "ar.saoodshuraym",
        "en.walk",
        "fa.hedayatfarfooladvand",
        "ar.parhizgar",
        "ur.khan",
        "zh.chinese",
        "fr.leclerc",
        "ar.aymanswoaid",
        "ru.kuliev-audio",
        "ru.kuliev-audio-2",
        "kk.khalifahaltai-audio",
        "ar.alafasy-2",
        "ar.husary-2",
        "ar.mahermuaiqly-2",
        "ar.hudhaify-2",
        "ar.husarymujawwad-2",
        "ar.minshawi-2",
        "ar.muhammadayyoub-2",
        "ar.muhammadjibreel-2",
        "tr.vakfi-audio",
        "uz.sodik-audio",
    ],
    "quran.reciter_photos": {
        "ar.alafasy": "https://upload.wikimedia.org/wikipedia/commons/2/24/Мишари_Рашид.jpg",
        "ar.alafasy-2": "https://upload.wikimedia.org/wikipedia/commons/2/24/Мишари_Рашид.jpg",
        "ar.abdulbasitmurattal": "https://upload.wikimedia.org/wikipedia/commons/b/b9/Abdul_Basit_Abd_us-Samad_in_South_Africa_in_1966_%283%29_%28cropped%29.jpg",
        "ar.abdulsamad": "https://upload.wikimedia.org/wikipedia/commons/b/b9/Abdul_Basit_Abd_us-Samad_in_South_Africa_in_1966_%283%29_%28cropped%29.jpg",
        "ar.abdurrahmaansudais": "https://upload.wikimedia.org/wikipedia/commons/1/18/Abdul-Rahman_Al-Sudais_%28Cropped%2C_2011%29.jpg",
        "ar.saoodshuraym": "https://upload.wikimedia.org/wikipedia/commons/1/1e/The_IMAM_of_Holy_Mosque_in_Makka_Al_Mukarramah%2C_Saudi_Arabia%2C_Sheikh_Dr._Saud_Bin_Ibrahem_Al_Shuraim_meeting_the_Vice_President%2C_Shri_Mohd._Hamid_Ansari%2C_in_New_Delhi_on_March_03%2C_2012_%28cropped%29.jpg",
        "ar.husary": "https://upload.wikimedia.org/wikipedia/commons/7/70/Hussary.jpg",
        "ar.husarymujawwad": "https://upload.wikimedia.org/wikipedia/commons/7/70/Hussary.jpg",
        "ar.husary-2": "https://upload.wikimedia.org/wikipedia/commons/7/70/Hussary.jpg",
        "ar.husarymujawwad-2": "https://upload.wikimedia.org/wikipedia/commons/7/70/Hussary.jpg",
        "ar.hudhaify": "https://upload.wikimedia.org/wikipedia/commons/d/d7/Huthaify.jpg",
        "ar.hudhaify-2": "https://upload.wikimedia.org/wikipedia/commons/d/d7/Huthaify.jpg",
        "ar.mahermuaiqly": "https://upload.wikimedia.org/wikipedia/commons/b/b8/Maher_Al_Mueaqly.jpg",
        "ar.mahermuaiqly-2": "https://upload.wikimedia.org/wikipedia/commons/b/b8/Maher_Al_Mueaqly.jpg",
        "ar.minshawi": "https://upload.wikimedia.org/wikipedia/commons/e/ee/Elminshwey.jpg",
        "ar.minshawimujawwad": "https://upload.wikimedia.org/wikipedia/commons/e/ee/Elminshwey.jpg",
        "ar.minshawi-2": "https://upload.wikimedia.org/wikipedia/commons/e/ee/Elminshwey.jpg",
        "ar.abdullahbasfar": "https://recitid.ai/reciters/abdullah-basfar.jpg",
        "ar.shaatree": "https://www.assabile.com/media/videos/47-320.webp",
        "ar.ahmedajamy": "https://static.myastro.com/400w/myastro/files_media/celebrities/AhmadbinAliAlAjmi/AhmadbinAliAlAjmi.jpg",
        "ar.hanirifai": "https://cdn-images-3.listennotes.com/podcasts/hani-ar-rifai-muslim-central-RPKe5QOxnc--pAlnGti5T2g.300x300.jpg",
        "ar.ibrahimakhbar": "https://cdn-images-3.listennotes.com/podcasts/ibrahim-al-akhdar-muslim-central-cqUQNkYgP8H-Hfv78KD3-ZL.300x300.jpg",
        "ur.khan": "https://marghdeen.com/wp-content/uploads/2020/09/shamshad2.jpg",
        "kk.khalifahaltai-audio": "https://e-history.kz/media/upload/4624/2015/08/18/a5d2da17cc4f34c8cbcc6ba719658978.jpg",
        "uz.sodik-audio": "https://upload.wikimedia.org/wikipedia/commons/d/db/Shayx_2014.png",
    },
    "quran.active_languages": ["fa", "ar", "en"],
    "quran.show_translation": True,
    "quran.show_tafsir": True,
    "quran.highlight_mode": "ayah",
    "quran.font_size": 20,
    "quran.playback": {"autoplay": False, "repeat": "off"},
    "quran.madhhab_default": "hanafi",
    "quran.player_default_speed": 1,
    "quran.player_show_photo": True,
    "quran.waveform_style": "bars",
    # --- فاز ۲ قرآن: رجیستری provider (ترکیب بر اساس نوع) ---
    "quran.providers_by_type": {
        "audio": "alquran_cloud",
        "text": "self_hosted",
        "translation": "alquran_cloud",
        "tafsir": "alquran_cloud",
    },
    "quran.custom_providers": [],
    "quran.custom_provider_keys": {},
    "quran.qf_base_url": "https://api.quran.com/api/v4",
    "quran.qf_client_id": "",
    "quran.qf_client_secret": "",
    # --- فاز ۳ قرآن: حفاظ ---
    "quran.asr_engine": "zipformer",
    "quran.hifz_thresholds": {"green": 0.8, "amber": 0.5},
    "munajat.enabled": True,
    "munajat.window": {"start": "02:00", "end": "05:00"},
    "adhan.defaults": {"calculation_method": "council", "madhab": "hanafi"},
}

_NOTES_CURSOR_LIMIT = 50


def _utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat()


async def _quran_setting(db: AsyncSession, key: str):
    return await get_typed_setting(db, key, _DEFAULTS[key])


def _provider_error_to_api(exc: quran_providers.QuranProviderError) -> APIError:
    """خرابی provider → پاکت یکدست ۵۰۳ (§۱)؛ هرگز ۵۰۰ با traceback."""
    return APIError(
        503,
        "quran_provider_unavailable",
        "سرویس متن قرآن در دسترس نیست؛ لطفاً کمی بعد تلاش کنید",
        {"provider": exc.provider_id},
    )


# ---------------------------------------------------------------------------
# قرآن: فهرست سوره‌ها / بستهٔ سوره / بستهٔ آیه
# ---------------------------------------------------------------------------


def list_surahs() -> list[dict]:
    return [
        {
            "number": s.number,
            "name_ar": s.name_ar,
            "name_en": s.name_en,
            "ayahs": s.ayahs,
            "revelation": s.revelation,
        }
        for s in SURAHS
    ]


def _clean_custom_list(raw: object) -> list[dict]:
    """providerهای سفارشی ذخیره‌شده — ورودی ناسازگار → فهرست تهی، نه خطا
    (اعتبارسنجی سخت در زمان ذخیره انجام می‌شود؛ خواندن هرگز نباید ۵۰۰ بدهد)."""
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for item in raw:
        try:
            out.append(quran_providers.validate_custom_provider_entry(item))
        except ValueError:
            continue
    return out


def _clean_keys_map(raw: object) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {
        k: v for k, v in raw.items()
        if isinstance(k, str) and isinstance(v, str) and v.strip()
    }


async def _resolve_providers_by_type(db: AsyncSession) -> dict[str, str]:
    """انتخاب بر اساس نوع: پیش‌فرض‌ها + روی‌هم‌گذاری مقدار ذخیره‌شده.
    کلید قدیمی quran.provider فقط سازگاری عقب‌رو دارد (مقدارش همیشه
    alquran_cloud است) و دیگر در resolve نقشی ندارد."""
    resolved = dict(quran_providers.DEFAULT_PROVIDERS_BY_TYPE)
    stored = await _quran_setting(db, "quran.providers_by_type")
    if isinstance(stored, dict):
        for key, pid in stored.items():
            if key in resolved and isinstance(pid, str) and pid.strip():
                resolved[key] = pid.strip()
    return resolved


async def _edition_selection(db: AsyncSession, reciter: str | None = None) -> dict:
    providers_by_type = await _resolve_providers_by_type(db)
    translations = await _quran_setting(db, "quran.translations") or []
    tafsirs = await _quran_setting(db, "quran.tafsirs") or []
    reciters = await _quran_setting(db, "quran.reciters") or []
    # reciter override فقط از میان قاری‌های فعال (CRM) پذیرفته می‌شود
    reciter_edition = reciters[0] if reciters else None
    if reciter and reciter in reciters:
        reciter_edition = reciter
    custom = _clean_custom_list(await _quran_setting(db, "quran.custom_providers"))
    keys = _clean_keys_map(await _quran_setting(db, "quran.custom_provider_keys"))
    return {
        "provider_id": providers_by_type["text"],
        "providers_by_type": providers_by_type,
        "provider_map": quran_providers.build_provider_map(custom, keys),
        "text_edition": "quran-uthmani",
        "translation_edition": translations[0] if translations else None,
        "tafsir_edition": tafsirs[0] if tafsirs else None,
        "reciter_edition": reciter_edition,
    }


def _group_editions_by_provider(
    sel: dict, *, translation: str | None, tafsir: str | None,
) -> list[tuple[str, dict]]:
    """بخش‌های درخواستی، گروه‌بندی‌شده بر اساس provider — وقتی همهٔ بخش‌ها
    یک provider دارند فقط یک گروه برمی‌گردد. با پیش‌فرض‌های فاز ۲
    (متن از self_hosted، بقیه از alquran_cloud) معمولاً دو گروه است:
    یک خواندن محلی متن + یک round-trip ترکیبی AlQuran Cloud."""
    by_type = sel["providers_by_type"]
    groups: dict[str, dict] = {}

    def add(pid: str, **kwargs: object) -> None:
        groups.setdefault(pid, {}).update(kwargs)

    add(by_type["text"], text_edition=sel["text_edition"])
    tr = translation or sel["translation_edition"]
    if tr:
        add(by_type["translation"], translation_edition=tr)
    tf = tafsir or sel["tafsir_edition"]
    if tf:
        add(by_type["tafsir"], tafsir_edition=tf)
    if sel["reciter_edition"]:
        add(by_type["audio"], reciter_edition=sel["reciter_edition"])
    return list(groups.items())


def _resolve_group_provider(
    sel: dict, provider_id: str,
) -> quran_providers.QuranProvider:
    provider = sel["provider_map"].get(provider_id)
    if provider is None:
        raise quran_providers.QuranProviderError(
            f"unknown quran provider: {provider_id}", provider_id=provider_id
        )
    return provider


def _ayah_out(surah: int, number_in_surah: int, editions: dict) -> dict:
    return {
        "surah": surah,
        "ayah": number_in_surah,
        "editions": [
            {
                "edition": eid,
                "text": etext.text,
                "audio_url": etext.audio_url,
                "juz": etext.juz,
                "page": etext.page,
            }
            for eid, etext in editions.items()
        ],
    }


async def get_surah_bundle(
    db: AsyncSession,
    number: int,
    *,
    translation: str | None = None,
    tafsir: str | None = None,
    reciter: str | None = None,
) -> dict:
    try:
        meta = get_surah(number)
    except ValueError:
        raise APIError(404, "surah_not_found", "سوره‌ای با این شماره وجود ندارد")
    sel = await _edition_selection(db, reciter=reciter)
    try:
        merged_ayahs: dict[int, dict] = {}
        edition_ids: list[str] = []
        for pid, kwargs in _group_editions_by_provider(
            sel, translation=translation, tafsir=tafsir,
        ):
            provider = _resolve_group_provider(sel, pid)
            data = await provider.fetch_surah(number, **kwargs)
            edition_ids.extend(data["edition_ids"])
            for item in data["ayahs"]:
                slot = merged_ayahs.setdefault(item["number_in_surah"], {})
                for eid, etext in item["editions"].items():
                    slot.setdefault(eid, etext)
    except quran_providers.QuranProviderError as exc:
        raise _provider_error_to_api(exc)
    ayahs = [
        _ayah_out(number, n, merged_ayahs[n]) for n in sorted(merged_ayahs)
    ]
    return {
        "surah": number,
        "name_ar": meta.name_ar,
        "name_en": meta.name_en,
        "ayahs": ayahs,
        "edition_ids": edition_ids,
    }


async def get_ayah_bundle(
    db: AsyncSession,
    surah: int,
    ayah: int,
    *,
    translation: str | None = None,
    tafsir: str | None = None,
    reciter: str | None = None,
) -> dict:
    try:
        meta = get_surah(surah)
    except ValueError:
        raise APIError(404, "surah_not_found", "سوره‌ای با این شماره وجود ندارد")
    if not 1 <= ayah <= meta.ayahs:
        raise APIError(404, "ayah_not_found", "آیه‌ای با این شماره در این سوره وجود ندارد")
    sel = await _edition_selection(db, reciter=reciter)
    try:
        merged_editions: dict = {}
        for pid, kwargs in _group_editions_by_provider(
            sel, translation=translation, tafsir=tafsir,
        ):
            provider = _resolve_group_provider(sel, pid)
            data = await provider.fetch_ayah(surah, ayah, **kwargs)
            for eid, etext in data["editions"].items():
                merged_editions.setdefault(eid, etext)
    except quran_providers.QuranProviderError as exc:
        raise _provider_error_to_api(exc)
    return _ayah_out(surah, ayah, merged_editions)


def _clean_photo_map(raw: object) -> dict[str, str]:
    """نگاشت شناسهٔ قاری → آدرس عکس؛ فقط جفت‌های رشته‌ای غیرتهی نگه داشته می‌شوند."""
    if not isinstance(raw, dict):
        return {}
    return {k: v for k, v in raw.items() if isinstance(k, str) and isinstance(v, str) and v.strip()}


async def get_providers_config(db: AsyncSession) -> dict:
    by_type = await _resolve_providers_by_type(db)
    custom = _clean_custom_list(await _quran_setting(db, "quran.custom_providers"))
    keys = _clean_keys_map(await _quran_setting(db, "quran.custom_provider_keys"))
    provider_map = quran_providers.build_provider_map(custom, keys)
    # providerهای قابل سرو: AlQuran Cloud + سفارشی‌ها. active یعنی برای
    # دست‌کم یک نوع انتخاب شده باشد (با انتخاب بر اساس نوع، دیگر یک
    # provider واحدِ «فعال» وجود ندارد).
    providers = []
    for pid, p in provider_map.items():
        if pid == "alquran_cloud":
            entry_types = ["audio", "text", "translation", "tafsir"]
        elif pid == "self_hosted":
            entry_types = ["text"]
        else:
            entry_types = [next(c["type"] for c in custom if c["id"] == pid)]
        providers.append(
            {
                "id": p.id,
                "name": p.name,
                "base_url": getattr(p, "base_url", ""),
                "active": pid in by_type.values(),
                "types": entry_types,
                "implemented": True,
            }
        )
    if by_type["text"] not in provider_map:
        raise APIError(
            503, "quran_provider_unavailable",
            "provider فعال قرآن شناخته‌شده نیست",
            {"provider": by_type["text"]},
        )
    catalog = quran_providers.catalog_entries()
    for entry in catalog:
        if entry["id"] == "quran_foundation":
            entry["base_url"] = await _quran_setting(db, "quran.qf_base_url")
    qf_secret = await _quran_setting(db, "quran.qf_client_secret")
    return {
        "providers": providers,
        "active_provider": by_type["text"],
        "providers_by_type": by_type,
        "custom_providers": custom,
        "provider_catalog": catalog,
        "qf_base_url": await _quran_setting(db, "quran.qf_base_url"),
        "qf_client_id": await _quran_setting(db, "quran.qf_client_id"),
        "qf_client_secret_set": isinstance(qf_secret, str) and bool(qf_secret.strip()),
        "custom_provider_keys_set": sorted(
            pid for pid in keys if any(c["id"] == pid for c in custom)
        ),
        "text_edition": "quran-uthmani",
        "translations": await _quran_setting(db, "quran.translations"),
        "tafsirs": await _quran_setting(db, "quran.tafsirs"),
        "reciters": await _quran_setting(db, "quran.reciters"),
        "reciter_photos": _clean_photo_map(await _quran_setting(db, "quran.reciter_photos")),
        "active_languages": await _quran_setting(db, "quran.active_languages"),
        "show_translation": await _quran_setting(db, "quran.show_translation"),
        "show_tafsir": await _quran_setting(db, "quran.show_tafsir"),
        "highlight_mode": await _quran_setting(db, "quran.highlight_mode"),
        "font_size": await _quran_setting(db, "quran.font_size"),
        "playback": await _quran_setting(db, "quran.playback"),
    }


async def set_custom_provider_key(
    db: AsyncSession, provider_id: str, key: str | None,
) -> dict:
    """تنظیم یا پاک‌کردن کلید یک provider سفارشی — تنها راه امن ویرایش
    کلیدها بدون بازنویسی کل نگاشت (مقادیر حساس از CRM هرگز خوانده نمی‌شوند).
    مقدار کلید هرگز در پاسخ یا لاگ برنمی‌گردد؛ فقط key_set."""
    from app.core.platform_settings import (
        bump_settings_version,
        encode_setting_value,
        stage_setting,
    )

    custom = _clean_custom_list(await _quran_setting(db, "quran.custom_providers"))
    if not any(c["id"] == provider_id for c in custom):
        raise APIError(
            404, "custom_provider_not_found",
            "provider سفارشی با این شناسه ثبت نشده است",
        )
    if key is not None and (not isinstance(key, str) or len(key) > 500):
        raise APIError(
            400, "invalid_setting_value",
            "custom provider key must be a string (max 500 chars) or null",
        )
    keys = _clean_keys_map(await _quran_setting(db, "quran.custom_provider_keys"))
    if key and key.strip():
        keys[provider_id] = key
    else:
        keys.pop(provider_id, None)
    await stage_setting(
        db,
        "quran.custom_provider_keys",
        encode_setting_value("json", keys, "quran.custom_provider_keys"),
    )
    await db.commit()
    # باطل‌سازی کش تنظیمات — وگرنه خواندن بعدی همان نگاشت قدیمی را می‌دهد
    bump_settings_version(["quran.custom_provider_keys"])
    return {"provider_id": provider_id, "key_set": provider_id in keys}


# ---------------------------------------------------------------------------
# یادداشت‌های آیه — حریم خصوصی: همهٔ کوئری‌ها owner-scoped
# ---------------------------------------------------------------------------


def _encode_cursor(created_at: datetime, nid: uuid.UUID) -> str:
    raw = json.dumps({"t": _utc_iso(created_at), "id": str(nid)})
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return datetime.fromisoformat(raw["t"]), uuid.UUID(raw["id"])
    except Exception:
        raise APIError(400, "invalid_cursor", "کرسر صفحه‌بندی نامعتبر است")


def _note_out(note: UserAyahNote) -> dict:
    return {
        "id": note.id,
        "surah": note.surah,
        "ayah": note.ayah,
        "note_text": note.note_text,
        "is_private": note.is_private,
        "created_at": _utc_iso(note.created_at),
    }


async def create_note(
    db: AsyncSession, user: User, *, surah: int, ayah: int,
    note_text: str, is_private: bool,
) -> dict:
    meta = get_surah(surah)  # اعتبارسنجی شمارهٔ سوره؛ آیه در روتر/سرویس چک می‌شود
    if not 1 <= ayah <= meta.ayahs:
        raise APIError(404, "ayah_not_found", "آیه‌ای با این شماره در این سوره وجود ندارد")
    note = UserAyahNote(
        user_id=user.id, surah=surah, ayah=ayah,
        note_text=note_text.strip(), is_private=is_private,
    )
    db.add(note)
    await db.flush()
    await emit_event(
        db,
        aggregate_type="quran_note",
        aggregate_id=str(note.id),
        event_type="quran.note_created",
        payload={
            "user_id": str(user.id), "surah": surah, "ayah": ayah,
            "is_private": is_private,
        },
        source_client="api",
    )
    # فاز ۱۳: ثبت در ژورنال sync تا pull دستگاه‌ها کامل بماند
    await record_entity_change(
        db, user_id=user.id, device_id="api",
        entity_type="user_ayah_note", entity_id=str(note.id),
        op_type="upsert",
        payload={"id": str(note.id), "surah": surah, "ayah": ayah,
                 "note_text": note.note_text, "is_private": is_private,
                 "version": note.version or 1},
        version=note.version or 1,
    )
    await db.commit()
    await db.refresh(note)
    return _note_out(note)


async def list_notes(
    db: AsyncSession, user: User, *, surah: int | None, ayah: int | None,
    cursor: str | None, limit: int,
) -> tuple[list[dict], str | None]:
    """فقط یادداشت‌های خودِ کاربر — هیچ‌وقت یادداشت دیگران (حریم خصوصی)."""
    limit = min(max(limit, 1), _NOTES_CURSOR_LIMIT)
    stmt = (
        select(UserAyahNote)
        .where(UserAyahNote.user_id == user.id)
        .order_by(UserAyahNote.created_at.desc(), UserAyahNote.id.desc())
    )
    if surah is not None:
        stmt = stmt.where(UserAyahNote.surah == surah)
    if ayah is not None:
        stmt = stmt.where(UserAyahNote.ayah == ayah)
    if cursor:
        ts, nid = _decode_cursor(cursor)
        stmt = stmt.where(
            (UserAyahNote.created_at < ts)
            | ((UserAyahNote.created_at == ts) & (UserAyahNote.id < nid))
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return [_note_out(r) for r in rows], next_cursor


async def _get_owned_note(db: AsyncSession, user: User, note_id: uuid.UUID) -> UserAyahNote:
    note = await db.get(UserAyahNote, note_id)
    # عمداً ۴۰۴ برای یادداشت دیگری (عدم افشای وجود/عدم وجود — حریم خصوصی)
    if note is None or note.user_id != user.id:
        raise APIError(404, "note_not_found", "یادداشتی با این شناسه یافت نشد")
    return note


async def update_note(
    db: AsyncSession, user: User, note_id: uuid.UUID, *,
    note_text: str | None, is_private: bool | None,
) -> dict:
    note = await _get_owned_note(db, user, note_id)
    if note_text is not None:
        note.note_text = note_text.strip()
    if is_private is not None:
        note.is_private = is_private
    # فاز ۱۳: نسخهٔ خوش‌بینانه + ژورنال sync
    note.version = (note.version or 1) + 1
    note.updated_at = datetime.now(UTC)
    await db.flush()
    await record_entity_change(
        db, user_id=user.id, device_id="api",
        entity_type="user_ayah_note", entity_id=str(note.id),
        op_type="upsert",
        payload={"id": str(note.id), "surah": note.surah, "ayah": note.ayah,
                 "note_text": note.note_text, "is_private": note.is_private,
                 "version": note.version},
        version=note.version,
    )
    await db.commit()
    await db.refresh(note)
    return _note_out(note)


async def delete_note(db: AsyncSession, user: User, note_id: uuid.UUID) -> None:
    note = await _get_owned_note(db, user, note_id)
    note_id_s = str(note.id)
    note_version = note.version or 1
    await db.delete(note)
    await db.flush()
    # فاز ۱۳: حذف مستقیم هم tombstone می‌خواهد تا بین دستگاه‌ها همگام شود
    now = datetime.now(UTC)
    existing_ts = (
        await db.execute(
            select(SyncTombstone).where(
                SyncTombstone.user_id == user.id,
                SyncTombstone.entity_type == "user_ayah_note",
                SyncTombstone.entity_id == note_id_s,
            )
        )
    ).scalar_one_or_none()
    if existing_ts is None:
        db.add(SyncTombstone(
            user_id=user.id, entity_type="user_ayah_note", entity_id=note_id_s,
            deleted_by=user.id, deleted_at=now, version=note_version,
        ))
    else:
        existing_ts.version = max(existing_ts.version or 0, note_version)
        existing_ts.deleted_at = now
        existing_ts.deleted_by = user.id
    await db.flush()
    await record_entity_change(
        db, user_id=user.id, device_id="api",
        entity_type="user_ayah_note", entity_id=note_id_s,
        op_type="delete", payload=None, version=note_version,
    )
    await db.commit()


# ---------------------------------------------------------------------------
# تسبیح دیجیتال
# ---------------------------------------------------------------------------

# dedup درون‌فرایندی کلیدهای idempotency شمارش (کوتاه‌مدت؛ «idempotent-ish»)
_increment_keys: dict[str, float] = {}
_increment_keys_lock = threading.Lock()
_INCREMENT_KEY_TTL = 600.0


def _claim_increment_key(key: str) -> bool:
    """True = کلید تازه است (ثبت شد)؛ False = تکراری (قبلاً استفاده شده)."""
    now = time.monotonic()
    with _increment_keys_lock:
        for k, ts in list(_increment_keys.items()):
            if now - ts > _INCREMENT_KEY_TTL:
                del _increment_keys[k]
        if key in _increment_keys:
            return False
        _increment_keys[key] = now
        return True


def _session_out(session: DhikrSession) -> dict:
    completed = session.target_count is not None and session.count >= session.target_count
    return {
        "id": session.id,
        "dhikr_text": session.dhikr_text,
        "target_count": session.target_count,
        "count": session.count,
        "started_at": _utc_iso(session.started_at),
        "ended_at": _utc_iso(session.ended_at) if session.ended_at else None,
        "completed": completed,
    }


async def start_session(
    db: AsyncSession, user: User, *, dhikr_text: str, target_count: int | None,
) -> dict:
    session = DhikrSession(
        user_id=user.id, dhikr_text=dhikr_text.strip(), target_count=target_count,
    )
    db.add(session)
    await db.flush()
    await emit_event(
        db,
        aggregate_type="dhikr_session",
        aggregate_id=str(session.id),
        event_type="tasbih.session_started",
        payload={
            "user_id": str(user.id), "dhikr_text": session.dhikr_text,
            "target_count": target_count,
        },
        source_client="api",
    )
    await db.commit()
    await db.refresh(session)
    return _session_out(session)


async def _get_owned_session(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> DhikrSession:
    session = await db.get(DhikrSession, session_id)
    if session is None or session.user_id != user.id:
        raise APIError(404, "session_not_found", "نشست تسبیحی با این شناسه یافت نشد")
    return session


async def _bump_daily(
    db: AsyncSession, user: User, dhikr_text: str, amount: int
) -> None:
    """upsert تجمیع روزانه — تاریخ UTC (§۱)."""
    today = datetime.now(UTC).date()
    stmt = select(DhikrDailyCount).where(
        DhikrDailyCount.user_id == user.id,
        DhikrDailyCount.date == today,
        DhikrDailyCount.dhikr_text == dhikr_text,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        row = DhikrDailyCount(
            user_id=user.id, date=today, dhikr_text=dhikr_text, total_count=0
        )
        db.add(row)
        await db.flush()
    row.total_count = (row.total_count or 0) + amount
    # فاز ۱۳: نسخهٔ خوش‌بینانه + ژورنال sync
    row.version = (row.version or 1) + 1
    row.updated_at = datetime.now(UTC)
    await db.flush()
    await record_entity_change(
        db, user_id=user.id, device_id="api",
        entity_type="dhikr_daily_count",
        entity_id=f"{today.isoformat()}:{dhikr_text}",
        op_type="upsert",
        payload={"date": today.isoformat(), "dhikr_text": dhikr_text,
                 "total_count": row.total_count, "version": row.version},
        version=row.version,
    )


async def increment_session(
    db: AsyncSession, user: User, session_id: uuid.UUID, *,
    amount: int, idempotency_key: str | None,
) -> dict:
    session = await _get_owned_session(db, user, session_id)
    if session.ended_at is not None:
        raise APIError(409, "session_ended", "این نشست تسبیح پایان یافته است")
    # کلید تکراری → بدون افزایش دوباره، همان وضعیت فعلی برمی‌گردد
    if idempotency_key and not _claim_increment_key(
        f"{user.id}:{session_id}:{idempotency_key}"
    ):
            await db.rollback()
            await db.refresh(session)
            return _session_out(session)
    session.count = (session.count or 0) + amount
    await _bump_daily(db, user, session.dhikr_text, amount)
    completed_now = (
        session.target_count is not None
        and session.count >= session.target_count
        and session.ended_at is None
    )
    if completed_now:
        session.ended_at = datetime.now(UTC)
        await emit_event(
            db,
            aggregate_type="dhikr_session",
            aggregate_id=str(session.id),
            event_type="tasbih.session_completed",
            payload={
                "user_id": str(user.id), "dhikr_text": session.dhikr_text,
                "count": session.count, "target_count": session.target_count,
            },
            source_client="api",
        )
    await db.commit()
    await db.refresh(session)
    return _session_out(session)


async def today_totals(db: AsyncSession, user: User) -> dict:
    today = datetime.now(UTC).date()
    rows = (
        await db.execute(
            select(DhikrDailyCount.dhikr_text, DhikrDailyCount.total_count)
            .where(
                DhikrDailyCount.user_id == user.id,
                DhikrDailyCount.date == today,
            )
            .order_by(DhikrDailyCount.total_count.desc())
        )
    ).all()
    return {
        "date": today,
        "totals": [
            {"dhikr_text": r[0], "total_count": r[1]} for r in rows
        ],
    }


# ---------------------------------------------------------------------------
# اذان
# ---------------------------------------------------------------------------


def _to_minutes(hhmm: str) -> int:
    hh, mm = hhmm.split(":")
    return int(hh) * 60 + int(mm)


def _fmt_minutes(total: int) -> str:
    total %= 24 * 60
    return f"{total // 60:02d}:{total % 60:02d}"


def _resolve_location(*, city: str | None, lat: float | None, lng: float | None):
    """شهر → مختصات مرکز شهر؛ بدون شهر، lat/lng صریح لازم است."""
    if city is not None:
        if city not in adhan_data.CITIES:
            raise APIError(400, "invalid_city", f"شهر ناشناخته: {city}")
        c = adhan_data.CITIES[city]
        return city, c["lat"], c["lng"]
    if lat is None or lng is None:
        raise APIError(400, "missing_location", "شهر یا مختصات (lat/lng) لازم است")
    return None, lat, lng


def _table_day_times(day: date, *, madhab: str, tz: float) -> dict | None:
    """یک روز از جدول تربت جام — فقط وقتی ردیف جدول وجود دارد.

    شش زمان اصلی از جدول می‌آید؛ امساک (فجر − ۱۰ دقیقه) و نیمه‌شب (میانگین
    مغرب و فجر فردا) مشتق‌شده‌اند. عصر شافعی در جدول نیست و همان روز با
    موتور نجومی محاسبه می‌شود (sources آن را computed نشان می‌دهد).
    برای ۱۲-۳۰ (که جدول ندارد) None برمی‌گردد تا مسیر محاسبه به کار رود.
    """
    from datetime import timedelta

    _, jm, jd = jalali_mod.to_jalali(day)
    row = adhan_data.torbat_row(f"{jm:02d}-{jd:02d}")
    if row is None:
        return None
    fajr, sunrise, dhuhr, asr_table, maghrib, isha = row
    city = adhan_data.CITIES[adhan_data.TORBAT_CITY]
    if madhab == "hanafi":
        asr, asr_source = asr_table, "table"
    else:
        comp = adhan_calc.prayer_times(
            day, city["lat"], city["lng"], tz=tz, method="council", madhab="shafi"
        )
        asr, asr_source = comp["asr"], "computed"
    next_j = jalali_mod.to_jalali(day + timedelta(days=1))
    next_row = adhan_data.torbat_row(f"{next_j[1]:02d}-{next_j[2]:02d}")
    next_fajr = _to_minutes(next_row[0]) if next_row else _to_minutes(fajr)
    maghrib_min = _to_minutes(maghrib)
    end = next_fajr + 24 * 60 if next_fajr < maghrib_min else next_fajr
    times = {
        "imsak": _fmt_minutes(_to_minutes(fajr) - 10),
        "fajr": fajr,
        "sunrise": sunrise,
        "dhuhr": dhuhr,
        "asr": asr,
        "maghrib": maghrib,
        "isha": isha,
        "midnight": _fmt_minutes((maghrib_min + end) // 2),
    }
    sources = {
        "fajr": "table",
        "sunrise": "table",
        "dhuhr": "table",
        "asr": asr_source,
        "maghrib": "table",
        "isha": "table",
        "imsak": "derived",
        "midnight": "derived",
    }
    source = "table" if asr_source == "table" else "mixed"
    return {"times": times, "sources": sources, "source": source}


def get_adhan_times(
    *, day: date, lat: float | None = None, lng: float | None = None,
    tz: float, method: str, madhab: str, city: str | None = None,
    ramadan: bool | None = None,
) -> dict:
    city_slug, lat_v, lng_v = _resolve_location(city=city, lat=lat, lng=lng)
    if not -90.0 <= lat_v <= 90.0:
        raise APIError(400, "invalid_latitude", "عرض جغرافیایی باید بین ‎−۹۰ و ۹۰ باشد")
    if not -180.0 <= lng_v <= 180.0:
        raise APIError(400, "invalid_longitude", "طول جغرافیایی باید بین ‎−۱۸۰ و ۱۸۰ باشد")
    if not -12.0 <= tz <= 14.0:
        raise APIError(400, "invalid_timezone", "افست زمانی باید بین ‎−۱۲ و ‎+۱۴ باشد")
    try:
        # جدول تربت جام: روش council + مختصات در شعاع ۳۵ کیلومتری مرکز شهر.
        # صفحه فیلد شهر ندارد و فقط lat/lng می‌فرستد، پس نزدیکی با فاصله
        # سنجیده می‌شود؛ پارامتر city (سازگاری عقب‌رو + پیش‌فرض نوار CRM)
        # از مسیر _resolve_location به همین مختصات می‌رسد.
        if method == adhan_data.TORBAT_TABLE_METHOD and adhan_data.near_torbat(lat_v, lng_v):
            tabled = _table_day_times(day, madhab=madhab, tz=tz)
            if tabled is not None:
                return {
                    "date": day,
                    "latitude": lat_v,
                    "longitude": lng_v,
                    "timezone_offset": tz,
                    "method": method,
                    "method_label": adhan_calc.METHODS[method]["label"],
                    "madhab": madhab,
                    "times": tabled["times"],
                    "city": city_slug,
                    "source": tabled["source"],
                    "sources": tabled["sources"],
                }
        times = adhan_calc.prayer_times(
            day, lat_v, lng_v, tz=tz, method=method, madhab=madhab, ramadan=ramadan
        )
    except ValueError as exc:
        raise APIError(400, "invalid_adhan_params", str(exc))
    return {
        "date": day,
        "latitude": lat_v,
        "longitude": lng_v,
        "timezone_offset": tz,
        "method": method,
        "method_label": adhan_calc.METHODS[method]["label"],
        "madhab": madhab,
        "times": times,
        "city": city_slug,
        "source": "computed",
        "sources": {k: "computed" for k in ("fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha")}
        | {"imsak": "derived", "midnight": "derived"},
    }


def get_adhan_range(
    *, start: date, end: date, lat: float | None = None, lng: float | None = None,
    tz: float, method: str, madhab: str, city: str | None = None,
    ramadan: bool | None = None,
) -> dict:
    """بازهٔ اوقات — حداکثر ۳۶۶ روز (یک سال جلالی کبیسه)."""
    from datetime import timedelta

    if end < start:
        raise APIError(400, "invalid_range", "تاریخ پایان باید پس از تاریخ شروع باشد")
    if (end - start).days > 365:
        raise APIError(422, "range_too_long", "بازه حداکثر ۳۶۶ روز است")
    city_slug, lat_v, lng_v = _resolve_location(city=city, lat=lat, lng=lng)
    days = []
    cur = start
    while cur <= end:
        one = get_adhan_times(
            day=cur, lat=lat_v, lng=lng_v, tz=tz, method=method, madhab=madhab,
            city=city_slug, ramadan=ramadan,
        )
        days.append({"date": cur, "source": one["source"], "times": one["times"]})
        cur += timedelta(days=1)
    return {
        "start": start,
        "end": end,
        "city": city_slug,
        "latitude": lat_v,
        "longitude": lng_v,
        "timezone_offset": tz,
        "method": method,
        "madhab": madhab,
        "days": days,
    }


def get_adhan_options() -> dict:
    return {
        "methods": adhan_data.method_options(),
        "cities": adhan_data.city_options(),
    }


def search_places(query: str) -> dict:
    """جست‌وجوی مکان (پروکسی Nominatim) — خطای بالادست → ۵۰۲، هرگز نتیجهٔ جعلی."""
    if not query or not query.strip():
        raise APIError(400, "invalid_query", "عبارت جست‌وجو خالی است")
    if len(query.strip()) > 200:
        raise APIError(400, "invalid_query", "عبارت جست‌وجو بیش از حد طولانی است")
    try:
        results = geocode_mod.search_places(query.strip())
    except geocode_mod.GeocodeUpstreamError as exc:
        raise APIError(502, "geocode_upstream_unavailable", f"سرویس جست‌وجوی مکان در دسترس نیست: {exc}")
    return {"results": results}


def reverse_place(lat: float, lng: float) -> dict:
    """نام مکان برای مختصات — نبودِ نام خطا نیست (name برابر None)."""
    if not -90.0 <= lat <= 90.0:
        raise APIError(400, "invalid_latitude", "عرض جغرافیایی باید بین ‎−۹۰ و ۹۰ باشد")
    if not -180.0 <= lng <= 180.0:
        raise APIError(400, "invalid_longitude", "طول جغرافیایی باید بین ‎−۱۸۰ و ۱۸۰ باشد")
    try:
        return geocode_mod.reverse_place(lat, lng)
    except geocode_mod.GeocodeUpstreamError as exc:
        raise APIError(502, "geocode_upstream_unavailable", f"سرویس جست‌وجوی مکان در دسترس نیست: {exc}")


# ---------------------------------------------------------------------------
# مناجات شبانه — وضعیت پنجرهٔ زمانی از تنظیمات
# ---------------------------------------------------------------------------


async def get_munajat_status(
    db: AsyncSession, *, tz_offset: float = 0.0,
    now_utc: datetime | None = None,
) -> dict:
    """آیا الان در پنجرهٔ مناجات هستیم؟

    پنجره (پیش‌فرض ۰۲:۰۰–۰۵:۰۰) به وقت محلی کاربر است؛ `tz_offset` افست ساعت
    محلی از UTC (مثلاً ‎+3.5) است و UI آن را از دستگاه می‌گیرد.
    """
    from datetime import timedelta

    enabled = await _quran_setting(db, "munajat.enabled")
    window = await _quran_setting(db, "munajat.window") or {}
    now_utc = now_utc or datetime.now(UTC)
    local = now_utc + timedelta(hours=tz_offset)
    in_window = False
    if enabled:
        try:
            sh, sm = (int(x) for x in str(window.get("start", "02:00")).split(":"))
            eh, em = (int(x) for x in str(window.get("end", "05:00")).split(":"))
            cur = local.hour * 60 + local.minute
            start = sh * 60 + sm
            end = eh * 60 + em
            in_window = (start <= cur < end) if start <= end else (cur >= start or cur < end)
        except (ValueError, AttributeError):
            in_window = False
    return {
        "enabled": bool(enabled),
        "window": {"start": window.get("start"), "end": window.get("end")},
        "in_window": in_window,
        "server_time_utc": now_utc.astimezone(UTC).isoformat(),
    }
