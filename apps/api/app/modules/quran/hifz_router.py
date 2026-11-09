"""روتر حفاظ — فاز ۳ قرآن (record-then-grade).

همهٔ مسیرها به‌جز /status نیازمند احراز هویت‌اند؛ دادهٔ هر کاربر فقط
برای خودش است (مالکیت در سرویس چک می‌شود، نه فقط با شناسه).
صوت فقط در حافظه پردازش می‌شود و هرگز ذخیره نمی‌شود.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import time
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Query,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import Message

from app.core.database import get_db
from app.core.errors import APIError
from app.core.hifz_live_limiter import LiveAcquire, live_lease_heartbeat
from app.core.rate_limit import rate_limit
from app.core.realtime import (
    _HandshakeRejected,
    authenticate_ws_with_session,
    session_still_valid,
)
from app.core.storage import read_capped_upload
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission

from . import (
    hifz_listen_sync,
    hifz_mutashabihat,
    hifz_plan_service,
    hifz_purge,
    hifz_service,
    hifz_stream,
    hifz_testing,
    hifz_voice_search,
)
from .hifz_ws_contract import (
    LIVE_SESSION_REVALIDATION_SECONDS,
    MAX_FRAME_VIOLATIONS,
    MAX_SESSION_SECONDS,
    MAX_TEXT_MESSAGE_BYTES,
    FrameRateLimiter,
    LiveEventSequencer,
    LiveSessionState,
    LiveSessionStateMachine,
    live_stream_gateway,
    parse_start_message,
    validate_frame,
)

logger = logging.getLogger(__name__)
from .hifz_listen_sync import (
    HifzListenPositionIn,
    HifzListenPositionOut,
    HifzListenPositionSaveOut,
)
from .hifz_schemas import (
    HifzAdminAttemptOut,
    HifzAttemptDetailOut,
    HifzAttemptIn,
    HifzAttemptOut,
    HifzDashboardOut,
    HifzDataPreviewOut,
    HifzDataPurgeIn,
    HifzDataPurgeOut,
    HifzDisputeIn,
    HifzDisputeOut,
    HifzDueReviewOut,
    HifzGradeOut,
    HifzMistakeGroupOut,
    HifzMutashabihatGroupOut,
    HifzPeekIn,
    HifzPeekOut,
    HifzPlanIn,
    HifzPlanItemStatusIn,
    HifzPlanOut,
    HifzPlanStatusIn,
    HifzPositionIn,
    HifzReviewIn,
    HifzReviewItemOut,
    HifzReviewOut,
    HifzStatsOut,
    HifzStatusOut,
    HifzSuggestedOut,
    HifzTasmiActionIn,
    HifzTasmiIn,
    HifzTasmiOut,
    HifzTestAnswerOut,
    HifzTestIn,
    HifzTestOut,
    HifzTestPeekIn,
    HifzTestPeekOut,
    HifzTestRemoveEventIn,
    HifzTestRemoveEventOut,
    HifzUserSettingsIn,
    HifzUserSettingsOut,
    HifzVoiceSearchOut,
)

hifz_router = APIRouter(prefix="/api/v1/quran/hifz", tags=["quran-hifz"])

_admin_perm = require_permission("platform.settings")


def _hifz_audio_rl_key(request: Request) -> str:
    """کلید محدودیت نرخ برای endpointهای صوتیِ پرهزینه (ASR).

    بر اساس نشستِ احرازشده (`request.state.session_id` را
    `get_current_user` پیش از رسیدن به endpoint می‌گذارد)؛ هر نشست
    یک سطل جدا دارد، پس کاربرانِ پشت یک VPN خروجیِ مشترک، سطلِ هم را
    نمی‌خورند. بدون نشست (نباید برسد — احراز هویت اول است)، کلید
    سراسریِ «unknown» می‌خورد.
    """
    sid = getattr(request.state, "session_id", None)
    return f"hifz-audio:{sid or 'unknown'}"


# هر فراخوانیِ صوتی یک رونویسیِ کامل با موتور ASR است (CPU)؛ ۳۰
# فراخوانی در دقیقه برای هر نشست، برای خواندنِ انسان (هر آیه چند
# ثانیه) بسیار گشاد است و سیلِ ماشینی را می‌گیرد.
_hifz_audio_rate_limit = rate_limit(
    _hifz_audio_rl_key, limit=30, window_s=60
)


# حذف یک‌جای دادهٔ حفظ (P1-5) عملی برگشت‌ناپذیر است؛ ۳ بار در ساعت
# به‌ازای هر نشست، کلیکِ تکراری یا اسکریپت را می‌گیرد — نه کاربرِ
# واقعی را (purge دوم روی دادهٔ خالی صفر برمی‌گرداند).
def _hifz_purge_rl_key(request: Request) -> str:
    sid = getattr(request.state, "session_id", None)
    return f"hifz-purge:{sid or 'unknown'}"


_hifz_purge_rate_limit = rate_limit(
    _hifz_purge_rl_key, limit=3, window_s=3600
)


@hifz_router.get("/status", response_model=HifzStatusOut)
async def get_status(db: AsyncSession = Depends(get_db)):
    """موتور انتخاب‌شده + در دسترس بودن آن — عمومی، بدون بارگذاری مدل."""
    return HifzStatusOut(**await hifz_service.engine_status(db))


@hifz_router.post("/attempts", response_model=HifzAttemptOut)
async def create_attempt(
    body: HifzAttemptIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return HifzAttemptOut(
        **await hifz_service.create_attempt(
            db,
            user,
            body.surah,
            body.page,
            body.start_ayah,
            body.end_ayah,
            body.repeat_ayah,
            body.repeat_range,
        )
    )


@hifz_router.get("/attempts/resume", response_model=HifzAttemptOut | None)
async def resume_lookup(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """تازه‌ترین نشستِ باز برای ازسرگیری (فاز ۴)؛ نبودنش null است،
    نه ۴۰۴ — کلاینت در آن صورت جلسهٔ تازه می‌سازد. این مسیر باید
    پیش از /attempts/{attempt_id} تعریف شود تا «resume» به‌عنوان
    UUID خوانده نشود."""
    found = await hifz_service.resumable_attempt(db, user)
    return HifzAttemptOut(**found) if found else None


@hifz_router.get("/attempts", response_model=list[HifzAttemptOut])
async def list_attempts(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await hifz_service.list_attempts(db, user, limit, offset)
    return [HifzAttemptOut(**r) for r in rows]


@hifz_router.get("/attempts/{attempt_id}", response_model=HifzAttemptDetailOut)
async def get_attempt(
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    detail = await hifz_service.attempt_detail(db, user, attempt_id)
    return HifzAttemptDetailOut(
        attempt=HifzAttemptOut(**detail["attempt"]),
        words=detail["words"],
        mistakes=detail["mistakes"],
    )


@hifz_router.post("/attempts/{attempt_id}/complete", response_model=HifzAttemptOut)
async def complete_attempt(
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return HifzAttemptOut(
        **await hifz_service.complete_attempt(db, user, attempt_id)
    )


@hifz_router.patch("/attempts/{attempt_id}/position", response_model=HifzAttemptOut)
async def update_attempt_position(
    attempt_id: UUID,
    body: HifzPositionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ثبت آخرین موقعیتِ دنبال‌شده (فاز ۴ — ازسرگیری سرور-side)."""
    return HifzAttemptOut(
        **await hifz_service.update_position(
            db, user, attempt_id,
            body.current_surah, body.current_ayah, body.current_word_index,
        )
    )


