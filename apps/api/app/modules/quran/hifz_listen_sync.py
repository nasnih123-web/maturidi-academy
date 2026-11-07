"""همگام‌سازی موقعیت شنیدن (listen position) — مأموریت تکمیلی حفاظ، بخش ۵.

یک ردیف برای هر کاربر (`hifz_listen_positions`، کلید اصلی user_id):
آخرین قاری، سوره+آیه، موقعیت پخش (میلی‌ثانیه)، سرعت و وضعیت تکرار.
این موقعیت، جدا از موقعیت نشست تمرین (`hifz_attempts.current_*`) است —
«آیه‌ای که گوش داده شد» با «آیه‌ای که تمرین می‌شود» یکی نیست و نباید
بنر ازسرگیری تمرین را آلوده کند (همان دلیل وب که موقعیت شنیدن را در
localStorage نگه می‌داشت؛ حالا نسخهٔ سروری آن این‌جاست).

قانون ادغام — last-write-wins بر حسب updated_at (همین قانون در
`apps/mobile/src/lib/listenPlayer.ts` — تابع `mergeListenPositions` —
پیاده شده و کلاینت موبایل همان را اجرا می‌کند):
- کلاینت همراه هر ذخیره، `updated_at` حالت محلی‌اش را می‌فرستد
  (زمان آخرین تغییر محلی؛ نبودش یعنی «تازه‌ترین» و اعمال می‌شود).
- سرور فقط وقتی می‌نویسد که `updated_at` فرستنده >= `updated_at`
  ذخیره‌شده باشد. تساوی به نفع نویسنده است (قطعی و تکرارپذیر).
- نوشتهٔ کهنه‌تر رد می‌شود: `applied=false, conflict=true` + حالت
  سرور برگردانده می‌شود و کلاینت موظف است حالت سرور را بپذیرد
  (حالت محلی‌اش را با آن جایگزین کند)، نه این‌که دوباره همان نوشتهٔ
  کهنه را بفرستد.
- ساعت نسخه (همان updated_atِ ذخیره‌شده): `min(updated_at فرستنده،
  زمان سرور)`. ساعت جلوافتادهٔ یک دستگاه به زمان سرور بریده می‌شود،
  پس نمی‌تواند نوشتارهای بعدی دستگاه دیگر را مسدود کند؛ ساعت
  عقب‌افتاده هم فقط همان دستگاه را عقب می‌اندازد و نوشتارِ دستگاهِ
  دیگر (با ساعت درست) تازه‌تر شمرده می‌شود.

مالکیت: هیچ شناسه‌ای در URL نیست؛ ردیف با user_id کاربر احرازشده
کلید می‌خورد، پس کاربر فقط ردیف خودش را می‌خواند/می‌نویسد و دادهٔ
کاربر دیگر هرگز دیده نمی‌شود (GET کاربر دیگر null است، نه ۴۰۴ِ
افشاکننده — ردیفی برای او وجود ندارد).

مهمان: مهمان (بدون توکن) به این مسیرها نمی‌رسد (۴۰۱) و فقط محلی
می‌ماند. قطع سرور هم موقعیت محلی را پاک نمی‌کند — کلاینت محلی را
نگه می‌دارد و در اتصال بعدی همگام می‌کند.

حریم خصوصی: هیچ دادهٔ صوتی ذخیره/فرستاده نمی‌شود — فقط شناسهٔ قاری،
شمارهٔ سوره/آیه، میلی‌ثانیه، سرعت و شمار تکرار.
"""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, Field

from app.core.errors import APIError
from app.models.models import HifzListenPosition, User

# سرعت‌های مجاز شنیدن (Tarteel Listening، spec §11.2 — وب:
# lib/hifz-player.ts LISTEN_SPEEDS). ۲× در فه��ست نیست.
LISTEN_SPEEDS = (0.5, 0.75, 1.0, 1.25, 1.5, 1.75)

REPEAT_MODES = ("off", "ayah", "range", "surah")

# سقف موقعیت پخش: یک سورهٔ کامل (بقره، کندترین قاری) زیر سه ساعت است؛
# بالاتر از آن، دادهٔ خراب است نه موقعیت واقعی.
MAX_PROGRESS_MS = 3 * 60 * 60 * 1000


class HifzListenPositionIn(BaseModel):
    """حالت پلیر شنیداری که کلاینت می‌خواهد ذخیره کند."""

    reciter: str = Field(min_length=1, max_length=40)
    surah: int = Field(ge=1, le=114)
    ayah: int = Field(ge=1, le=286)
    progress_ms: int = Field(ge=0, le=MAX_PROGRESS_MS)
    speed: float = Field(default=1.0)
    repeat_mode: str = Field(default="off", max_length=10)
    repeat_ayah: int = Field(default=1, ge=1, le=20)
    repeat_range_start: int | None = Field(default=None, ge=1, le=286)
    repeat_range_end: int | None = Field(default=None, ge=1, le=286)
    repeat_range_count: int = Field(default=1, ge=1, le=20)
    # زمان آخرین تغییر حالت محلی (قانون ادغام بالا)؛ None = تازه‌ترین.
    updated_at: datetime | None = None


