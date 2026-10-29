"""روتر فاز ۵ — قرآن / یادداشت آیه / تسبیح / اذان.

فقط سیم‌کشی؛ منطق در service.py (§۱۵.۶). خواندن یادداشت‌ها و تسبیح نیازمند
احراز هویت است؛ متن قرآن عمومی است.
"""
from __future__ import annotations

from datetime import UTC, date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import get_current_user

from . import service
from .schemas import (
    AdhanMethod,
    AdhanOptionsOut,
    AdhanRangeOut,
    AdhanTimesOut,
    AyahOut,
    DhikrTotalOut,
    GeocodePlaceOut,
    GeocodeSearchOut,
    Madhab,
    NoteIn,
    NoteListOut,
    NoteOut,
    NoteUpdate,
    ProviderInfo,
    QuranProvidersOut,
    SurahDetailOut,
    SurahListOut,
    SurahSummary,
    TasbihCountIn,
    TasbihSessionIn,
    TasbihSessionOut,
    TasbihTodayOut,
)

quran_router = APIRouter(prefix="/api/v1/quran", tags=["quran"])
tasbih_router = APIRouter(prefix="/api/v1/tasbih", tags=["tasbih"])
adhan_router = APIRouter(prefix="/api/v1/adhan", tags=["adhan"])


# --- قرآن ---


@quran_router.get("/surahs", response_model=SurahListOut)
async def list_surahs():
    """فهرست ۱۱۴ سوره — دادهٔ مرجع ثابت، بدون نیاز به provider."""
    items = [SurahSummary(**s) for s in service.list_surahs()]
    return SurahListOut(items=items, total=len(items))


@quran_router.get("/surah/{number}", response_model=SurahDetailOut)
async def get_surah(
    number: int,
    translation: str | None = Query(default=None, description="شناسهٔ edition ترجمه"),
    tafsir: str | None = Query(default=None, description="شناسهٔ edition تفسیر"),
    reciter: str | None = Query(default=None, description="شناسهٔ edition قاری (از قاری‌های فعال)"),
    db: AsyncSession = Depends(get_db),
):
    """متن سوره (عثمانی) + ترجمه + تفسیر + صوت هر آیه — از provider."""
    bundle = await service.get_surah_bundle(
        db, number, translation=translation, tafsir=tafsir, reciter=reciter
    )
    return SurahDetailOut(
        surah=bundle["surah"],
        name_ar=bundle["name_ar"],
        name_en=bundle["name_en"],
        ayahs=[AyahOut(**a) for a in bundle["ayahs"]],
        edition_ids=bundle["edition_ids"],
    )


@quran_router.get("/ayah/{surah}/{ayah}", response_model=AyahOut)
async def get_ayah(
    surah: int,
    ayah: int,
    translation: str | None = Query(default=None),
    tafsir: str | None = Query(default=None),
    reciter: str | None = Query(default=None, description="شناسهٔ edition قاری (از قاری‌های فعال)"),
    db: AsyncSession = Depends(get_db),
):
    """بستهٔ یک آیه: متن + ترجمه + تفسیر + صوت."""
    bundle = await service.get_ayah_bundle(
        db, surah, ayah, translation=translation, tafsir=tafsir, reciter=reciter
    )
    return AyahOut(**bundle)


@quran_router.get("/providers", response_model=QuranProvidersOut)
async def get_providers(db: AsyncSession = Depends(get_db)):
    """providerهای ثبت‌شده و editions فعال — driven by settings (CRM)."""
    cfg = await service.get_providers_config(db)
    return QuranProvidersOut(
        providers=[ProviderInfo(**p) for p in cfg["providers"]],
        **{k: v for k, v in cfg.items() if k != "providers"},
    )


@quran_router.get("/munajat/status")
async def munajat_status(
    tz: float = Query(default=0.0, ge=-12.0, le=14.0,
                      description="افست ساعت محلی از UTC (مثل ‎+3.5)"),
    db: AsyncSession = Depends(get_db),
):
    """وضعیت پنجرهٔ مناجات شبانه (پیش‌فرض ۰۲:۰۰–۰۵:۰۰ به وقت محلی)."""
    return await service.get_munajat_status(db, tz_offset=tz)


# --- یادداشت‌های آیه (auth) ---


