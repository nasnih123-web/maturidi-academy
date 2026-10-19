"""تست‌های فاز ۱۷ (Track 2) — ارزیابی کیفیت RAG (eval set قطعی، بدون LLM).

مجموعهٔ ارزیابی کوچک و قطعی روی محتوای synthetic (برچسب TEST):
- پرسش شناخته‌شده → chunk موردانتظار بازیابی می‌شود (source_ref درست)
- اعتبار قالب استناد (citation format)
- پرسش خارج از KB → «نمی‌دانم» (no_sources + متن IDK_ANSWER)
- بدون LLM → llm_unavailable، بدون هیچ متن ساخته‌شده
- گیت گردش‌کار: chunkهای draft هرگز بازیابی نمی‌شوند
- گیت scope: chunk با scope=quiz در ask فتوا دیده نمی‌شود
- قطعی‌بودن: یک پرسش، دو بار → ترتیب استنادها یکسان

provider پیش‌فرض embedding از نوع hash است (قطعی) — ADR-0005.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

BASE = "/api/v1"

# واژه‌های نشانگر یکتا تا با chunkهای تست‌های دیگر تداخل نکند
MARK_ALPHA = "آلفای ارزیابی سینتتیک p17ealpha"
MARK_BETA = "بتای ارزیابی سینتتیک p17ebeta"

EVAL_CHUNKS = [
    {
        "key": "alpha",
        "chunk_text": (
            f"متن ارزیابی {MARK_ALPHA} دربارهٔ روش پاسخ‌گویی مستند است و توضیح "
            f"می‌دهد که هر پاسخ باید استناد روشن به منبع تأییدشده داشته باشد تا "
            f"مخاطب بتواند اصل مطلب را بررسی کند. {MARK_ALPHA}"
        ),
        "source_citation": {"fa": "منبع ارزیابی آلفا — TEST", "ar": "مصدر ألفا", "en": "Alpha eval source"},
        "topic_category": "p17eval_alpha",
        "ai_scopes": ["fatwa"],
        "approve": True,
    },
    {
        "key": "beta",
        "chunk_text": (
            f"متن ارزیابی {MARK_BETA} دربارهٔ اهمیت مشورت با عالم مورداعتماد در "
            f"مسائل حساس است و تأکید می‌کند پاسخ خودکار جایگزین فتوای عالم نیست. "
            f"{MARK_BETA}"
        ),
        "source_citation": {"fa": "منبع ارزیابی بتا — TEST", "ar": "مصدر بيتا", "en": "Beta eval source"},
        "topic_category": "p17eval_beta",
        "ai_scopes": ["fatwa"],
        "approve": True,
    },
    {
        "key": "draft_alpha",
        "chunk_text": (
            f"پیش‌نویس تأییدنشده دربارهٔ {MARK_ALPHA} که نباید هرگز در بازیابی "
            f"فتوا دیده شود چون وضعیتش draft است. {MARK_ALPHA}"
        ),
        "source_citation": {"fa": "پیش‌نویس ارزیابی — TEST"},
        "topic_category": "p17eval_alpha",
        "ai_scopes": ["fatwa"],
        "approve": False,  # عمداً draft می‌ماند
    },
    {
        "key": "quiz_only",
        "chunk_text": (
            f"محتوای آزمون دربارهٔ {MARK_ALPHA} که فقط scope آزمون دارد و نباید "
            f"در پاسخ فتوا بازیابی شود. {MARK_ALPHA}"
        ),
        "source_citation": {"fa": "منبع آزمون — TEST"},
        "topic_category": "p17eval_alpha",
        "ai_scopes": ["quiz"],  # عمداً بدون fatwa
        "approve": True,
    },
]


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = uuid.uuid4().hex[:8]
    async with tc["maker"]() as db:
        perms = []
        for key in permissions:
            p = (
                await db.execute(select(Permission).where(Permission.key == key))
            ).scalar_one_or_none()
            if p is None:
                p = Permission(key=key, description=key)
                db.add(p)
                await db.flush()
            perms.append(p)
        role = Role(name=f"p17_eval_role_{suffix}", description="p17 eval")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست eval",
            email=f"p17eval-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        token = create_access_token(str(user.id))
        return {"Authorization": f"Bearer {token}"}


async def _seed_eval_chunks(tc) -> dict[str, str]:
    """ساخت chunkهای ارزیابی از مسیر واقعی API + تأیید گردش‌کار §۹.
    خروجی: نگاشت key → chunk_id."""
    from app.modules.fatwa.service import reset_ai_limits

    reset_ai_limits()
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    ids: dict[str, str] = {}
    # اگر قبلاً seed شده (اجرای دوبارهٔ فایل)، دوباره نساز
    from app.models.models import FiqhKnowledgeChunk

    async with tc["maker"]() as db:
        existing = (
            await db.execute(
                select(FiqhKnowledgeChunk).where(
                    FiqhKnowledgeChunk.topic_category.in_(
                        ["p17eval_alpha", "p17eval_beta"]
                    )
                )
            )
        ).scalars().all()
        by_text = {c.chunk_text: str(c.id) for c in existing}
    for spec in EVAL_CHUNKS:
        if spec["chunk_text"] in by_text:
            ids[spec["key"]] = by_text[spec["chunk_text"]]
            continue
        r = await client.post(
            f"{BASE}/admin/fatwa/chunks",
            json={
                "chunk_text": spec["chunk_text"],
                "source_type": "manual",
                "source_citation": spec["source_citation"],
                "topic_category": spec["topic_category"],
                "ai_scopes": spec["ai_scopes"],
            },
            headers=admin,
        )
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        if spec["approve"]:
            for target in ("in_review", "approved"):
                r = await client.patch(
                    f"{BASE}/admin/fatwa/chunks/{cid}/status",
                    json={"status": target},
                    headers=admin,
                )
                assert r.status_code == 200, r.text
        ids[spec["key"]] = cid
    return ids


async def _ask(client, question: str) -> dict:
    from app.modules.fatwa.service import reset_ai_limits

    reset_ai_limits()
    r = await client.post(
        f"{BASE}/fatwa/ask",
        json={"question": question, "locale": "fa", "top_k": 5},
    )
    assert r.status_code == 200, r.text
    return r.json()


# --- پرسش شناخته‌شده → chunk موردانتظار ----------------------------------------


async def test_eval_known_question_retrieves_expected_chunk(tc):
    ids = await _seed_eval_chunks(tc)
    data = await _ask(tc["client"], f"{MARK_ALPHA} چیست؟")
    assert data["citations"], "باید حداقل یک منبع بازیابی شود"
    top_ids = [c["chunk_id"] for c in data["citations"]]
    assert ids["alpha"] in top_ids, (
        f"chunk آلفا باید بازیابی می‌شد؛ بازیابی‌شده‌ها: {top_ids}"
    )
    top = data["citations"][0]
    assert top["topic_category"] == "p17eval_alpha"
    assert "آلفا" in top["source_citation"]["fa"]
    assert data["status"] == "llm_unavailable"  # بدون کلید LLM
    assert data["answer"] is None  # هیچ متن ساخته‌شده‌ای


async def test_eval_citation_format_valid(tc):
    await _seed_eval_chunks(tc)
    data = await _ask(tc["client"], f"{MARK_BETA} چیست؟")
    assert data["citations"]
    for c in data["citations"]:
        assert set(c.keys()) == {
            "chunk_id", "excerpt", "source_citation",
            "topic_category", "madhab_scope", "score",
        }, c.keys()
        uuid.UUID(c["chunk_id"])  # شناسهٔ معتبر
        assert isinstance(c["excerpt"], str) and c["excerpt"]
        # برش ۴۰۰ کاراکتری + «…» طبق قرارداد _chunk_to_citation
        assert len(c["excerpt"]) <= 401
        assert isinstance(c["source_citation"], dict)
        assert "fa" in c["source_citation"]
        assert isinstance(c["score"], float) and c["score"] >= 0


async def test_eval_draft_chunk_never_retrieved(tc):
    """chunk با وضعیت draft — هرگز در RAG دیده نمی‌شود (§۱۰، ADR-0005)."""
    ids = await _seed_eval_chunks(tc)
    data = await _ask(tc["client"], f"پیش‌نویس تأییدنشده {MARK_ALPHA}")
    top_ids = [c["chunk_id"] for c in data["citations"]]
    assert ids["draft_alpha"] not in top_ids
    assert ids["alpha"] in top_ids  # نسخهٔ تأییدشده همان موضوع دیده می‌شود


async def test_eval_scope_gating_quiz_chunk_hidden_from_fatwa(tc):
    """chunk با scope=quiz در ask فتوا بازیابی نمی‌شود."""
    ids = await _seed_eval_chunks(tc)
    data = await _ask(tc["client"], f"محتوای آزمون {MARK_ALPHA}")
    top_ids = [c["chunk_id"] for c in data["citations"]]
    assert ids["quiz_only"] not in top_ids


async def test_eval_retrieval_deterministic(tc):
    await _seed_eval_chunks(tc)
    q = f"{MARK_ALPHA} چیست؟"
    d1 = await _ask(tc["client"], q)
    d2 = await _ask(tc["client"], q)
    assert [c["chunk_id"] for c in d1["citations"]] == [
        c["chunk_id"] for c in d2["citations"]
    ]


# --- خارج از KB → «نمی‌دانم» ----------------------------------------------------


async def test_eval_retrieve_out_of_kb_returns_empty(tc):
    """سطح retrieval: موضوعی که در KB نیست → هیچ chunkای."""
    from app.modules.fatwa.service import retrieve

    async with tc["maker"]() as db:
        chunks = await retrieve(
            db, "پرسشی دربارهٔ موضوع ناموجود p17eval",
            top_k=5, ai_scope="fatwa",
            topic_category="p17eval_nonexistent_topic",
        )
    assert chunks == []


async def test_eval_ask_no_chunks_returns_idk(tc, monkeypatch):
    """سطح ask: وقتی retrieval خالی است → no_sources با متن «نمی‌دانم»."""
    import app.modules.fatwa.service as svc

    async def _empty_retrieve(*a, **k):
        return []

    monkeypatch.setattr(svc, "retrieve", _empty_retrieve)
    svc.reset_ai_limits()

    async with tc["maker"]() as db:
        result = await svc.ask(
            db,
            question="پرسشی که در پایگاه دانش نیست xyz",
            session_id=None,
            locale="fa",
            top_k=5,
            user=None,
            client_ip="127.0.0.1",
        )
    assert result["status"] == "no_sources"
    assert result["answer"] == svc.IDK_ANSWER["fa"]
    assert "نیافتم" in result["answer"]
    assert result["citations"] == []
    # برچسب AI همیشه هست؛ هیچ متنی از LLM ساخته نشده
    assert "هوش مصنوعی" in result["ai_label"]

    # رویداد دامنه با وضعیت no_sources ثبت شده
    from app.models.models import DomainEvent

    async with tc["maker"]() as db:
        ev = (
            await db.execute(
                select(DomainEvent).where(
                    DomainEvent.event_type == "fatwa.answered",
                    DomainEvent.aggregate_id == str(result["session_id"]),
                )
            )
        ).scalar_one_or_none()
    assert ev is not None
    assert ev.payload["status"] == "no_sources"


async def test_eval_idk_answer_localized_all_locales(tc, monkeypatch):
    import app.modules.fatwa.service as svc

    async def _empty_retrieve(*a, **k):
        return []

    monkeypatch.setattr(svc, "retrieve", _empty_retrieve)
    svc.reset_ai_limits()
    for locale, needle in (("fa", "نیافتم"), ("ar", "لم أجد"), ("en", "could not find")):
        async with tc["maker"]() as db:
            result = await svc.ask(
                db, question="xyz", session_id=None, locale=locale,
                top_k=5, user=None, client_ip="127.0.0.1",
            )
        assert result["status"] == "no_sources"
        assert needle in result["answer"], locale
