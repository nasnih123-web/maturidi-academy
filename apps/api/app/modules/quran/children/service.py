"""سرویس بخش کودکان — فاز ۴.

قراردادها:
- ویدیوها همان LibraryItemها هستند؛ این ماژول فقط پیوند سوره↔آیتم را
  نگه می‌دارد. نمای عمومی دقیقاً همان قواعد visibility کتابخانه را
  اعمال می‌کند (`library._public_base_stmt`) تا هرگز از بخش ویدیوها
  واگرا نشود.
- سؤال چندگزینه‌ای خودکار از متن کانونیک سوره ساخته می‌شود (قطعی، بدون
  ابداع متن)؛ جورکردنی خودکار ساخته نمی‌شود — معنی کلمه‌ها به واژه‌نامه
  نیاز دارد و فقط از CRM می‌آید.
- ستاره: چندگزینه‌ای ۳/۳ ← ۳ ستاره، دست‌کم یکی درست ← ۲، هیچ‌کدام ← ۱؛
  جورکردنی کامل ← ۱ ستاره. ستاره فقط در اولین کامل‌شدن هر نوع به
  پیشرفت اضافه می‌شود؛ تکرار آزمون تلاش ثبت می‌کند ولی ستاره نمی‌دهد.
- «کامل» یعنی آزمون چندگزینه‌ای انجام‌شده + جورکردنی انجام‌شده.
- روزها UTC هستند (مثل داشبورد حفاظ)؛ هدف روزانه ۳ سوره است.
"""
from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.models import (
    ChildrenProgress,
    ChildrenQuizAttempt,
    ChildrenQuizQuestion,
    ChildrenSurahVideo,
    LibraryItem,
    User,
)
from app.modules.library import service as library_service
from app.modules.quran import service as quran_service
from app.modules.quran.hifz_plan import juz_of
from app.modules.quran.recitation_timing import (
    RECITERS,
    RecitationTimingError,
    get_recitation_timing,
)
from app.modules.quran.surahs import SURAHS, get_surah
from app.modules.videos import aparat, youtube

DAILY_GOAL_SURAHS = 3
VIDEO_KINDS = ("video", "video_360")
_WEEKDAY_FA = {5: "ش", 6: "ی", 0: "د", 1: "س", 2: "چ", 3: "پ", 4: "ج"}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _validate_surah(surah: int) -> None:
    try:
        get_surah(surah)
    except ValueError:
        raise APIError(404, "surah_not_found", "سوره‌ای با این شماره وجود ندارد")


def _text(d: dict | None) -> str:
    """متن فارسی یک LocalizedText (fallback به اولین مقدار)."""
    if not isinstance(d, dict):
        return ""
    return str(d.get("fa") or d.get("ar") or d.get("en") or "")


def _lt(fa: str) -> dict:
    """LocalizedText برای متن خودکار — فارسی واقعی؛ ar/en همان متن
    (سؤال خودکار فقط فارسی تولید می‌شود؛ مدیر در CRM هر سه زبان را دارد)."""
    return {"fa": fa, "ar": fa, "en": fa}


# ---------------------------------------------------------------------------
# ویدیوهای سوره
# ---------------------------------------------------------------------------


def _video_source(item: LibraryItem) -> tuple[str, str, str | None, str | None]:
    """(kind, label, embed_url, stream_url) — همان طبقه‌بندی سرویس ویدیوها."""
    if not item.external_url:
        return "upload", "فایل", None, None
    if youtube.parse_youtube_video_id(item.external_url) is not None:
        vid = youtube.parse_youtube_video_id(item.external_url)
        return "youtube", "یوتیوب", youtube.embed_url(vid), None
    if aparat.parse_aparat_video_hash(item.external_url) is not None:
        h = aparat.parse_aparat_video_hash(item.external_url)
        return "aparat", "آپارات", aparat.embed_url(h), None
    return "direct", "لینک مستقیم", None, item.external_url