@quran_router.post("/notes", response_model=NoteOut, status_code=201)
async def create_note(
    body: NoteIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """ثبت یادداشت روی آیه — فقط برای خودِ کاربر."""
    return NoteOut(
        **await service.create_note(
            db, user, surah=body.surah, ayah=body.ayah,
            note_text=body.note_text, is_private=body.is_private,
        )
    )


@quran_router.get("/notes", response_model=NoteListOut)
async def list_notes(
    surah: int | None = Query(default=None, ge=1, le=114),
    ayah: int | None = Query(default=None, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    after: str | None = Query(default=None, description="کرسر صفحه‌بندی"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """یادداشت‌های خودِ کاربر — صفحه‌بندی cursor-based؛ هرگز یادداشت دیگران."""
    items, next_cursor = await service.list_notes(
        db, user, surah=surah, ayah=ayah, cursor=after, limit=limit
    )
    return NoteListOut(
        items=[NoteOut(**n) for n in items], next_cursor=next_cursor
    )


@quran_router.put("/notes/{note_id}", response_model=NoteOut)
async def update_note(
    note_id: UUID,
    body: NoteUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """ویرایش یادداشت خودِ کاربر."""
    return NoteOut(
        **await service.update_note(
            db, user, note_id,
            note_text=body.note_text, is_private=body.is_private,
        )
    )


@quran_router.delete("/notes/{note_id}", status_code=204)
async def delete_note(
    note_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """حذف یادداشت خودِ کاربر."""
    await service.delete_note(db, user, note_id)


# --- تسبیح (auth) ---


@tasbih_router.post("/sessions", response_model=TasbihSessionOut, status_code=201)
async def start_session(
    body: TasbihSessionIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """شروع نشست تسبیح."""
    return TasbihSessionOut(**await service.start_session(
        db, user, dhikr_text=body.dhikr_text, target_count=body.target_count
    ))


@tasbih_router.post("/sessions/{session_id}/count", response_model=TasbihSessionOut)
async def count_dhikr(
    session_id: UUID,
    body: TasbihCountIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """افزایش شمارش — idempotent-ish با idempotency_key اختیاری."""
    return TasbihSessionOut(**await service.increment_session(
        db, user, session_id, amount=body.amount,
        idempotency_key=body.idempotency_key,
    ))


@tasbih_router.get("/today", response_model=TasbihTodayOut)
async def today_totals(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """تجمیع امروز (UTC) به‌تفکیک ذکر."""
    data = await service.today_totals(db, user)
    return TasbihTodayOut(
        date=data["date"],
        totals=[DhikrTotalOut(**t) for t in data["totals"]],
    )


# --- اذان ---


@adhan_router.get("/times", response_model=AdhanTimesOut)
async def adhan_times(
    lat: float | None = Query(default=None, ge=-90.0, le=90.0, description="عرض جغرافیایی"),
    lng: float | None = Query(default=None, ge=-180.0, le=180.0, description="طول جغرافیایی"),
    city: str | None = Query(default=None, description="نام شهر از GET /adhan/options؛ با شهر، lat/lng لازم نیست"),
    method: AdhanMethod = Query(default="council", description="council|tehran|isna|mwl|egypt|karachi|makkah|qom|jafari|france"),
    madhab: Madhab = Query(default="hanafi", description="shafi|hanafi (فقط عصر)"),
    day: date | None = Query(default=None, description="پیش‌فرض: امروز UTC"),
    date_: date | None = Query(default=None, alias="date", description="نام مستعار day"),
    tz: float = Query(default=0.0, ge=-12.0, le=14.0,
                      description="افست ساعت محلی از UTC (مثل ‎+3.5)؛ DST دستی"),
    ramadan: bool | None = Query(default=None, description="فقط ام‌القری: True یعنی عشاء ۱۲۰ دقیقه؛ None یعنی تشخیص خودکار"),
):
    """اوقات نماز — محاسبهٔ pure-Python (الگوریتم PrayTimes)؛ زمان‌ها HH:MM محلی.

    روش council + مختصاتِ نزدیکِ تربت جام از جدول رسمی ۳۶۵روزه می‌آید
    (source=table)؛ بقیهٔ ترکیب‌ها محاسبهٔ نجومی‌اند.
    """
    from datetime import datetime

    target = day or date_ or datetime.now(UTC).date()
    data = service.get_adhan_times(
        day=target, lat=lat, lng=lng, tz=tz, method=method, madhab=madhab,
        city=city, ramadan=ramadan,
    )
    return AdhanTimesOut(**data)


@adhan_router.get("/range", response_model=AdhanRangeOut)
async def adhan_range(
    start: date = Query(..., description="شروع بازه (میلادی)"),
    end: date = Query(..., description="پایان بازه (میلادی)؛ حداکثر ۳۶۶ روز"),
    lat: float | None = Query(default=None, ge=-90.0, le=90.0),
    lng: float | None = Query(default=None, ge=-180.0, le=180.0),
    city: str | None = Query(default=None, description="نام شهر از GET /adhan/options"),
    method: AdhanMethod = Query(default="council"),
    madhab: Madhab = Query(default="hanafi"),
    tz: float = Query(default=0.0, ge=-12.0, le=14.0),
    ramadan: bool | None = Query(default=None),
):
    """بازهٔ اوقات برای نماهای هفته/ماه/سال — هر روز source خودش را دارد."""
    data = service.get_adhan_range(
        start=start, end=end, lat=lat, lng=lng, tz=tz, method=method,
        madhab=madhab, city=city, ramadan=ramadan,
    )
    return AdhanRangeOut(**data)


@adhan_router.get("/options", response_model=AdhanOptionsOut)
async def adhan_options():
    """فهرست روش‌ها (با زاویه و مرجع) و شهرها — مرجع واحد فرانت و CRM."""
    return AdhanOptionsOut(**service.get_adhan_options())


@adhan_router.get("/geocode", response_model=GeocodeSearchOut)
async def adhan_geocode(
    q: str = Query(..., min_length=1, max_length=200, description="عبارت جست‌وجوی مکان"),
):
    """جست‌وجوی مکان در سراسر جهان (پروکسی Nominatim) — برای بخش موقعیت صفحه.

    خطای بالادست ۵۰۲ می‌دهد؛ هرگز نتیجهٔ جعلی برنمی‌گرداند.
    """
    return GeocodeSearchOut(**service.search_places(q))


@adhan_router.get("/reverse", response_model=GeocodePlaceOut)
async def adhan_reverse(
    lat: float = Query(..., ge=-90.0, le=90.0, description="عرض جغرافیایی"),
    lng: float = Query(..., ge=-180.0, le=180.0, description="طول جغرافیایی"),
):
    """نام مکان برای مختصات GPS — نبودِ نام خطا نیست (name برابر None)."""
    return GeocodePlaceOut(**service.reverse_place(lat, lng))
