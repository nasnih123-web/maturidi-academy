"""seed نمایشی فاز ۶ — چانک‌های دانش برای تست بازیابی RAG.

**صداقت محتوا (§۱۵.۵):** هیچ حکم فقهی ساخته یا استنتاج نمی‌شود. هر chunk
یک نقل‌قول verbatim از متن‌های حقوقی واقعی ریپو
(app/modules/content/legal.py — TERMS_BLOCKS/PRIVACY_BLOCKS) است که
برنامه‌نویسی از همان ماژول خوانده می‌شود تا هیچ‌وقت از متن اصلی منحرف
نشود. هر chunk:
- source_type="demo_seed" (صریحاً نمایشی)
- source_citation واقعی (نام سند + نسخه)
- workflow_status="approved" و ai_scopes کامل — فقط برای تست retrieval
- source_library_item_ref همیشه null (رزرو فاز ۹)

موضوع‌ها (fiqh_topics) و مواضع (madhab_positions) هم فقط با متن نقل‌شده
از همین chunkها و با وضعیت draft ثبت می‌شوند — تا بازبینی عالم، عمومی
نمی‌شوند (compare فقط approved/published را نشان می‌دهد).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    FiqhKnowledgeChunk,
    FiqhTopic,
    MadhabPosition,
)
from app.modules.content.legal import (
    LEGAL_TEXT_VERSION,
    PRIVACY_BLOCKS,
    TERMS_BLOCKS,
)
from app.modules.fatwa.embeddings import HashEmbeddingProvider

TERMS_CITATION = {
    "fa": f"شرایط استفاده از آکادمی ماتریدی (نسخهٔ {LEGAL_TEXT_VERSION})",
    "ar": f"شروط استخدام أكاديمية الماتريدي (الإصدار {LEGAL_TEXT_VERSION})",
    "en": f"Maturidi Academy Terms of Use ({LEGAL_TEXT_VERSION})",
}
PRIVACY_CITATION = {
    "fa": f"سیاست حریم‌خصوصی آکادمی ماتریدی (نسخهٔ {LEGAL_TEXT_VERSION})",
    "ar": f"سياسة الخصوصية لأكاديمية الماتريدي (الإصدار {LEGAL_TEXT_VERSION})",
    "en": f"Maturidi Academy Privacy Policy ({LEGAL_TEXT_VERSION})",
}

# (بلوک terms, اندیس پاراگراف, زبان, topic_category, ai_scopes)
_DEMO_CHUNKS: list[tuple[int, int, str, str, list[str], dict]] = [
    # بند «محتوای آموزشی و فتوا» — مرتبط‌ترین chunk برای تست retrieval فتوا
    (0, 5, "fa", "fatwa_policy",
     ["fatwa", "assistant", "quiz", "verification", "semantic_search"],
     TERMS_CITATION),
    (0, 5, "ar", "fatwa_policy",
     ["fatwa", "assistant", "quiz", "verification", "semantic_search"],
     TERMS_CITATION),
    (0, 5, "en", "fatwa_policy",
     ["fatwa", "assistant", "quiz", "verification", "semantic_search"],
     TERMS_CITATION),
    # بند «مالکیت معنوی» — سیاست نقل‌قول علمی
    (0, 9, "fa", "content_policy",
     ["assistant", "verification", "semantic_search"], TERMS_CITATION),
    (0, 9, "ar", "content_policy",
     ["assistant", "verification", "semantic_search"], TERMS_CITATION),
    (0, 9, "en", "content_policy",
     ["assistant", "verification", "semantic_search"], TERMS_CITATION),
    # مقدمهٔ حریم‌خصوصی
    (1, 1, "fa", "privacy",
     ["assistant", "verification", "semantic_search"], PRIVACY_CITATION),
    (1, 1, "ar", "privacy",
     ["assistant", "verification", "semantic_search"], PRIVACY_CITATION),
    (1, 1, "en", "privacy",
     ["assistant", "verification", "semantic_search"], PRIVACY_CITATION),
    # بند «حساب کاربری» و «رفتار مجاز»
    (0, 3, "fa", "account_policy",
     ["assistant", "verification", "semantic_search"], TERMS_CITATION),
    (0, 3, "en", "account_policy",
     ["assistant", "verification", "semantic_search"], TERMS_CITATION),
    (0, 7, "fa", "acceptable_use",
     ["assistant", "verification", "semantic_search"], TERMS_CITATION),
]

_BLOCKS = {0: TERMS_BLOCKS, 1: PRIVACY_BLOCKS}


def _paragraph(block_set: int, index: int, lang: str) -> str:
    block = _BLOCKS[block_set][index]
    assert block["type"] == "paragraph", "seed نمایشی: اندیس پاراگراف جابه‌جا شده"
    return block["text"][lang]


async def seed_fatwa_demo(db: AsyncSession) -> dict[str, int]:
    """idempotent: chunk نمایشی تکراری ساخته نمی‌شود (کلید source_ref.id)."""
    provider = HashEmbeddingProvider()
    created_chunks = 0

    for block_set, index, lang, category, scopes, citation in _DEMO_CHUNKS:
        source_id = f"demo_seed_{block_set}_{index}_{lang}"
        # بررسی تکراری در پایتون (query روی JSON پرتابل نیست)
        dup = (
            await db.execute(
                select(FiqhKnowledgeChunk).where(
                    FiqhKnowledgeChunk.source_type == "demo_seed"
                )
            )
        ).scalars().all()
        if any((c.source_ref or {}).get("id") == source_id for c in dup):
            continue
        text_value = _paragraph(block_set, index, lang)
        vector = (await provider.embed([text_value]))[0]
        db.add(
            FiqhKnowledgeChunk(
                chunk_text=text_value,
                embedding=list(vector),
                source_type="demo_seed",
                source_ref={
                    "type": "seed",
                    "id": source_id,
                    "version": LEGAL_TEXT_VERSION,
                },
                source_library_item_ref=None,  # رزرو فاز ۹
                source_citation=citation,
                topic_category=category,
                madhab_scope=None,
                workflow_status="approved",
                approved_by=None,
                ai_scopes=scopes,
            )
        )
        created_chunks += 1

    # دو موضوع نمایشی — مواضع فقط نقل‌قول از chunkهای بالا، وضعیت draft
    topics_spec = [
        {
            "key": "demo_fatwa_methodology",
            "title": {
                "fa": "روش پاسخ‌گویی فقهی در آکادمی (نمایشی)",
                "ar": "منهج الإجابة الفقهية في الأكاديمية (تجريبي)",
                "en": "Fatwa methodology at the Academy (demo)",
            },
            "description": {
                "fa": "موضوع نمایشی — متن موضع، نقل‌قول از بند شرایط استفاده است؛ نه حکم فقهی.",
                "ar": "موضوع تجريبي — نص الموقف مقتبس من شروط الاستخدام.",
                "en": "Demo topic — position text quoted from the Terms of Use.",
            },
            "position_lang": "fa",
            "paragraph": (0, 5),
        },
        {
            "key": "demo_scholarly_quotation",
            "title": {
                "fa": "نقل‌قول علمی از محتوای پلتفرم (نمایشی)",
                "ar": "الاقتباس العلمي من محتوى المنصة (تجريبي)",
                "en": "Scholarly quotation from platform content (demo)",
            },
            "description": {
                "fa": "موضوع نمایشی — متن موضع، نقل‌قول از بند مالکیت معنوی است.",
                "ar": "موضوع تجريبي — نص الموقف مقتبس من بند الملكية الفكرية.",
                "en": "Demo topic — position text quoted from the IP clause.",
            },
            "position_lang": "fa",
            "paragraph": (0, 9),
        },
    ]
    created_topics = 0
    existing_topics = (await db.execute(select(FiqhTopic))).scalars().all()
    existing_titles = {
        (t.title or {}).get("fa") for t in existing_topics if t.title
    }
    for spec in topics_spec:
        if spec["title"]["fa"] in existing_titles:
            continue
        topic = FiqhTopic(
            title=spec["title"],
            description=spec["description"],
            workflow_status="draft",  # عمداً draft — تا بازبینی عالم
        )
        db.add(topic)
        await db.flush()
        quote = _paragraph(*spec["paragraph"], spec["position_lang"])
        db.add(
            MadhabPosition(
                topic_id=topic.id,
                madhab="hanafi",
                position_text={
                    "fa": quote,
                    "ar": "نص تجريبي — انظر النسخة الفارسية.",
                    "en": "Demo text — see the Persian version.",
                },
                evidence_refs=[
                    {
                        "type": "terms",
                        "version": LEGAL_TEXT_VERSION,
                        "note": "demo_seed quote — not a fiqh ruling",
                    }
                ],
                workflow_status="draft",
            )
        )
        created_topics += 1

    await db.flush()
    return {"chunks": created_chunks, "topics": created_topics}