async def _video_out(db: AsyncSession, link: ChildrenSurahVideo, item: LibraryItem) -> dict:
    source, label, embed_url, stream_url = _video_source(item)
    cover_url = await library_service._signed_url(item.cover_media_key)
    if cover_url is None and source == "youtube":
        vid = youtube.parse_youtube_video_id(item.external_url or "")
        if vid is not None:
            cover_url = youtube.thumbnail_url(vid)
    return {
        "id": link.id,
        "surah": link.surah,
        "position": link.position,
        "item_id": item.id,
        "title": item.title or {},
        "source": source,
        "source_label": label,
        "external_url": item.external_url,
        "embed_url": embed_url,
        "stream_url": stream_url,
        "duration_seconds": item.duration_seconds,
        "cover_url": cover_url,
    }


async def list_surah_videos(
    db: AsyncSession, surah: int, user: User | None
) -> list[dict]:
    _validate_surah(surah)
    links = (
        await db.execute(
            select(ChildrenSurahVideo)
            .where(ChildrenSurahVideo.surah == surah)
            .order_by(
                ChildrenSurahVideo.position.asc(),
                ChildrenSurahVideo.created_at.asc(),
            )
        )
    ).scalars().all()
    if not links:
        return []
    privileged = await library_service.is_privileged(db, user)
    stmt = library_service._public_base_stmt(privileged, user).where(
        LibraryItem.id.in_([lnk.item_id for lnk in links])
    )
    visible = {it.id: it for it in (await db.execute(stmt)).scalars().all()}
    out = []
    for lnk in links:
        item = visible.get(lnk.item_id)
        if item is None:
            continue
        out.append(await _video_out(db, lnk, item))
    return out


