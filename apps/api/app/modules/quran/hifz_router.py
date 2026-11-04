"""روتر حفاظ — فاز ۳ قرآن (record-then-grade).

همهٔ مسیرها به‌جز /status نیازمند احراز هویت‌اند؛ دادهٔ هر کاربر فقط
برای خودش است (مالکیت در سرویس چک می‌شود، نه فقط با شناسه).
صوت فقط در حافظه پردازش می‌شود و هرگز ذخیره نمی‌شود.
"""

from __future__ import annotations

import asyncio
import json
import logging
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.core.realtime import _authenticate, _HandshakeRejected
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission

from . import hifz_service, hifz_stream

logger = logging.getLogger(__name__)
from .hifz_schemas import (
    HifzAdminAttemptOut,
    HifzAttemptDetailOut,
    HifzAttemptIn,
    HifzAttemptOut,
    HifzDisputeIn,
    HifzDisputeOut,
    HifzGradeOut,
    HifzPeekIn,
    HifzPeekOut,
    HifzReviewItemOut,
    HifzStatsOut,
    HifzStatusOut,
)

hifz_router = APIRouter(prefix="/api/v1/quran/hifz", tags=["quran-hifz"])

_admin_perm = require_permission("platform.settings")


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
        **await hifz_service.create_attempt(db, user, body.surah, body.page)
    )


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