@hifz_router.post("/attempts/{attempt_id}/pause", response_model=HifzAttemptOut)
async def pause_attempt(
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """مکثِ سرور-side نشست (فاز ۴ — رفع G-05: مکث فقط کلاینتی نیست)."""
    return HifzAttemptOut(**await hifz_service.pause_attempt(db, user, attempt_id))


@hifz_router.post("/attempts/{attempt_id}/resume", response_model=HifzAttemptOut)
async def resume_attempt(
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ازسرگیری نشستِ مکث‌کرده از موقعیتِ ذخیره‌شده (فاز ۴)."""
    return HifzAttemptOut(**await hifz_service.resume_attempt(db, user, attempt_id))


@hifz_router.get(
    "/attempts/{attempt_id}/mistakes", response_model=list[HifzMistakeGroupOut]
)
async def attempt_mistakes_grouped(
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """برگهٔ خطاها، گروه‌شده به‌ازای هر آیه (فاز ۴): کارت «كلمات
    خاطئة» (موردانتظار/خوانده‌شده) و کارت «كلمات زائدة» (فقط
    خوانده‌شده)، هر کارت با برچسب «سوره:آیه»."""
    rows = await hifz_service.mistakes_grouped(db, user, attempt_id)
    return [HifzMistakeGroupOut(**r) for r in rows]


@hifz_router.delete("/attempts/{attempt_id}", status_code=204)
async def delete_attempt(
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await hifz_service.delete_attempt(db, user, attempt_id)


@hifz_router.post("/attempts/{attempt_id}/grade", response_model=HifzGradeOut)
@_hifz_audio_rate_limit
async def grade_ayah(
    attempt_id: UUID,
    request: Request,
    surah: int = Form(ge=1, le=114),
    ayah: int = Form(ge=1, le=286),
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """نمره‌دهی یک آیه: WAV تک‌کانالهٔ ۱۶ کیلوهرتز (کاربر سمت مرورگر
    ری‌سمپل می‌کند). صوت گذراست و ذخیره نمی‌شود."""
    data = await read_capped_upload(
        audio,
        hifz_service.MAX_AUDIO_BYTES,
        too_large_code="hifz_audio_too_large",
        too_large_message="فایل صوت بیش از حد بزرگ است",
    )
    result = await hifz_service.grade_ayah(db, user, attempt_id, surah, ayah, data)
    return HifzGradeOut(**result)


@hifz_router.post("/attempts/{attempt_id}/grade-word", response_model=HifzGradeOut)
@_hifz_audio_rate_limit
async def grade_word(
    attempt_id: UUID,
    request: Request,
    surah: int = Form(ge=1, le=114),
    ayah: int = Form(ge=1, le=286),
    word_index: int = Form(ge=0),
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """تمرین تک‌کلمه: فقط همان یک کلمه نمره می‌گیرد."""
    data = await read_capped_upload(
        audio,
        hifz_service.MAX_AUDIO_BYTES,
        too_large_code="hifz_audio_too_large",
        too_large_message="فایل صوت بیش از حد بزرگ است",
    )
    result = await hifz_service.grade_word(
        db, user, attempt_id, surah, ayah, word_index, data
    )
    return HifzGradeOut(**result)


@hifz_router.post("/attempts/{attempt_id}/peek", response_model=HifzPeekOut)
async def peek_word(
    body: HifzPeekIn,
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Peek: نمایش کلمه = ثبت خطا."""
    return HifzPeekOut(
        **await hifz_service.peek_word(
            db, user, attempt_id, body.surah, body.ayah, body.word_index, body.word_indices,
            body.kind,
        )
    )


@hifz_router.delete("/mistakes/{mistake_id}", status_code=204)
async def delete_mistake(
    mistake_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """حذفِ تکیِ یک ردیف خطا (فاز ۴ — مکانیک P1-5؛ حذفِ یک‌جا هنوز
    تصمیم کاربر را می‌خواهد)."""
    await hifz_service.delete_mistake(db, user, mistake_id)


@hifz_router.get("/settings", response_model=HifzUserSettingsOut)
async def get_hifz_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """تنظیم‌های حفظِ کاربر (فاز ۴)؛ نبودِ ردیف = پیش‌فرض‌ها."""
    return HifzUserSettingsOut(**await hifz_service.get_user_settings(db, user))


@hifz_router.put("/settings", response_model=HifzUserSettingsOut)
async def put_hifz_settings(
    body: HifzUserSettingsIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """به‌روزرسانی تنظیم‌های حفظِ کاربر (فاز ۴)؛ فقط فیلدهای
    فرستاده‌شده عوض می‌شوند."""
    return HifzUserSettingsOut(
        **await hifz_service.update_user_settings(db, user, body.model_dump())
    )


# ---------------------------------------------------------------------------
# مأموریت تکمیلی — بخش ۵: موقعیت شنیدنِ سرور-side (پلیر موبایل + وب).
# جدا از موقعیت نشست تمرین است (سند hifz_listen_sync.py). قانون ادغام:
# last-write-wins بر حسب updated_at؛ نوشتهٔ کهنه applied=false
# برمی‌گرداند و کلاینت حالت سرور را می‌پذیرد.
# ---------------------------------------------------------------------------


@hifz_router.get("/listen-position", response_model=HifzListenPositionOut | None)
async def get_listen_position(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """موقعیت شنیدنِ کاربر؛ نبودن null است، نه ۴۰۴ (مثل resume)."""
    found = await hifz_listen_sync.get_listen_position(db, user)
    return HifzListenPositionOut(**found) if found else None


@hifz_router.put("/listen-position", response_model=HifzListenPositionSaveOut)
async def put_listen_position(
    body: HifzListenPositionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ذخیرهٔ موقعیت شنیدن (قاری، سوره+آیه، میلی‌ثانیه، سرعت، تکرار)."""
    result = await hifz_listen_sync.save_listen_position(db, user, body)
    return HifzListenPositionSaveOut(**result)


@hifz_router.delete("/listen-position", status_code=204)
async def delete_listen_position(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """حذف موقعیت شنیدن کاربر (پایان سوره؛ ردیفِ نبوده هم ۲۰۴ است)."""
    await hifz_listen_sync.delete_listen_position(db, user)


@hifz_router.post("/attempts/{attempt_id}/dispute", response_model=HifzDisputeOut)
async def dispute_word(
    body: HifzDisputeIn,
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """«این درست بود»: اعتراض به نمرهٔ یک کلمه."""
    return HifzDisputeOut(
        **await hifz_service.dispute_word(db, user, attempt_id, body.word_score_id)
    )


@hifz_router.get("/stats", response_model=HifzStatsOut)
async def get_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return HifzStatsOut(**await hifz_service.stats(db, user))


@hifz_router.get("/review", response_model=list[HifzReviewItemOut])
async def get_review(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await hifz_service.review_queue(db, user)
    return [HifzReviewItemOut(**r) for r in rows]


@hifz_router.get("/admin/attempts", response_model=list[HifzAdminAttemptOut])
async def admin_attempts(
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(_admin_perm),
    db: AsyncSession = Depends(get_db),
):
    rows = await hifz_service.admin_attempts(db, limit)
    return [HifzAdminAttemptOut(**r) for r in rows]


@hifz_router.delete("/admin/attempts/{attempt_id}", status_code=204)
async def admin_delete_attempt(
    attempt_id: UUID,
    user: User = Depends(_admin_perm),
    db: AsyncSession = Depends(get_db),
):
    """حذفِ نشست از جدولِ تلاش‌های CRM (فاز ۴)."""
    await hifz_service.delete_attempt_admin(db, attempt_id)


# ---------------------------------------------------------------------------
# فاز ۱۰ — آزمون، جستجوی صوتی، متشابهات، برنامه/SRS/داشبورد، تسمی.
# همهٔ این مسیرها جریان جداگانه از صفحهٔ مطالعه‌اند؛ هیچ‌کدام نتیجه/
# آمار/تاریخچه را روی صفحهٔ مطالعه نمی‌آورند.
# ---------------------------------------------------------------------------


@hifz_router.post("/tests", response_model=HifzTestOut)
async def create_test(
    body: HifzTestIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ساخت آزمون موقت (Temporary Session) با سؤال‌های فلش‌کارت."""
    return HifzTestOut(
        **await hifz_testing.create_test(
            db,
            user,
            surah_start=body.surah_start,
            surah_end=body.surah_end,
            question_count=body.question_count,
            time_limit_minutes=body.time_limit_minutes,
            question_length=body.question_length,
            stop_rule=body.stop_rule,
        )
    )


@hifz_router.get("/tests", response_model=list[HifzTestOut])
async def list_tests(
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await hifz_testing.list_tests(db, user, limit)
    return [HifzTestOut(**r) for r in rows]


@hifz_router.get("/tests/{test_id}", response_model=HifzTestOut)
async def get_test(
    test_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return HifzTestOut(**await hifz_testing.get_test(db, user, test_id))


@hifz_router.post(
    "/tests/{test_id}/questions/{question_id}/answer",
    response_model=HifzTestAnswerOut,
)
@_hifz_audio_rate_limit
async def answer_test_question(
    test_id: UUID,
    question_id: UUID,
    request: Request,
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """پاسخ یک سؤال آزمون با صوت (WAV تک‌کانالهٔ ۱۶ کیلوهرتز)."""
    data = await read_capped_upload(
        audio,
        hifz_service.MAX_AUDIO_BYTES,
        too_large_code="hifz_audio_too_large",
        too_large_message="فایل صوت بیش از حد بزرگ است",
    )
    result = await hifz_testing.answer_question(
        db, user, test_id, question_id, data
    )
    return HifzTestAnswerOut(**result)


@hifz_router.post(
    "/tests/{test_id}/questions/{question_id}/skip",
    response_model=dict,
)
async def skip_test_question(
    test_id: UUID,
    question_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await hifz_testing.skip_question(db, user, test_id, question_id)


@hifz_router.post(
    "/tests/{test_id}/questions/{question_id}/peek",
    response_model=HifzTestPeekOut,
)
async def peek_test_question(
    test_id: UUID,
    question_id: UUID,
    body: HifzTestPeekIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Peek در آزمون — در امتیاز آزمون شمرده می‌شود."""
    return HifzTestPeekOut(
        **await hifz_testing.peek_question(
            db, user, test_id, question_id,
            body.surah, body.ayah, body.word_index,
        )
    )


@hifz_router.post(
    "/tests/{test_id}/questions/{question_id}/events/{event_index}/remove",
    response_model=HifzTestRemoveEventOut,
)
async def remove_test_false_positive(
    test_id: UUID,
    question_id: UUID,
    event_index: int,
    body: HifzTestRemoveEventIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """حذف خطای کاذب: رویداد خام می‌ماند، امتیاز دوباره محاسبه می‌شود."""
    return HifzTestRemoveEventOut(
        **await hifz_testing.remove_false_positive(
            db, user, test_id, question_id, event_index, body.removed
        )
    )


@hifz_router.post("/tests/{test_id}/complete", response_model=HifzTestOut)
async def complete_test(
    test_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return HifzTestOut(**await hifz_testing.complete_test(db, user, test_id))


@hifz_router.delete("/tests/{test_id}", status_code=204)
async def delete_test(
    test_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await hifz_testing.delete_test(db, user, test_id)


@hifz_router.post("/voice-search", response_model=HifzVoiceSearchOut)
@_hifz_audio_rate_limit
async def voice_search(
    request: Request,
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """جستجوی صوتی: خواندن کوتاه → نامزدهای احتمالی سوره:آیه.

    نتیجه‌ها احتمالی‌اند، نه قطعی؛ کاربر از میان نامزدها انتخاب می‌کند.
    """
    data = await read_capped_upload(
        audio,
        hifz_service.MAX_AUDIO_BYTES,
        too_large_code="hifz_audio_too_large",
        too_large_message="فایل صوت بیش از حد بزرگ است",
    )
    return HifzVoiceSearchOut(**await hifz_voice_search.voice_search(db, data))


@hifz_router.get("/mutashabihat", response_model=list[HifzMutashabihatGroupOut])
async def mutashabihat_for_ayah(
    surah: int = Query(ge=1, le=114),
    ayah: int = Query(ge=1, le=286),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """گروه‌های عبارت مشترکِ یک آیه — محاسبه‌شده از متن تنزیل."""
    groups = hifz_mutashabihat.mutashabihat_for_ayah(surah, ayah)
    return [HifzMutashabihatGroupOut(**g) for g in groups]


@hifz_router.get(
    "/mutashabihat/phrase", response_model=HifzMutashabihatGroupOut | None
)
async def mutashabihat_for_phrase(
    phrase: str = Query(min_length=1, max_length=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = hifz_mutashabihat.mutashabihat_for_phrase(phrase)
    return HifzMutashabihatGroupOut(**group) if group else None


@hifz_router.get("/mutashabihat/count", response_model=dict)
async def mutashabihat_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """تعداد گروه‌های عبارت مشترک (محاسبه‌شده، نه hard-code)."""
    computed = hifz_mutashabihat.compute_mutashabihat()
    return {"phrase_count": computed["phrase_count"]}


@hifz_router.post("/plans", response_model=HifzPlanOut)
async def create_plan(
    body: HifzPlanIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return HifzPlanOut(
        **await hifz_plan_service.create_plan(
            db,
            user,
            title=body.title,
            kind=body.kind,
            direction=body.direction,
            start_surah=body.start_surah,
            start_ayah=body.start_ayah,
            end_surah=body.end_surah,
            end_ayah=body.end_ayah,
            daily_target_new=body.daily_target_new,
            daily_target_review=body.daily_target_review,
        )
    )


@hifz_router.get("/plans", response_model=list[HifzPlanOut])
async def list_plans(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await hifz_plan_service.list_plans(db, user)
    return [HifzPlanOut(**r) for r in rows]


@hifz_router.get("/plans/{plan_id}", response_model=HifzPlanOut)
async def get_plan(
    plan_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return HifzPlanOut(**await hifz_plan_service.get_plan(db, user, plan_id))


@hifz_router.patch("/plans/{plan_id}", response_model=HifzPlanOut)
async def set_plan_status(
    plan_id: UUID,
    body: HifzPlanStatusIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return HifzPlanOut(
        **await hifz_plan_service.set_plan_status(db, user, plan_id, body.status)
    )


@hifz_router.patch(
    "/plans/{plan_id}/items/{item_id}", response_model=dict
)
async def set_plan_item(
    plan_id: UUID,
    item_id: UUID,
    body: HifzPlanItemStatusIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await hifz_plan_service.set_plan_item(
        db, user, plan_id, item_id, body.status
    )


@hifz_router.delete("/plans/{plan_id}", status_code=204)
async def delete_plan(
    plan_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await hifz_plan_service.delete_plan(db, user, plan_id)


@hifz_router.post("/reviews", response_model=HifzReviewOut)
async def record_review(
    body: HifzReviewIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ثبت یک مرور (SM-2) — کیفیت از نمرهٔ ASR مشتق می‌شود."""
    return HifzReviewOut(
        **await hifz_plan_service.record_review(
            db,
            user,
            surah=body.surah,
            ayah=body.ayah,
            quality=body.quality,
            counts=body.counts,
            peek_count=body.peek_count,
        )
    )


@hifz_router.get("/reviews/due", response_model=list[HifzDueReviewOut])
async def due_reviews(
    limit: int = Query(default=100, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await hifz_plan_service.due_reviews(db, user, limit)
    return [HifzDueReviewOut(**r) for r in rows]


@hifz_router.get("/dashboard", response_model=HifzDashboardOut)
async def get_dashboard(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """داشبورد حفظ — فقط آمار واقعی و قابل‌ردیابی (جریان جداگانه)."""
    return HifzDashboardOut(**await hifz_plan_service.dashboard(db, user))


@hifz_router.get("/suggested", response_model=HifzSuggestedOut)
async def get_suggested(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """کارت‌های پیشنهادی — فقط با محفوظاتِ اعلام‌شده + تاریخچهٔ کافی."""
    return HifzSuggestedOut(**await hifz_plan_service.suggested_cards(db, user))


@hifz_router.post("/tasmi/sessions", response_model=HifzTasmiOut)
async def create_tasmi_session(
    body: HifzTasmiIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """نشست روش تمرین تسمی — خودارزیابی کاربر، نه ASR."""
    return HifzTasmiOut(
        **await hifz_plan_service.create_tasmi_session(
            db,
            user,
            method=body.method,
            variant=body.variant,
            start_surah=body.start_surah,
            start_ayah=body.start_ayah,
            end_surah=body.end_surah,
            end_ayah=body.end_ayah,
        )
    )


@hifz_router.get("/tasmi/sessions", response_model=list[HifzTasmiOut])
async def list_tasmi_sessions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await hifz_plan_service.list_tasmi_sessions(db, user)
    return [HifzTasmiOut(**r) for r in rows]


@hifz_router.get("/tasmi/sessions/{session_id}", response_model=HifzTasmiOut)
async def get_tasmi_session(
    session_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return HifzTasmiOut(
        **await hifz_plan_service.get_tasmi_session(db, user, session_id)
    )


@hifz_router.patch("/tasmi/sessions/{session_id}", response_model=HifzTasmiOut)
async def advance_tasmi_session(
    session_id: UUID,
    body: HifzTasmiActionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return HifzTasmiOut(
        **await hifz_plan_service.advance_tasmi(
            db,
            user,
            session_id,
            action=body.action,
            rating=body.rating,
            reflection=body.reflection,
        )
    )


@hifz_router.delete("/tasmi/sessions/{session_id}", status_code=204)
async def delete_tasmi_session(
    session_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await hifz_plan_service.delete_tasmi_session(db, user, session_id)


# ---------------------------------------------------------------------------
# حذف یک‌جای همهٔ دادهٔ حفظ (P1-5) — فقط دامنهٔ hifz_only (۹ جدول).
# ---------------------------------------------------------------------------
# - بدون پارامتر user_id در ورودی: endpoint فقط روی کاربرِ احراز
#   هویت‌شده (از توکن) عمل می‌کند — IDOR از اساس ناممکن است.
# - دو مرحله‌ای: پیش‌نمایش (فقط تعداد) بعد تأیید صریح با confirm=true.
# - دامنهٔ quran_all (یادداشت/ذکر) ساخته نشده است — تصمیم کاربر را
#   می‌خواهد؛ فرستادن scope در body با extra="forbid" ۴۲۲ می‌گیرد.
# - purge در یک تراکنش است؛ audit فقط تعداد به‌تفکیک جدول دارد،
#   هرگز محتوای کاربر (heard/reflection/title) — hifz_purge.py.


@hifz_router.get("/data/preview", response_model=HifzDataPreviewOut)
async def preview_hifz_data(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """پیش‌نمایش حذف یک‌جا: تعداد ردیف به‌تفکیک جدول — بدون هیچ محتوا."""
    counts = await hifz_purge.preview_hifz_data_counts(db, user.id)
    return HifzDataPreviewOut(
        scope=hifz_purge.PURGE_SCOPE, counts=counts, total=sum(counts.values())
    )


@hifz_router.post("/data/purge", response_model=HifzDataPurgeOut)
@_hifz_purge_rate_limit
async def purge_hifz_data_endpoint(
    request: Request,
    body: HifzDataPurgeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """حذف یک‌جای همهٔ دادهٔ حفظ کاربرِ جاری — برگشت‌ناپذیر.

    `confirm: true` + `idempotency_key` (UUID) الزامی‌اند؛ فراخوانیِ
    دوباره با همان کلید، روی دادهٔ خالی صفر برمی‌گرداند (idempotent).
    """
    if not body.confirm:
        raise APIError(
            422,
            "hifz_purge_not_confirmed",
            "حذف یک‌جا نیازمند تأیید صریح است (confirm: true)",
        )
    deleted = await hifz_purge.purge_hifz_data(
        db, user, idempotency_key=str(body.idempotency_key)
    )
    return HifzDataPurgeOut(
        scope=hifz_purge.PURGE_SCOPE, deleted=deleted, total=sum(deleted.values())
    )


# ---------------------------------------------------------------------------
# خواندن زنده (WebSocket) — بازبینی فاز ۳، بخش ۱۵ سند طراحی؛ قرارداد
# نسخه‌دار در `hifz_ws_contract.py` (فاز ۵).
#
# قرارداد پیام:
# - احراز هویت همان handshake سراسری است: بلیط یک‌بارمصرف `?ticket=`
#   (از POST /api/v1/auth/ws-ticket) یا JWT فقط در هدر Authorization.
#   `?token=<JWT>` هرگز پذیرفته نیست. ناموفق → بستن با ۴۴۰۱.
#   بلیط هرگز در لاگ نمی‌آید.
# - نخستین پیام مشتری باید JSON {"type": "start", "surah": N, "ayah": M}
#   باشد؛ جز این → خطا + بستن با ۴۴۰۰. کلاینت نسخهٔ ۲،
#   `protocol_version: 2` و اعلامِ قاب (`audio`) را هم می‌فرستد؛
#   نبودِ آن یعنی نسخهٔ ۱ (سازگاری عقب‌رو). نسخهٔ ناشناخته یا فیلد
#   ممنوع (`user_id`/`attempt_id`/`owner`/`session_id`) → ۴۴۰۰.
#   `surah` باید با سورهٔ attempt برابر باشد.
# - قاب‌های صوتی: باینری Int16LE تک‌کانالهٔ ۱۶ کیلوهرتز، ۴۰۹۶ نمونه
#   (۲۵۶ میلی‌ثانیه) در هر قاب. صوت گذراست و ذخیره نمی‌شود. قابِ
#   بدشکل/بیش‌ازحد و نرخِ بیش‌ازحد → خطای روشن (غیرکشنده، بعد
#   تکرار → بستن). پیام متنیِ ناشناخته → `unknown_message`، بدون بستن.
# - سقف اتصال هم‌زمان (فاز ۱۱): هر کاربر ۱ اتصال زنده، کل فرایند ۴
#   (هر اتصال یک بازشناسِ ۷۳ مگابایتی نگه می‌دارد)؛ جا نبود → بستن
#   با ۴۴۰۹ و کد `hifz_too_many_streams`.
# - readiness واقعی (فاز ۵، R-02): پس از `start`، سرور به‌ترتیب
#   `session_started`، `engine_ready` (پس از ساخت بازشناس + warm-up)
#   و `audio_ready` می‌فرستد؛ حلقهٔ جریان با `listening` شروع
#   می‌شود و کلاینت فقط پس از آن، «در حال گوش‌دادن» نشان می‌دهد و
#   قاب می‌فرستد. قاب‌های رسیده پیش از readiness رد می‌شوند و شمارشان
#   با رویداد `warning` (کد `hifz_frames_before_ready`) گزارش می‌شود،
#   نه بی‌صدا دور ریخته.
# - سرور: `{"type": "word", ...}` برای هر کلمهٔ نوشته‌شده (جاافتاده هم
#   با status=skipped خاکستری می‌آید)، `{"type": "extra"}` برای کلمهٔ
#   اضافه، و `{"type": "final", ...}` پس از ذخیره — همه با پاکت
#   نسخهٔ ۲ (`session_id`/`event_id`/`sequence_no`/`event_type`/
#   `status`/`audio_ts_ms`/`confidence`/`reason`). رویدادهای تازهٔ
#   نسخهٔ ۲: `session_started`، `engine_ready`، `audio_ready`،
#   `listening`، `partial`، `stable_word`، `final_word`، `correction`،
#   `located`، `skipped`، `wrong`، `progress`، `warning`،
#   `session_ended`. کلمهٔ تکراری هرگز دوباره نوشته نمی‌شود؛ تصمیمِ
#   بعدی برای همان خانه، `correction` است.
# - مشتری `{"type": "end"}` بفرستد → ذخیره + پیام final + بستن ۱۰۰۰.
#   قطع ناگهانی (بدون end) چیزی ذخیره نمی‌کند. مدت نشست حداکثر ۳۰
#   دقیقه است؛ پس از آن مثل `end` نهایی می‌شود.
# - خطاهای شروع (نشست دیگری ۴۰۴، موتور غیرجریانی، نگاشت مسدود، مدل
#   پیکربندی‌نشده) → پیام {"type": "error", "code": ...} + بستن با
#   ۴۴۰۴ (نشست) یا ۴۵۰۰ (موتور/نگاشت).
# ---------------------------------------------------------------------------


@hifz_router.websocket("/attempts/{attempt_id}/stream")
async def stream_attempt(
    websocket: WebSocket,
    attempt_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """خواندن زنده: قاب صوتی می‌گیرد، کلمهٔ رنگی برمی‌گرداند."""
    state_machine = LiveSessionStateMachine()
    try:
        # فاز ۱۲، P1-1: نشستِ گره‌خورده هم برگردانده می‌شود تا وسط
        # جریان، دوره‌ای اعتبارسنجی شود (ابطالِ نشست، اتصال را می‌بندد).
        user, auth_session_id = await authenticate_ws_with_session(websocket, db)
    except _HandshakeRejected:
        return
    await websocket.accept()
    # سقف اتصال زنده (فاز ۱۱ + P1-3): هر اتصال یک بازشناسِ ۷۳ مگابایتی
    # نگه می‌دارد؛ جا نبود → ۴۴۰۹ با کد روشن، نه پذیرشِ بی‌سروصدا.
    # دروازه وقتی Redis هست (فقط production + provisioning) سقفِ
    # مشترک را می‌گیرد وگرنه همان limiter درون‌فرایندیِ فعلی؛ قطعیِ
    # Redis در production اتصالِ تازه را با `hifz_live_unavailable`
    # رد می‌کند (fail-closed) و اتصال‌های موجود را قطع نمی‌کند.
    _acquire = await live_stream_gateway.try_acquire(user.id, attempt_id)
    if _acquire is LiveAcquire.TOO_MANY:
        try:
            await websocket.close(code=4409, reason="hifz_too_many_streams")
        except (WebSocketDisconnect, RuntimeError):
            pass
        return
    if _acquire is LiveAcquire.UNAVAILABLE:
        try:
            await websocket.close(code=4409, reason="hifz_live_unavailable")
        except (WebSocketDisconnect, RuntimeError):
            pass
        return
    # تازه‌کردن lease در Redis (فقط برای نشستِ توزیع‌شده اثر دارد؛
    # نشستِ محلی heartbeat را نادیده می‌گیرد). لغوش در finally است.
    _heartbeat_task = asyncio.create_task(
        live_lease_heartbeat(live_stream_gateway, user.id, attempt_id)
    )
    try:
        state_machine.transition(LiveSessionState.CONNECTING)
        _t_accepted = time.perf_counter()
        # یک شماره‌گذار برای همهٔ رویدادهای این اتصال (حتی خطاهای پیش از
        # ساخت نشست): sequence_no در یک نشست هرگز تکرار نمی‌شود.
        sequencer = LiveEventSequencer(session_id=str(attempt_id))

        async def send_error(
            code: str, message: str, close_code: int, *, fatal: bool = True
        ) -> None:
            event = sequencer.envelope(
                "error", "error", code=code, message=message, fatal=fatal
            )
            try:
                await websocket.send_json(event)
            except (WebSocketDisconnect, RuntimeError) as exc:
                logger.debug("hifz stream error send failed: %s", exc)
            try:
                await websocket.close(code=close_code, reason=code)
            except (WebSocketDisconnect, RuntimeError) as exc:
                logger.debug("hifz stream error close failed: %s", exc)

        # پیام start — نخستین پیام باید start باشد.
        try:
            first = await websocket.receive_json()
        except (WebSocketDisconnect, RuntimeError, ValueError):
            return
        _t_start_msg = time.perf_counter()
        try:
            start = parse_start_message(first)
        except APIError as exc:
            await send_error(exc.code, exc.message, 4400)
            return
        surah = start["surah"]
        ayah = start["ayah"]
        protocol_version = start["protocol_version"]
        state_machine.transition(LiveSessionState.CONNECTED)

        queue: asyncio.Queue = asyncio.Queue()
        try:
            # دروازهٔ نگاشت، پیش از هر صوتی: بدون نگاشت تأییدشده، نشست
            # ساخته نمی‌شود و هیچ واجی به کلمه تبدیل نمی‌شود.
            state_machine.transition(LiveSessionState.ENGINE_LOADING)
            _t_mapping_started = time.perf_counter()
            mapping = hifz_stream.require_phoneme_mapping()
            _t_mapping = time.perf_counter()
            session = await hifz_stream.start_live_session(
                db, user, attempt_id, surah, ayah, queue.put_nowait, mapping
            )
            # شماره‌گذارِ مشترک: خطاهای پیش از نشست و رویدادهای نشست،
            # یک رشتهٔ sequence_no دارند.
            session._sequencer = sequencer
            _t_session = time.perf_counter()
            # ساخت بازشناس، کارِ بومیِ همگام است (بارگذاری مدل ۷۳ مگابایتی)؛
            # در نخ جدا ساخته می‌شود تا حلقهٔ رویداد قفل نشود.
            _build_started = time.perf_counter()
            recognizer = await asyncio.to_thread(hifz_stream.SherpaPhonemeStream)
            build_ms = (time.perf_counter() - _build_started) * 1000.0
            # گرم‌کردن واقعی: نیم ثانیه سکوت از مسیر بومی می‌گذرد تا
            # engine_ready یعنی واقعاً آماده، نه فقط ساخته‌شده.
            warmup_ms = await asyncio.to_thread(recognizer.warmup)
        except APIError as exc:
            close_code = 4404 if exc.status_code == 404 else 4500
            await send_error(exc.code, exc.message, close_code)
            return
        except Exception:
            # خطای ناشناختهٔ شروع هم باید پیام خطا بشود، نه قطع بی‌صدا.
            # جزئیات استثنا هرگز به کلاینت نمی‌رسد (مسیر فایل/مدل لو
            # نمی‌رود)؛ فقط در لاگ سرور می‌ماند.
            logger.exception(
                "hifz live stream start failed attempt=%s surah=%s ayah=%s",
                attempt_id,
                surah,
                ayah,
            )
            await send_error(
                "hifz_stream_error", "خطای داخلی در شروع جریان زنده؛ دوباره تلاش کنید.", 1011
            )
            return
        _start_timings = {
            "wait_start_ms": (_t_start_msg - _t_accepted) * 1000.0,
            "mapping_ms": (_t_mapping - _t_mapping_started) * 1000.0,
            "session_ms": (_t_session - _t_mapping) * 1000.0,
            "build_ms": build_ms,
            "warmup_ms": warmup_ms,
        }
        logger.info(
            "hifz live session started attempt=%s surah=%s ayah=%s engine=zipformer "
            "recognizer_build_ms=%.1f warmup_ms=%.1f protocol=%d",
            attempt_id,
            surah,
            ayah,
            build_ms,
            warmup_ms,
            protocol_version,
        )
        logger.info(
            "hifz live session start timing attempt=%s wait_start_ms=%.1f "
            "mapping_ms=%.1f session_ms=%.1f build_ms=%.1f warmup_ms=%.1f total_ms=%.1f",
            attempt_id,
            _start_timings["wait_start_ms"],
            _start_timings["mapping_ms"],
            _start_timings["session_ms"],
            _start_timings["build_ms"],
            _start_timings["warmup_ms"],
            (_t_session - _t_accepted) * 1000.0 + build_ms + warmup_ms,
        )
        _slow = _slow_start_steps(_start_timings)
        if _slow:
            logger.warning(
                "hifz live session start slow steps attempt=%s steps=%s",
                attempt_id,
                ",".join(_slow),
            )
        # readiness واقعی، به‌ترتیب: نشست ساخته شد → موتور آماده شد →
        # مسیر صوتی آماده است. `listening` را خودِ serve_stream، در آغاز
        # حلقه می‌فرستد؛ کلاینت فقط پس از آن قاب می‌فرستد.
        session.emit_server_event(
            "session_started",
            surah=surah,
            ayah=ayah,
            protocol_version=protocol_version,
            state=LiveSessionState.CONNECTED.value,
            limits={
                "max_frame_bytes": 65536,
                "max_frames_per_second": 50,
                "max_session_seconds": MAX_SESSION_SECONDS,
                "frame_samples": 4096,
                "frame_ms": 256,
            },
        )
        session.emit_server_event(
            "engine_ready",
            engine="zipformer",
            build_ms=round(build_ms, 1),
            warmup_ms=round(warmup_ms, 1),
            state=LiveSessionState.ENGINE_LOADING.value,
        )
        state_machine.transition(LiveSessionState.AUDIO_READY)
        session.emit_server_event(
            "audio_ready",
            audio={
                "sample_rate": 16000,
                "channels": 1,
                "format": "pcm16le",
                "frame_samples": 4096,
                "frame_ms": 256,
            },
            state=LiveSessionState.AUDIO_READY.value,
        )
        await serve_stream(
            websocket,
            session,
            recognizer,
            queue,
            state_machine=state_machine,
            protocol_version=protocol_version,
            auth_session_id=auth_session_id,
        )

    finally:
        _heartbeat_task.cancel()
        await live_stream_gateway.release(user.id, attempt_id)


_SLOW_START_STEP_MS = 5000.0


def _slow_start_steps(timings: dict[str, float]) -> list[str]:
    """نام قدم‌های شروع نشست که بیش از آستانه طول کشیده‌اند (برای هشدار)."""
    return [
        name
        for name, ms in timings.items()
        if ms > _SLOW_START_STEP_MS
    ]


async def _collect_pre_ready_frames(websocket) -> tuple[int, Message | str | None]:
    """قاب‌های رسیده پیش از readiness را جمع کن (نه بی‌صدا دور بریز).

    تا وقتی نشست ساخته می‌شد، مرورگرِ قدیمی قاب می‌فرستاد و آن‌ها در
    صف انتقال ماندند؛ خوراندن همه‌شان یعنی دقیقه‌ها تأخیر. این قاب‌ها
    رد می‌شوند و شمارشان به فراخواننده برمی‌گردد تا با رویداد
    `warning` (کد `hifz_frames_before_ready`) گزارش شود. فقط پیام‌های
    باینری جمع می‌شوند. اگر پیام متنی (مثل end) رسید، همان را
    برمی‌گردانیم تا حلقهٔ اصلی آن را پردازش کند؛ اگر سوکت قطع شده بود،
    رشتهٔ "disconnect" برمی‌گردد.
    """
    dropped = 0
    while True:
        try:
            # تایم‌اوت مثبتِ کوتاه: wait_for با تایم‌اوت صفر ممکن است
            # کار را پیش از اجرا لغو کند؛ ۵ میلی‌ثانیه برای پیامِ
            # آماده، بی‌درنگ برمی‌گردد و برای صفِ خالی زود تمام می‌شود.
            message = await asyncio.wait_for(websocket.receive(), timeout=0.005)
        except TimeoutError:
            return dropped, None
        except (WebSocketDisconnect, RuntimeError):
            return dropped, "disconnect"
        if "bytes" in message and message["bytes"] is not None:
            dropped += 1
            continue
        return dropped, message


async def serve_stream(
    websocket,
    session,
    recognizer,
    queue: asyncio.Queue,
    state_machine: LiveSessionStateMachine | None = None,
    protocol_version: int = 2,
    rate_limiter: FrameRateLimiter | None = None,
    auth_session_id: UUID | None = None,
) -> None:
    """حلقهٔ جریان زنده — جدا شده تا با سوکتِ ساختگی آزمون شود.

    قاب باینری → واج‌های sherpa → کلمه‌های زنده؛ پیام end → تخلیهٔ
    واج‌های مانده → ذخیرهٔ نشست → پیام final → بستن ۱۰۰۰. قطع ناگهانی
    (بدون end) چیزی ذخیره نمی‌کند.

    readiness: نخستین کارِ حلقه، فرستادن `listening` است — کلاینت
    فقط پس از آن قاب می‌فرستد. قاب‌های رسیده پیش از آن، رد و با
    `warning` گزارش می‌شوند.

    سقف‌ها (R-11): هر قاب اعتبارسنجی می‌شود (طولِ زوج، حداکثر بایت)
    و نرخِ قاب با سطل توکن محدود می‌شود؛ تخطیِ پی‌درپی → بستن.
    مدت نشست حداکثر `MAX_SESSION_SECONDS` است؛ پس از آن، نشست مثل
    `end` نهایی می‌شود.

    اعتبارسنجی دوره‌ای نشست (فاز ۱۲، P1-1): اگر `auth_session_id`
    داده شده باشد، هر `LIVE_SESSION_REVALIDATION_SECONDS` ثانیه
    بررسی می‌شود که نشست هنوز باطل نشده است؛ باطل‌شده → رویداد خطای
    کشنده + بستن ۴۴۰۱، بدون ذخیره (مثل قطع ناگهانی). بدون نشستِ
    گره‌خورده (بلیط قدیمی/JWT بدون sid) یا بدون `session.db`، این
    بررسی انجام نمی‌شود.

    شمارنده‌ها فقط تعدادند، هرگز محتوا: در پایان نشست، قاب‌های رسیده،
    واج‌های feed/flush، رویدادهای کلمه و جاافتاده، و طول بافر مانده
    لاگ می‌شود تا «هیچ کلمه‌ای نوشته نشد» قابل تشخیص باشد.
    """
    if state_machine is None:
        # فراخوانیِ مستقیم از تست: ماشین از حالتِ listening شروع
        # می‌کند (مسیر stream_attempt آن را تا audio_ready برده است).
        state_machine = LiveSessionStateMachine()
        state_machine.force(LiveSessionState.LISTENING)
    if rate_limiter is None:
        rate_limiter = FrameRateLimiter()
    pump_task = asyncio.create_task(_pump_events(websocket, queue))
    # listening: از این لحظه، کلاینت قاب می‌فرستد.
    if state_machine.state == LiveSessionState.AUDIO_READY:
        state_machine.transition(LiveSessionState.LISTENING)
    session.emit_server_event(
        "listening",
        surah=session.surah,
        ayah=session.start_ayah,
        state=LiveSessionState.LISTENING.value,
    )
    frames_received = 0
    silent_frames = 0
    clipped_frames = 0
    frame_violations = 0
    rate_violations = 0
    rate_warned = False
    clip_warned = False
    phonemes_from_feed = 0
    phonemes_from_flush = 0
    close_reason = "disconnect"
    # بستنِ صریح با کد خطا (۴۴۰۱/۴۴۰۹/۱۰۰۹/…) + return: بلاک finally
    # نباید پس از آن دوباره close(1000) بزند و کد را بازنویسی کند
    # (روی سوکت واقعی دومی معمولاً no-op است، ولی روی سوکت ساختگی
    # — و در منطق — کدِ اول باید بماند). مسیرهای end/disconnect/cancel
    # با break خارج می‌شوند و بستنِ نهاییِ ۱۰۰۰ همان‌جا انجام می‌شود.
    _explicit_close = False
    _serve_started = time.perf_counter()
    _last_revalidated = time.monotonic()
    first_feed_ms: float | None = None
    frames_first_second = 0
    _end_reason = "end"
    # قاب‌های مانده از پیش از شروع نشست (فرستاده‌شده در فاصلهٔ انتظار)
    # رد می‌شوند و شمارشان گزارش می‌شود؛ خوراندنشان یعنی دقیقه‌ها
    # تأخیر. پیام متنیِ رسیده (مثل end) همان اولِ حلقه پردازش می‌شود،
    # نه دور ریخته.
    _dropped_pre_ready, _pending = await _collect_pre_ready_frames(websocket)
    if _dropped_pre_ready:
        logger.info(
            "hifz live session rejected pre-ready frames attempt=%s surah=%s ayah=%s "
            "dropped=%d",
            session.attempt.id,
            session.surah,
            session.start_ayah,
            _dropped_pre_ready,
        )
        session.emit_server_event(
            "warning",
            status="warning",
            code="hifz_frames_before_ready",
            message=(
                f"{_dropped_pre_ready} قاب پیش از آماده‌شدن موتور رسید و رد شد؛ "
                "خواندنِ آن بخش نمره نگرفت."
            ),
            dropped=_dropped_pre_ready,
        )
    try:
        while _pending != "disconnect":
            # فاز ۱۲، P1-1: اعتبارسنجی دوره‌ای نشست — هر ۵ دقیقه یک
            # بار (فقط وقتی زمانش رسیده باشد؛ بررسیِ monotonic ارزان
            # است و در هر تکرار انجام می‌شود). باطل‌شده → خطای کشنده +
            # بستن ۴۴۰۱، بدون ذخیره (مثل قطع ناگهانی).
            if (
                auth_session_id is not None
                and session.db is not None
                and time.monotonic() - _last_revalidated
                > LIVE_SESSION_REVALIDATION_SECONDS
            ):
                _last_revalidated = time.monotonic()
                if not await session_still_valid(session.db, auth_session_id):
                    logger.info(
                        "hifz live session revoked mid-stream attempt=%s",
                        session.attempt.id,
                    )
                    try:
                        await websocket.send_json(
                            session.build_server_event(
                                "error",
                                status="error",
                                code="hifz_session_revoked",
                                message=(
                                    "نشست شما باطل شد؛ "
                                    "برای ادامه دوباره وارد شوید."
                                ),
                                fatal=True,
                            )
                        )
                    except (WebSocketDisconnect, RuntimeError):
                        pass
                    try:
                        _explicit_close = True
                        await websocket.close(
                            code=4401, reason="session revoked"
                        )
                    except (WebSocketDisconnect, RuntimeError):
                        pass
                    return
            if _pending is not None:
                message = _pending
                _pending = None
                if not isinstance(message, dict):
                    # رشتهٔ "disconnect" به اینجا نمی‌رسد (شرط while)؛
                    # این نگه‌دارنده فقط تایپ پیام ASGI را تثبیت می‌کند.
                    continue
            elif time.perf_counter() - _serve_started > MAX_SESSION_SECONDS:
                # سقف مدت نشست: مثل end نهایی می‌شود، نه قطعِ بی‌صدا.
                _end_reason = "max_duration"
                message = {"text": json.dumps({"type": "end"})}
            else:
                try:
                    message = await websocket.receive()
                except (WebSocketDisconnect, RuntimeError):
                    close_reason = "disconnect"
                    break
            if "bytes" in message and message["bytes"] is not None:
                frame = message["bytes"]
                frame_error = validate_frame(frame)
                if frame_error is not None:
                    frame_violations += 1
                    session.emit_server_event(
                        "error",
                        status="error",
                        code=frame_error,
                        message=(
                            "قاب صوتی نامعتبر است و رد شد"
                            if frame_error == "hifz_frame_malformed"
                            else "قاب صوتی بزرگ‌تر از حد مجاز است و رد شد"
                        ),
                        fatal=False,
                        violations=frame_violations,
                    )
                    if frame_violations >= MAX_FRAME_VIOLATIONS:
                        close_reason = "error"
                        try:
                            _explicit_close = True
                            await websocket.close(
                                code=1009, reason="hifz_frame_too_large"
                            )
                        except (WebSocketDisconnect, RuntimeError):
                            pass
                        return
                    continue
                if not rate_limiter.allow():
                    rate_violations += 1
                    if not rate_warned:
                        rate_warned = True
                        session.emit_server_event(
                            "warning",
                            status="warning",
                            code="hifz_rate_limited",
                            message=(
                                "قاب‌ها سریع‌تر از حد مجاز می‌رسند؛ "
                                "نرخ ارسال را کم کن."
                            ),
                        )
                    if rate_violations >= MAX_FRAME_VIOLATIONS:
                        close_reason = "error"
                        event = session.build_server_event(
                            "error",
                            status="error",
                            code="hifz_rate_limited",
                            message="نرخ قاب بیش از حد مجاز است.",
                            fatal=True,
                        )
                        try:
                            await websocket.send_json(event)
                        except (WebSocketDisconnect, RuntimeError):
                            pass
                        try:
                            _explicit_close = True
                            await websocket.close(
                                code=4409, reason="hifz_rate_limited"
                            )
                        except (WebSocketDisconnect, RuntimeError):
                            pass
                        return
                    continue
                try:
                    frames_received += 1
                    if first_feed_ms is None:
                        first_feed_ms = (
                            time.perf_counter() - _serve_started
                        ) * 1000.0
                    if time.perf_counter() - _serve_started <= 1.0:
                        frames_first_second += 1
                    if not any(frame):
                        silent_frames += 1
                    else:
                        samples = struct.unpack(
                            f"<{len(frame) // 2}h", frame
                        )
                        if 32767 in samples or -32768 in samples:
                            clipped_frames += 1
                            if clipped_frames >= 10 and not clip_warned:
                                clip_warned = True
                                session.emit_server_event(
                                    "warning",
                                    status="warning",
                                    code="hifz_audio_clipping",
                                    message=(
                                        "صدا در چند قاب به سقف رسید "
                                        "(clipping)؛ میکروفون را دورتر بگیر."
                                    ),
                                    clipped_frames=clipped_frames,
                                )
                    if state_machine.state == LiveSessionState.LISTENING:
                        state_machine.transition(LiveSessionState.PROCESSING)
                    session.note_audio(len(frame) // 2)
                    phonemes = recognizer.feed(frame)
                    phonemes_from_feed += len(phonemes)
                    await session.feed_phonemes(phonemes)
                except APIError as exc:
                    close_reason = "error"
                    close_code = 4404 if exc.status_code == 404 else 4500
                    try:
                        await websocket.send_json(
                            session.build_server_event(
                                "error",
                                status="error",
                                code=exc.code,
                                message=exc.message,
                                fatal=True,
                            )
                        )
                    except (WebSocketDisconnect, RuntimeError) as send_exc:
                        logger.debug("hifz stream error send failed: %s", send_exc)
                    try:
                        _explicit_close = True
                        await websocket.close(code=close_code, reason=exc.code)
                    except (WebSocketDisconnect, RuntimeError) as close_exc:
                        logger.debug("hifz stream error close failed: %s", close_exc)
                    return
                except Exception:  # خطای ناشناختهٔ feed هم باید پیام خطا بشود، نه قطع بی‌صدا
                    close_reason = "error"
                    logger.exception(
                        "hifz live stream feed failed attempt=%s surah=%s ayah=%s",
                        session.attempt.id,
                        session.surah,
                        session.start_ayah,
                    )
                    try:
                        await websocket.send_json(
                            session.build_server_event(
                                "error",
                                status="error",
                                code="hifz_stream_error",
                                message="خطای داخلی در جریان زنده؛ دوباره تلاش کنید.",
                                fatal=True,
                            )
                        )
                    except (WebSocketDisconnect, RuntimeError) as send_exc:
                        logger.debug("hifz stream error send failed: %s", send_exc)
                    try:
                        _explicit_close = True
                        await websocket.close(code=1011, reason="hifz_stream_error")
                    except (WebSocketDisconnect, RuntimeError) as close_exc:
                        logger.debug("hifz stream error close failed: %s", close_exc)
                    return
                continue
            text = message.get("text")
            if text is None:
                continue
            if len(text.encode("utf-8")) > MAX_TEXT_MESSAGE_BYTES:
                session.emit_server_event(
                    "error",
                    status="error",
                    code="hifz_message_too_large",
                    message="پیام متنی بزرگ‌تر از حد مجاز است و رد شد.",
                    fatal=False,
                )
                continue
            try:
                data = json.loads(text)
            except ValueError:
                session.emit_server_event(
                    "error",
                    status="error",
                    code="unknown_message",
                    message="پیام ناشناخته",
                    fatal=False,
                )
                continue
            if not isinstance(data, dict):
                continue
            if data.get("type") == "end":
                try:
                    remaining = recognizer.flush()
                    phonemes_from_flush += len(remaining)
                    await session.feed_phonemes(remaining)
                    await session.finish()
                except APIError as exc:
                    close_reason = "error"
                    try:
                        await websocket.send_json(
                            session.build_server_event(
                                "error",
                                status="error",
                                code=exc.code,
                                message=exc.message,
                                fatal=True,
                            )
                        )
                    except (WebSocketDisconnect, RuntimeError) as send_exc:
                        logger.debug("hifz stream error send failed: %s", send_exc)
                    break
                except Exception:  # خطای ناشناختهٔ تخلیه هم باید پیام خطا بشود، نه قطع بی‌صدا
                    close_reason = "error"
                    logger.exception(
                        "hifz live stream flush failed attempt=%s surah=%s ayah=%s",
                        session.attempt.id,
                        session.surah,
                        session.start_ayah,
                    )
                    try:
                        await websocket.send_json(
                            session.build_server_event(
                                "error",
                                status="error",
                                code="hifz_stream_error",
                                message="خطای داخلی در جریان زنده؛ دوباره تلاش کنید.",
                                fatal=True,
                            )
                        )
                    except (WebSocketDisconnect, RuntimeError) as send_exc:
                        logger.debug("hifz stream error send failed: %s", send_exc)
                    break
                close_reason = _end_reason
                break
            if data.get("type") == "cancel":
                close_reason = "cancel"
                break
            session.emit_server_event(
                "error",
                status="error",
                code="unknown_message",
                message="پیام ناشناخته",
                fatal=False,
            )
    finally:
        counts = session.live_counts()
        phonemes_total = phonemes_from_feed + phonemes_from_flush
        word_events = counts["words"] + counts["skipped"]
        logger.info(
            "hifz live session ended attempt=%s surah=%s ayah=%s reason=%s "
            "frames=%d silent=%d clipped=%d phonemes_feed=%d phonemes_flush=%d words=%d skipped=%d "
            "buffer_chars=%d resync_dropped=%d located=%d audio_ms=%d "
            "first_feed_ms=%s frames_first_s=%d frame_violations=%d rate_violations=%d",
            session.attempt.id,
            session.surah,
            session.start_ayah,
            close_reason,
            frames_received,
            silent_frames,
            clipped_frames,
            phonemes_from_feed,
            phonemes_from_flush,
            counts["words"],
            counts["skipped"],
            counts["buffer_chars"],
            counts["resync_dropped"],
            counts["located"],
            session._audio_ms,
            f"{first_feed_ms:.1f}" if first_feed_ms is not None else "none",
            frames_first_second,
            frame_violations,
            rate_violations,
        )
        if frames_received > 0 and phonemes_total == 0:
            logger.warning(
                "hifz live session ended with frames but zero phonemes "
                "attempt=%s surah=%s ayah=%s frames=%d",
                session.attempt.id,
                session.surah,
                session.start_ayah,
                frames_received,
            )
        elif phonemes_total > 0 and word_events == 0:
            logger.warning(
                "hifz live session produced phonemes but zero word events "
                "attempt=%s surah=%s ayah=%s phonemes=%d buffer_chars=%d",
                session.attempt.id,
                session.surah,
                session.start_ayah,
                phonemes_total,
                counts["buffer_chars"],
            )
        final_state = (
            LiveSessionState.COMPLETED
            if close_reason in ("end", "max_duration")
            else LiveSessionState.FAILED
        )
        try:
            if state_machine.state in (
                LiveSessionState.LISTENING,
                LiveSessionState.PROCESSING,
            ):
                state_machine.transition(LiveSessionState.STOPPING)
                state_machine.transition(final_state)
            else:
                state_machine.force(final_state)
        except ValueError:
            state_machine.force(final_state)
        try:
            session.emit_server_event(
                "session_ended",
                reason=close_reason,
                state=final_state.value,
                words=counts["words"],
                skipped=counts["skipped"],
                audio_ms=session._audio_ms,
            )
        except Exception:  # پایان نشست هرگز نباید روی ساخت رویداد بمیرد
            logger.debug("hifz session_ended emit failed", exc_info=True)
        pump_task.cancel()
        # پیام final (اگر finish صدا زده شده) باید پیش از بستن برسد.
        await _drain_queue(websocket, queue)
        # سوکت پیش‌تر با کد خطای صریح بسته شده است؛ بستنِ دوباره با
        # ۱۰۰۰ کد را بازنویسی می‌کند (فاز ۱۲).
        if not _explicit_close:
            try:
                await websocket.close(code=1000, reason="done")
            except (WebSocketDisconnect, RuntimeError) as exc:
                logger.debug("hifz stream final close failed: %s", exc)


async def _pump_events(websocket, queue: asyncio.Queue) -> None:
    """رویدادهای نشست را از صف به سوکت می‌فرستد."""
    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except (asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
        return


async def _drain_queue(websocket, queue: asyncio.Queue) -> None:
    """پس از پایان حلقه، رویدادهای مانده (مثل final) را بفرست."""
    while not queue.empty():
        try:
            event = queue.get_nowait()
        except asyncio.QueueEmpty:
            break
        try:
            await websocket.send_json(event)
        except (WebSocketDisconnect, RuntimeError) as exc:
            logger.debug("hifz stream drain send failed: %s", exc)
            break