async def link_video(
    db: AsyncSession, surah: int, item_id: uuid.UUID, position: int = 0
) -> dict:
    _validate_surah(surah)
    item = (
        await db.execute(select(LibraryItem).where(LibraryItem.id == item_id))
    ).scalar_one_or_none()
    if item is None:
        raise APIError(404, "item_not_found", "آیتم ویدیویی پیدا نشد")
    if item.kind not in VIDEO_KINDS:
        raise APIError(422, "item_not_video", "آیتم انتخاب‌شده ویدیو نیست")
    existing = (
        await db.execute(
            select(ChildrenSurahVideo).where(
                ChildrenSurahVideo.surah == surah,
                ChildrenSurahVideo.item_id == item_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise APIError(409, "video_already_linked", "این ویدیو به سوره وصل است")
    link = ChildrenSurahVideo(surah=surah, item_id=item_id, position=position)
    db.add(link)
    await db.flush()
    await db.commit()
    return await _video_out(db, link, item)


async def unlink_video(db: AsyncSession, surah: int, item_id: uuid.UUID) -> None:
    _validate_surah(surah)
    link = (
        await db.execute(
            select(ChildrenSurahVideo).where(
                ChildrenSurahVideo.surah == surah,
                ChildrenSurahVideo.item_id == item_id,
            )
        )
    ).scalar_one_or_none()
    if link is None:
        raise APIError(404, "video_not_linked", "این ویدیو به سوره وصل نیست")
    await db.delete(link)
    await db.flush()
    await db.commit()


async def reorder_videos(db: AsyncSession, surah: int, item_ids: list[uuid.UUID]) -> None:
    _validate_surah(surah)
    links = (
        await db.execute(
            select(ChildrenSurahVideo).where(ChildrenSurahVideo.surah == surah)
        )
    ).scalars().all()
    current = {lnk.item_id for lnk in links}
    if set(item_ids) != current or len(item_ids) != len(current):
        raise APIError(
            422, "order_mismatch", "فهرست باید دقیقاً همان ویدیوهای فعلی سوره باشد"
        )
    for pos, item_id in enumerate(item_ids):
        for lnk in links:
            if lnk.item_id == item_id:
                lnk.position = pos
    await db.flush()
    await db.commit()


# ---------------------------------------------------------------------------
# سؤال‌های خودکار چندگزینه‌ای (قطعی، از متن کانونیک)
# ---------------------------------------------------------------------------


def _rotate(options: list, seed: int) -> tuple[list, int]:
    """چرخش قطعی گزینه‌ها تا جواب درست همیشه اول نباشد؛ options[0] درست است."""
    k = seed % len(options)
    rotated = options[k:] + options[:k]
    return rotated, rotated.index(options[0])


_TASHKEEL = {0x064B, 0x064C, 0x064D, 0x064E, 0x064F, 0x0650, 0x0651, 0x0652, 0x0670, 0x0640}


def _bare(word: str) -> str:
    """حروف بدون تشکيل — برای مقایسهٔ مطمئن کلمه‌ها (ترتیب اعراب در متن
    عثمانی با تایپ معمولی فرق می‌کند؛ مثلاً شده روی لام دوم است)."""
    out = "".join(c for c in word if ord(c) not in _TASHKEEL)
    return out.replace("\u0671", "\u0627")


def _first_word_of_ayah1(text: str, surah: int) -> str:
    """کلمهٔ اول آیهٔ ۱ — در متن عثمانی خودمیزبان، بسمله به ابتدای آیهٔ ۱
    همهٔ سوره‌ها (به‌جز فاتحه که بسمله خودش آیهٔ ۱ است، و توبه که بسمله
    ندارد) چسبیده است؛ آن را کنار می‌گذاریم تا کلمهٔ اول واقعی سوره بماند."""
    words = text.strip().split()
    if (
        surah not in (1, 9)
        and len(words) >= 5
        and _bare(words[0]) == "بسم"
        and _bare(words[1]) == "الله"
    ):
        words = words[4:]
    return words[0] if words else ""


async def _first_words(db: AsyncSession, surahs: list[int]) -> dict[int, str]:
    """کلمهٔ اول آیهٔ ۱ هر سوره — از متن عثمانی خودمیزبان."""
    out: dict[int, str] = {}
    for n in surahs:
        bundle = await quran_service.get_surah_bundle(
            db, n, only_editions=["quran-uthmani"]
        )
        out[n] = _first_word_of_ayah1(
            bundle["ayahs"][0]["editions"][0]["text"], n
        )
    return out


async def auto_mcq_questions(db: AsyncSession, surah: int) -> list[dict]:
    """سه سؤال چندگزینه‌ای خودکار برای سوره — قطعی و تکرارپذیر."""
    _validate_surah(surah)
    meta = get_surah(surah)
    n = meta.ayahs
    name = meta.name_ar
    questions: list[dict] = []

    # ۱) تعداد آیات
    distractors = [c for c in (n - 2, n - 1, n + 1, n + 2, n + 3, n - 3) if c >= 1 and c != n][:3]
    opts = [_lt(str(n))] + [_lt(str(c)) for c in distractors]
    rotated, correct = _rotate(opts, surah)
    questions.append(
        {
            "id": f"auto-mcq-{surah}-count",
            "surah": surah,
            "question_type": "mcq",
            "source": "auto",
            "payload": {
                "question": _lt(f"سورهٔ {name} چند آیه دارد؟"),
                "options": rotated,
                "correct_index": correct,
                "explanation": _lt(f"سورهٔ {name} {n} آیه دارد."),
            },
        }
    )

    # ۲) کلمهٔ اول سوره
    others = [(surah + d - 1) % 114 + 1 for d in (1, 2, 3, 4, 5, 6)]
    firsts = await _first_words(db, [surah] + others)
    word = firsts[surah]
    wrong = []
    for other in others:
        w = firsts[other]
        if w and w != word and w not in wrong:
            wrong.append(w)
        if len(wrong) == 3:
            break
    opts = [_lt(word)] + [_lt(w) for w in wrong]
    rotated, correct = _rotate(opts, surah + 7)
    questions.append(
        {
            "id": f"auto-mcq-{surah}-first-word",
            "surah": surah,
            "question_type": "mcq",
            "source": "auto",
            "payload": {
                "question": _lt(f"سورهٔ {name} با کدام کلمه شروع می‌شود؟"),
                "options": rotated,
                "correct_index": correct,
                "explanation": _lt(f"سورهٔ {name} با کلمهٔ «{word}» شروع می‌شود."),
            },
        }
    )

    # ۳) شمارهٔ سوره در قرآن
    distractors = [c for c in (surah - 2, surah - 1, surah + 1, surah + 2) if 1 <= c <= 114][:3]
    opts = [_lt(str(surah))] + [_lt(str(c)) for c in distractors]
    rotated, correct = _rotate(opts, surah + 13)
    questions.append(
        {
            "id": f"auto-mcq-{surah}-number",
            "surah": surah,
            "question_type": "mcq",
            "source": "auto",
            "payload": {
                "question": _lt(f"سورهٔ {name} چندمین سورهٔ قرآن است؟"),
                "options": rotated,
                "correct_index": correct,
                "explanation": _lt(f"سورهٔ {name} {surah}مین سورهٔ قرآن است."),
            },
        }
    )
    return questions


def _validate_payload(question_type: str, payload: dict) -> None:
    """شکل payload سؤال CRM — نامعتبر ۴۲۲."""
    if question_type == "mcq":
        q = payload.get("question")
        options = payload.get("options")
        correct = payload.get("correct_index")
        if not isinstance(q, dict) or not _text(q):
            raise APIError(422, "invalid_payload", "سؤال چندگزینه‌ای باید question داشته باشد")
        if not isinstance(options, list) or len(options) < 2:
            raise APIError(422, "invalid_payload", "سؤال چندگزینه‌ای دست‌کم ۲ گزینه می‌خواهد")
        if any(not isinstance(o, dict) or not _text(o) for o in options):
            raise APIError(422, "invalid_payload", "همهٔ گزینه‌ها باید متن داشته باشند")
        if not isinstance(correct, int) or not 0 <= correct < len(options):
            raise APIError(422, "invalid_payload", "correct_index نامعتبر است")
        return
    if question_type == "matching":
        pairs = payload.get("pairs")
        if not isinstance(pairs, list) or len(pairs) < 2:
            raise APIError(422, "invalid_payload", "جورکردنی دست‌کم ۲ جفت می‌خواهد")
        for pair in pairs:
            if not isinstance(pair, dict):
                raise APIError(422, "invalid_payload", "هر جفت باید word و meaning داشته باشد")
            if not pair.get("word") or not isinstance(pair.get("meaning"), dict):
                raise APIError(422, "invalid_payload", "هر جفت باید word و meaning داشته باشد")
            if not _text(pair["meaning"]):
                raise APIError(422, "invalid_payload", "meaning هر جفت باید متن داشته باشد")
        return
    raise APIError(422, "invalid_question_type", "نوع سؤال باید mcq یا matching باشد")


async def list_questions(
    db: AsyncSession, surah: int, question_type: str | None = None
) -> list[dict]:
    _validate_surah(surah)
    out: list[dict] = []
    if question_type in (None, "mcq"):
        out.extend(await auto_mcq_questions(db, surah))
    stmt = (
        select(ChildrenQuizQuestion)
        .where(
            ChildrenQuizQuestion.surah == surah,
            ChildrenQuizQuestion.is_active.is_(True),
        )
        .order_by(ChildrenQuizQuestion.created_at.asc())
    )
    if question_type in ("mcq", "matching"):
        stmt = stmt.where(ChildrenQuizQuestion.question_type == question_type)
    for row in (await db.execute(stmt)).scalars().all():
        out.append(
            {
                "id": str(row.id),
                "surah": row.surah,
                "question_type": row.question_type,
                "source": row.source,
                "payload": row.payload,
            }
        )
    return out


async def _resolve_questions(
    db: AsyncSession, surah: int, question_type: str, answers: dict
) -> list[dict]:
    """سؤال‌های ارجاع‌شده در answers را حل کن؛ شناسهٔ ناشناخته ۴۲۲."""
    available = {
        q["id"]: q for q in await list_questions(db, surah, question_type)
    }
    resolved = []
    for qid in answers:
        q = available.get(str(qid))
        if q is None:
            raise APIError(422, "unknown_question", "شناسهٔ سؤال ناشناخته است")
        resolved.append(q)
    return resolved


def _score_mcq(question: dict, answer: object) -> bool:
    return isinstance(answer, int) and answer == question["payload"]["correct_index"]


def _score_matching(question: dict, answer: object) -> bool:
    """همهٔ جفت‌ها درست باشند — answer: {word: meaning}."""
    if not isinstance(answer, dict):
        return False
    pairs = question["payload"].get("pairs") or []
    if not pairs:
        return False
    for pair in pairs:
        given = answer.get(pair["word"])
        if given is None or str(given).strip() != _text(pair["meaning"]).strip():
            return False
    return True


def _mcq_stars(correct: int, total: int) -> int:
    if total <= 0:
        return 0
    if correct >= total:
        return 3
    if correct >= 1:
        return 2
    return 1


async def _get_or_create_progress(
    db: AsyncSession, user: User, surah: int
) -> ChildrenProgress:
    row = (
        await db.execute(
            select(ChildrenProgress).where(
                ChildrenProgress.user_id == user.id,
                ChildrenProgress.surah == surah,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = ChildrenProgress(user_id=user.id, surah=surah)
        db.add(row)
        await db.flush()
    return row


def _refresh_status(row: ChildrenProgress) -> None:
    if row.quiz_done and row.match_done:
        row.status = "completed"
    else:
        row.status = "learning"


async def submit_quiz(
    db: AsyncSession,
    user: User,
    surah: int,
    question_type: str,
    answers: dict,
) -> dict:
    _validate_surah(surah)
    if question_type not in ("mcq", "matching"):
        raise APIError(422, "invalid_question_type", "نوع سؤال باید mcq یا matching باشد")
    if not answers:
        raise APIError(422, "empty_answers", "پاسخی نفرستاده‌اید")
    resolved = await _resolve_questions(db, surah, question_type, answers)
    score_fn = _score_mcq if question_type == "mcq" else _score_matching
    correct = sum(1 for q in resolved if score_fn(q, answers.get(q["id"])))
    total = len(resolved)
    if question_type == "mcq":
        stars = _mcq_stars(correct, total)
    else:
        stars = 1 if correct >= total > 0 else 0

    progress = await _get_or_create_progress(db, user, surah)
    first_done_flag = "quiz_done" if question_type == "mcq" else "match_done"
    already_done = getattr(progress, first_done_flag)
    stars_added = 0
    if not already_done and stars > 0:
        stars_added = stars
        progress.stars += stars
        setattr(progress, first_done_flag, True)
    _refresh_status(progress)

    attempt = ChildrenQuizAttempt(
        user_id=user.id,
        surah=surah,
        question_type=question_type,
        question_ids=[q["id"] for q in resolved],
        answers={str(k): v for k, v in answers.items()},
        correct_count=correct,
        total=total,
        stars=stars,
    )
    db.add(attempt)
    await db.flush()
    await db.commit()
    return {
        "correct_count": correct,
        "total": total,
        "stars": stars,
        "stars_added": stars_added,
        "completed": progress.status == "completed",
    }


# ---------------------------------------------------------------------------
# پیشرفت و داشبورد
# ---------------------------------------------------------------------------


def _progress_out(row: ChildrenProgress) -> dict:
    return {
        "surah": row.surah,
        "stars": row.stars,
        "status": row.status,
        "last_ayah": row.last_ayah,
        "listened_ayahs": row.listened_ayahs,
        "quiz_done": row.quiz_done,
        "match_done": row.match_done,
        "updated_at": row.updated_at,
    }


async def record_listen(
    db: AsyncSession, user: User, surah: int, last_ayah: int
) -> dict:
    _validate_surah(surah)
    meta = get_surah(surah)
    if last_ayah > meta.ayahs:
        raise APIError(422, "ayah_out_of_range", "شمارهٔ آیه از سوره بزرگ‌تر است")
    row = await _get_or_create_progress(db, user, surah)
    row.last_ayah = last_ayah
    row.listened_ayahs = max(row.listened_ayahs, last_ayah)
    _refresh_status(row)
    await db.flush()
    await db.commit()
    return _progress_out(row)


async def get_progress(db: AsyncSession, user: User) -> list[dict]:
    rows = (
        await db.execute(
            select(ChildrenProgress)
            .where(ChildrenProgress.user_id == user.id)
            .order_by(ChildrenProgress.surah.asc())
        )
    ).scalars().all()
    return [_progress_out(r) for r in rows]


def _streak(active_days: set[date], today: date) -> tuple[int, int]:
    """(پیوستگی فعلی، بهترین پیوستگی) — روز فعال = هر فعالیتی در آن روز."""
    if not active_days:
        return 0, 0
    current = 0
    day = today
    if day not in active_days:
        day = today - timedelta(days=1)
    while day in active_days:
        current += 1
        day -= timedelta(days=1)
    best = 0
    run = 0
    day = min(active_days)
    while day <= today:
        if day in active_days:
            run += 1
            best = max(best, run)
        else:
            run = 0
        day += timedelta(days=1)
    return current, best


async def dashboard(db: AsyncSession, user: User) -> dict:
    today = datetime.now(UTC).date()
    rows = (
        await db.execute(
            select(ChildrenProgress)
            .where(ChildrenProgress.user_id == user.id)
            .order_by(ChildrenProgress.updated_at.desc())
        )
    ).scalars().all()
    attempts = (
        await db.execute(
            select(ChildrenQuizAttempt).where(ChildrenQuizAttempt.user_id == user.id)
        )
    ).scalars().all()

    active_days: set[date] = set()
    for row in rows:
        if row.updated_at is not None:
            active_days.add(row.updated_at.date())
    for att in attempts:
        if att.created_at is not None:
            active_days.add(att.created_at.date())

    by_surah = {r.surah: r for r in rows}
    today_rows = [
        r for r in rows if r.updated_at is not None and r.updated_at.date() == today
    ]
    today_surahs = [
        {
            "surah": r.surah,
            "name_ar": get_surah(r.surah).name_ar,
            "name_en": get_surah(r.surah).name_en,
            "stars": r.stars,
        }
        for r in sorted(today_rows, key=lambda r: r.surah)
    ]
    streak_current, streak_best = _streak(active_days, today)
    week: list[dict] = []
    for delta in range(6, -1, -1):
        day = today - timedelta(days=delta)
        week.append(
            {
                "date": day.isoformat(),
                "label": _WEEKDAY_FA[day.weekday()],
                "active": day in active_days,
                "is_today": day == today,
            }
        )

    learning = [r for r in rows if r.status == "learning"]
    weak = sorted(learning, key=lambda r: (r.stars, r.updated_at or r.created_at))
    weak_surahs = [
        {
            "surah": r.surah,
            "name_ar": get_surah(r.surah).name_ar,
            "name_en": get_surah(r.surah).name_en,
            "stars": r.stars,
            "last_ayah": r.last_ayah,
        }
        for r in weak[:5]
    ]
    continue_row = learning[0] if learning else None
    continue_surah = None
    if continue_row is not None:
        meta = get_surah(continue_row.surah)
        continue_surah = {
            "surah": continue_row.surah,
            "name_ar": meta.name_ar,
            "name_en": meta.name_en,
            "ayahs": meta.ayahs,
            "last_ayah": continue_row.last_ayah,
            "stars": continue_row.stars,
        }

    juz_progress: list[dict] = []
    continue_juz = juz_of(continue_row.surah, 1) if continue_row is not None else None
    for juz in range(1, 31):
        members = [m for m in SURAHS if juz_of(m.number, 1) == juz]
        completed = sum(
            1 for m in members if by_surah.get(m.number) is not None and by_surah[m.number].status == "completed"
        )
        started = sum(1 for m in members if m.number in by_surah)
        if completed == len(members) and members:
            state = "done"
        elif juz == continue_juz:
            state = "current"
        elif started > 0:
            state = "started"
        else:
            state = "locked"
        juz_progress.append(
            {
                "juz": juz,
                "total_surahs": len(members),
                "completed_surahs": completed,
                "started_surahs": started,
                "state": state,
            }
        )

    total_stars = sum(r.stars for r in rows)
    learned_count = sum(1 for r in rows if r.status == "completed")
    goal_today = len(today_rows)
    return {
        "total_stars": total_stars,
        "learned_count": learned_count,
        "streak_current": streak_current,
        "streak_best": streak_best,
        "goal_surahs": DAILY_GOAL_SURAHS,
        "goal_today_surahs": goal_today,
        "goal_met": goal_today >= DAILY_GOAL_SURAHS,
        "today_surahs": today_surahs,
        "week": week,
        "weak_surahs": weak_surahs,
        "continue_surah": continue_surah,
        "juz_progress": juz_progress,
        "progress": [_progress_out(r) for r in sorted(rows, key=lambda r: r.surah)],
    }


# ---------------------------------------------------------------------------
# بستهٔ آفلاین (مانیفست — بایت‌ها از همان منابع آنلاین کش می‌شوند)
# ---------------------------------------------------------------------------


async def offline_pack(db: AsyncSession, surah: int, reciter: str) -> dict:
    """مانیفست دانلود یک سوره: متن خودمیزبان + فایل صوتی کامل سوره +
    سگمنت‌های کلمه (اگر در دسترس باشند). صوت باندل/می‌رور نمی‌شود؛
    کلاینت همان URL را دانلود و کش می‌کند."""
    _validate_surah(surah)
    if reciter not in RECITERS:
        raise APIError(422, "unknown_reciter", "قاری شناخته‌شده نیست")
    bundle = await quran_service.get_surah_bundle(
        db, surah, only_editions=["quran-uthmani"]
    )
    ayahs = []
    for item in bundle["ayahs"]:
        text = ""
        for edition in item["editions"]:
            if edition["edition"] == "quran-uthmani":
                text = edition["text"]
                break
        ayahs.append({"number": item["ayah"], "text": text})
    timing = None
    audio_url = None
    try:
        timing = await get_recitation_timing(reciter, surah)
        audio_url = timing.get("audio_url")
    except RecitationTimingError:
        timing = None
    return {
        "surah": surah,
        "reciter": reciter,
        "audio_url": audio_url,
        "timing_available": timing is not None,
        "timing": timing,
        "ayahs": ayahs,
    }


def whole_quran_pack(reciter: str) -> dict:
    """مانیفست کل قرآن: فهرست ۱۱۴ بستهٔ تک‌سوره با همان قاری."""
    if reciter not in RECITERS:
        raise APIError(422, "unknown_reciter", "قاری شناخته‌شده نیست")
    return {
        "reciter": reciter,
        "surahs": [
            {
                "surah": m.number,
                "name_ar": m.name_ar,
                "pack_url": (
                    "/api/v1/quran/children/offline-pack"
                    f"?surah={m.number}&reciter={reciter}"
                ),
            }
            for m in SURAHS
        ],
    }


# ---------------------------------------------------------------------------
# مدیریت سؤال‌ها (CRM)
# ---------------------------------------------------------------------------


async def create_question(
    db: AsyncSession,
    user: User,
    surah: int,
    question_type: str,
    payload: dict,
    is_active: bool = True,
) -> dict:
    _validate_surah(surah)
    _validate_payload(question_type, payload)
    row = ChildrenQuizQuestion(
        surah=surah,
        question_type=question_type,
        source="crm",
        payload=payload,
        is_active=is_active,
        created_by=user.id,
    )
    db.add(row)
    await db.flush()
    await db.commit()
    return {
        "id": str(row.id),
        "surah": row.surah,
        "question_type": row.question_type,
        "source": row.source,
        "payload": row.payload,
        "is_active": row.is_active,
    }


async def list_admin_questions(
    db: AsyncSession, surah: int | None = None
) -> list[dict]:
    stmt = select(ChildrenQuizQuestion).order_by(
        ChildrenQuizQuestion.surah.asc(), ChildrenQuizQuestion.created_at.asc()
    )
    if surah is not None:
        _validate_surah(surah)
        stmt = stmt.where(ChildrenQuizQuestion.surah == surah)
    out = []
    for row in (await db.execute(stmt)).scalars().all():
        out.append(
            {
                "id": str(row.id),
                "surah": row.surah,
                "question_type": row.question_type,
                "source": row.source,
                "payload": row.payload,
                "is_active": row.is_active,
            }
        )
    return out


async def update_question(
    db: AsyncSession,
    question_id: uuid.UUID,
    payload: dict | None,
    is_active: bool | None,
) -> dict:
    row = (
        await db.execute(
            select(ChildrenQuizQuestion).where(ChildrenQuizQuestion.id == question_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise APIError(404, "question_not_found", "سؤال پیدا نشد")
    if payload is not None:
        _validate_payload(row.question_type, payload)
        row.payload = payload
    if is_active is not None:
        row.is_active = is_active
    await db.flush()
    await db.commit()
    return {
        "id": str(row.id),
        "surah": row.surah,
        "question_type": row.question_type,
        "source": row.source,
        "payload": row.payload,
        "is_active": row.is_active,
    }


async def delete_question(db: AsyncSession, question_id: uuid.UUID) -> None:
    """حذف نرم — غیرفعال‌کردن؛ تلاش‌های ثبت‌شده دست‌نخورده می‌مانند."""
    row = (
        await db.execute(
            select(ChildrenQuizQuestion).where(ChildrenQuizQuestion.id == question_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise APIError(404, "question_not_found", "سؤال پیدا نشد")
    row.is_active = False
    await db.flush()
    await db.commit()