@hifz_router.delete("/attempts/{attempt_id}", status_code=204)
async def delete_attempt(
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await hifz_service.delete_attempt(db, user, attempt_id)


@hifz_router.post("/attempts/{attempt_id}/grade", response_model=HifzGradeOut)
async def grade_ayah(
    attempt_id: UUID,
    surah: int = Form(ge=1, le=114),
    ayah: int = Form(ge=1, le=286),
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """نمره‌دهی یک آیه: WAV تک‌کانالهٔ ۱۶ کیلوهرتز (کاربر سمت مرورگر
    ری‌سمپل می‌کند). صوت گذراست و ذخیره نمی‌شود."""
    data = await audio.read()
    result = await hifz_service.grade_ayah(db, user, attempt_id, surah, ayah, data)
    return HifzGradeOut(**result)


@hifz_router.post("/attempts/{attempt_id}/grade-word", response_model=HifzGradeOut)
async def grade_word(
    attempt_id: UUID,
    surah: int = Form(ge=1, le=114),
    ayah: int = Form(ge=1, le=286),
    word_index: int = Form(ge=0),
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """تمرین تک‌کلمه: فقط همان یک کلمه نمره می‌گیرد."""
    data = await audio.read()
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
            db, user, attempt_id, body.surah, body.ayah, body.word_index
        )
    )


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


# ---------------------------------------------------------------------------
# خواندن زنده (WebSocket) — بازبینی فاز ۳، بخش ۱۵ سند طراحی.
#
# قرارداد پیام:
# - احراز هویت همان handshake سراسری است: بلیط یک‌بارمصرف `?ticket=`
#   (از POST /api/v1/auth/ws-ticket) یا JWT فقط در هدر Authorization.
#   `?token=<JWT>` هرگز پذیرفته نیست. ناموفق → بستن با ۴۴۰۱.
# - نخستین پیام مشتری باید JSON {"type": "start", "surah": N, "ayah": M}
#   باشد؛ جز این → خطا + بستن با ۴۴۰۰.
# - قاب‌های صوتی: باینری Int16LE تک‌کانالهٔ ۱۶ کیلوهرتز. صوت گذراست و
#   ذخیره نمی‌شود. قاب متنیِ ناشناخته → خطای unknown_message، بدون بستن.
# - سرور: {"type": "word", ...} برای هر کلمهٔ نوشته‌شده (جاافتاده هم
#   با status=skipped خاکستری می‌آید)، {"type": "extra"} برای کلمهٔ
#   اضافه، و {"type": "final", ...} پس از ذخیره.
# - مشتری {"type": "end"} بفرستد → ذخیره + پیام final + بستن ۱۰۰۰.
#   قطع ناگهانی (بدون end) چیزی ذخیره نمی‌کند.
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
    try:
        user = await _authenticate(websocket, db)
    except _HandshakeRejected:
        return
    await websocket.accept()

    async def send_error(code: str, message: str, close_code: int) -> None:
        try:
            await websocket.send_json({"type": "error", "code": code, "message": message})
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
    if not isinstance(first, dict) or first.get("type") != "start":
        await send_error("hifz_stream_start_required", "نخستین پیام باید start باشد", 4400)
        return
    try:
        surah = int(first.get("surah", 0))
        ayah = int(first.get("ayah", 0))
    except (TypeError, ValueError):
        await send_error("hifz_stream_start_required", "surah و ayah باید عدد باشند", 4400)
        return
    if not 1 <= surah <= 114 or not 1 <= ayah <= 286:
        await send_error("hifz_stream_start_required", "surah یا ayah خارج از بازه است", 4400)
        return

    queue: asyncio.Queue = asyncio.Queue()
    try:
        # دروازهٔ نگاشت، پیش از هر صوتی: بدون نگاشت تأییدشده، نشست
        # ساخته نمی‌شود و هیچ واجی به کلمه تبدیل نمی‌شود.
        mapping = hifz_stream.require_phoneme_mapping()
        session = await hifz_stream.start_live_session(
            db, user, attempt_id, surah, ayah, queue.put_nowait, mapping
        )
        recognizer = hifz_stream.SherpaPhonemeStream()
    except APIError as exc:
        close_code = 4404 if exc.status_code == 404 else 4500
        await send_error(exc.code, exc.message, close_code)
        return
    except Exception as exc:  # noqa: BLE001 — خطای ناشناختهٔ شروع هم باید پیام خطا بشود، نه قطع بی‌صدا
        await send_error("hifz_stream_error", f"خطای شروع جریان زنده: {exc}", 1011)
        return
    await serve_stream(websocket, session, recognizer, queue)


async def serve_stream(websocket, session, recognizer, queue: asyncio.Queue) -> None:
    """حلقهٔ جریان زنده — جدا شده تا با سوکتِ ساختگی آزمون شود.

    قاب باینری → واج‌های sherpa → کلمه‌های زنده؛ پیام end → تخلیهٔ
    واج‌های مانده → ذخیرهٔ نشست → پیام final → بستن ۱۰۰۰. قطع ناگهانی
    (بدون end) چیزی ذخیره نمی‌کند.
    """
    pump_task = asyncio.create_task(_pump_events(websocket, queue))
    try:
        while True:
            try:
                message = await websocket.receive()
            except (WebSocketDisconnect, RuntimeError):
                break
            if "bytes" in message and message["bytes"] is not None:
                try:
                    phonemes = recognizer.feed(message["bytes"])
                    await session.feed_phonemes(phonemes)
                except APIError as exc:
                    close_code = 4404 if exc.status_code == 404 else 4500
                    try:
                        await websocket.send_json(
                            {"type": "error", "code": exc.code, "message": exc.message}
                        )
                    except (WebSocketDisconnect, RuntimeError) as send_exc:
                        logger.debug("hifz stream error send failed: %s", send_exc)
                    try:
                        await websocket.close(code=close_code, reason=exc.code)
                    except (WebSocketDisconnect, RuntimeError) as close_exc:
                        logger.debug("hifz stream error close failed: %s", close_exc)
                    return
                continue
            text = message.get("text")
            if text is None:
                continue
            try:
                data = json.loads(text)
            except ValueError:
                await websocket.send_json(
                    {"type": "error", "code": "unknown_message", "message": "پیام ناشناخته"}
                )
                continue
            if not isinstance(data, dict):
                continue
            if data.get("type") == "end":
                try:
                    remaining = recognizer.flush()
                    await session.feed_phonemes(remaining)
                    await session.finish()
                except APIError as exc:
                    try:
                        await websocket.send_json(
                            {"type": "error", "code": exc.code, "message": exc.message}
                        )
                    except (WebSocketDisconnect, RuntimeError) as send_exc:
                        logger.debug("hifz stream error send failed: %s", send_exc)
                    break
                break
            if data.get("type") == "cancel":
                break
            await websocket.send_json(
                {"type": "error", "code": "unknown_message", "message": "پیام ناشناخته"}
            )
    finally:
        pump_task.cancel()
        # پیام final (اگر finish صدا زده شده) باید پیش از بستن برسد.
        await _drain_queue(websocket, queue)
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