class HifzListenPositionOut(BaseModel):
    """حالت ذخیره‌شدهٔ پلیر شنیداری یک کاربر."""

    reciter: str
    surah: int
    ayah: int
    progress_ms: int
    speed: float
    repeat_mode: str
    repeat_ayah: int
    repeat_range_start: int | None = None
    repeat_range_end: int | None = None
    repeat_range_count: int
    updated_at: datetime | None = None
    created_at: datetime | None = None


class HifzListenPositionSaveOut(BaseModel):
    """نتیجهٔ ذخیره: اعمال شد یا نوشته کهنه بود و سرور برنده شد."""

    applied: bool
    conflict: bool
    position: HifzListenPositionOut


def _out(row: HifzListenPosition) -> dict:
    return {
        "reciter": row.reciter,
        "surah": row.surah,
        "ayah": row.ayah,
        "progress_ms": row.progress_ms,
        "speed": row.speed,
        "repeat_mode": row.repeat_mode,
        "repeat_ayah": row.repeat_ayah,
        "repeat_range_start": row.repeat_range_start,
        "repeat_range_end": row.repeat_range_end,
        "repeat_range_count": row.repeat_range_count,
        "updated_at": row.updated_at,
        "created_at": row.created_at,
    }


def _validate(body: HifzListenPositionIn) -> None:
    """اعتبارسنجی دامنه‌ای فراتر از Fieldها — همه ۴۲۲ با کد روشن."""
    from .recitation_timing import RECITERS

    if body.reciter not in RECITERS:
        raise APIError(
            422,
            "hifz_listen_reciter_unknown",
            "شناسهٔ قاری ناشناخته است",
            {"reciter": body.reciter},
        )
    if body.speed not in LISTEN_SPEEDS:
        raise APIError(
            422,
            "hifz_listen_speed_invalid",
            "سرعت پخش باید یکی از ۰٫۵، ۰٫۷۵، ۱، ۱٫۲۵، ۱٫۵ یا ۱٫۷۵ باشد",
            {"speed": body.speed},
        )
    if body.repeat_mode not in REPEAT_MODES:
        raise APIError(
            422,
            "hifz_listen_repeat_invalid",
            "حالت تکرار باید off یا ayah یا range یا surah باشد",
            {"repeat_mode": body.repeat_mode},
        )
    if body.repeat_mode == "range":
        if body.repeat_range_start is None or body.repeat_range_end is None:
            raise APIError(
                422,
                "hifz_listen_range_missing",
                "تکرار بازه نیازمند آیهٔ شروع و پایان است",
            )
        if body.repeat_range_start > body.repeat_range_end:
            raise APIError(
                422,
                "hifz_listen_range_invalid",
                "آیهٔ شروع بازه نمی‌تواند پس از آیهٔ پایان باشد",
            )
    if body.repeat_mode != "range" and (
        body.repeat_range_start is not None or body.repeat_range_end is not None
    ):
        raise APIError(
            422,
            "hifz_listen_range_unexpected",
            "بازهٔ تکرار فقط با حالت range فرستاده می‌شود",
        )


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def get_listen_position(db, user: User) -> dict | None:
    """خواندن موقعیت شنیدن کاربر؛ نبودن = None (نه ۴۰۴)."""
    row = await db.get(HifzListenPosition, user.id)
    return _out(row) if row is not None else None


async def save_listen_position(
    db, user: User, body: HifzListenPositionIn
) -> dict:
    """ذخیرهٔ موقعیت شنیدن با قانون last-write-wins (سند بالای فایل).

    نوشتهٔ کهنه (updated_at فرستنده < stored) رد می‌شود و حالت سرور
    برگردانده می‌شود؛ بقیه اعمال می‌شوند. فقط ردیف خود کاربر لمس
    می‌شود.
    """
    _validate(body)
    row = await db.get(HifzListenPosition, user.id)
    now = _utcnow()
    # ساعت نسخه: مُهر فرستنده، بریده‌شده به زمان سرور (سند بالای فایل).
    if body.updated_at is None:
        incoming = now
    else:
        incoming = body.updated_at
        if incoming.tzinfo is None:
            incoming = incoming.replace(tzinfo=UTC)
        incoming = min(incoming, now)
    if row is not None and row.updated_at is not None:
        stored = row.updated_at
        if stored.tzinfo is None:
            stored = stored.replace(tzinfo=UTC)
        if incoming < stored:
            return {"applied": False, "conflict": True, "position": _out(row)}
    if row is None:
        row = HifzListenPosition(user_id=user.id)
        db.add(row)
    row.reciter = body.reciter
    row.surah = body.surah
    row.ayah = body.ayah
    row.progress_ms = body.progress_ms
    row.speed = body.speed
    row.repeat_mode = body.repeat_mode
    row.repeat_ayah = body.repeat_ayah
    row.repeat_range_start = body.repeat_range_start
    row.repeat_range_end = body.repeat_range_end
    row.repeat_range_count = body.repeat_range_count
    # انتساب صریح بر onupdate مدل غلبه می‌کند: updated_atِ ذخیره‌شده
    # همان ساعت نسخه است (نه زمان سرور)، تا مقایسهٔ بعدی با همین
    # ساعت انجام شود.
    row.updated_at = incoming
    await db.commit()
    await db.refresh(row)
    return {"applied": True, "conflict": False, "position": _out(row)}
