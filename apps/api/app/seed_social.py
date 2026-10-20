"""Seed فاز ۱۰ — شبکهٔ اجتماعی، نظارت، پنل مؤلفین فتوا.

idempotent (قابل اجرای چندباره):
- مجوزهای social.moderate / moderation.words / fatwa.submit / fatwa.answer_cluster
- نقش scholar_author (با fatwa.submit) + اعطای fatwa.answer_cluster به نقش scholar
- کلیدهای تنظیمات: social.moderation.sla_hours (۲۴)، fatwa.cluster_match_threshold (۰.۸۲)
- ۳ گروه نمایشی + چند پست/کامنت نمایشی (مشخصاً نمایشی)
- چند واژهٔ ممنوعهٔ واقعی (نمونه‌های واقعی فیلتر، نه اغراق‌شده)
- صفحهٔ CMS «قوانین انجمن» (slug=community-guidelines، وضعیت published)
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import workflow
from app.core.platform_settings import (
    bump_settings_version,
    encode_setting_value,
    get_setting,
    stage_setting,
)
from app.models.models import (
    GroupMembership,
    ModerationBannedWord,
    Page,
    Permission,
    Role,
    RolePermission,
    SocialComment,
    SocialGroup,
    SocialPost,
    User,
)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _L(fa: str, ar: str, en: str) -> dict:
    return {"fa": fa, "ar": ar, "en": en}


PHASE10_PERMISSIONS: list[tuple[str, str]] = [
    ("social.moderate", "نظارت بر شبکهٔ اجتماعی — صف گزارش‌ها (فاز ۱۰)"),
    ("moderation.words", "مدیریت کلمات ممنوعه (فاز ۱۰)"),
    ("fatwa.submit", "ثبت فتوای رسمی — پنل مؤلفین (فاز ۱۰)"),
    ("fatwa.answer_cluster", "پاسخ به خوشه‌های سوال — مفتی (فاز ۱۰)"),
]

PHASE10_ROLE_GRANTS: dict[str, list[str]] = {
    "scholar_author": ["fatwa.submit"],
    "scholar": ["fatwa.answer_cluster"],
}

PHASE10_SETTINGS: dict[str, object] = {
    "social.moderation.sla_hours": 24,
    "fatwa.cluster_match_threshold": 0.82,
}

# نمونه‌های واقعی فیلتر فارسی — برای نمایش و تست دستی؛ تست‌های خودکار
# واژهٔ خودشان را از API ثبت می‌کنند.
DEMO_BANNED_WORDS = ["حرومزاده", "بی‌ناموس", "کثافت", "احمق"]


async def _get_or_create_role(db: AsyncSession, name: str, description: str) -> Role:
    role = (
        await db.execute(select(Role).where(Role.name == name))
    ).scalar_one_or_none()
    if not role:
        role = Role(name=name, description=description)
        db.add(role)
        await db.flush()
    return role


async def _get_or_create_permission(
    db: AsyncSession, key: str, description: str
) -> Permission:
    perm = (
        await db.execute(select(Permission).where(Permission.key == key))
    ).scalar_one_or_none()
    if not perm:
        perm = Permission(key=key, description=description)
        db.add(perm)
        await db.flush()
    return perm


async def seed_social_rbac(db: AsyncSession) -> dict:
    """مجوزها + نقش scholar_author + اعطاهای نقش‌ها (idempotent)."""
    perms: dict[str, Permission] = {}
    for key, desc in PHASE10_PERMISSIONS:
        perms[key] = await _get_or_create_permission(db, key, desc)

    roles: dict[str, Role] = {}
    for name, perm_keys in PHASE10_ROLE_GRANTS.items():
        role = await _get_or_create_role(
            db, name, "مؤلف فتوا — ثبت فتوای رسمی" if name == "scholar_author" else "عالم/مفتی"
        )
        roles[name] = role
        for key in perm_keys:
            exists = (
                await db.execute(
                    select(RolePermission).where(
                        RolePermission.role_id == role.id,
                        RolePermission.permission_id == perms[key].id,
                    )
                )
            ).first()
            if not exists:
                db.add(
                    RolePermission(
                        role_id=role.id, permission_id=perms[key].id
                    )
                )
    await db.flush()
    return {"roles": list(roles), "permissions": list(perms)}


async def seed_social_settings(db: AsyncSession) -> list[str]:
    """کلیدهای تنظیمات فاز ۱۰ — فقط کلیدِ غایب seed می‌شود."""
    seeded: list[str] = []
    for key, value in PHASE10_SETTINGS.items():
        if await get_setting(db, key) is None:
            await stage_setting(db, key, encode_setting_value("json", value, key))
            seeded.append(key)
    if seeded:
        bump_settings_version(seeded)
        await db.flush()
    return seeded


_GUIDELINES_BLOCKS: list[dict] = [
    {
        "type": "heading",
        "text": _L(
            "قوانین انجمن آکادمی ماتریدی",
            "قوانين مجتمع أكاديمية الماتريدي",
            "Maturidi Academy Community Guidelines",
        ),
    },
    {
        "type": "paragraph",
        "text": _L(
            "این شبکهٔ اجتماعی برای گفت‌وگوی علمی طلاب و علما ساخته شده است. "
            "احترام به علما، پرهیز از توهین و فحاشی، و استناد به منابع معتبر "
            "از اصول پایهٔ حضور در انجمن است.",
            "تم إنشاء هذه الشبكة الاجتماعية للحوار العلمي بين الطلاب والعلماء. "
            "احترام العلماء وتجنب الإهانة والاعتماد على مصادر موثوقة من المبادئ الأساسية.",
            "This social network is for scholarly discussion among students and scholars. "
            "Respecting scholars, avoiding insults, and citing reliable sources are core principles.",
        ),
    },
    {
        "type": "paragraph",
        "text": _L(
            "۱) محتوای توهین‌آمیز، فحش و نفرت‌پراکنی پیش از انتشار فیلتر می‌شود. "
            "۲) گزارش‌های تخلف حداکثر ظرف ۲۴ ساعت بررسی می‌شوند. "
            "۳) فتواهای رسمی فقط از مسیر پنل مؤلفین و با تأیید علما منتشر می‌شوند؛ "
            "پاسخ‌های انجمن، فتوای رسمی محسوب نمی‌شوند.",
            "١) يتم تصفية المحتوى المسيء قبل النشر. ٢) تُراجَع البلاغات خلال ٢٤ ساعة كحد أقصى. "
            "٣) تُنشَر الفتاوى الرسمية فقط عبر لوحة المؤلفين وباعتماد العلماء.",
            "1) Abusive content is filtered before publishing. 2) Reports are reviewed within 24 hours. "
            "3) Official fatwas are published only via the author panel with scholarly approval.",
        ),
    },
]


async def seed_community_guidelines(db: AsyncSession) -> str:
    """صفحهٔ CMS قوانین انجمن (slug=community-guidelines) — idempotent."""
    now = _utcnow()
    obj = (
        await db.execute(select(Page).where(Page.slug == "community-guidelines"))
    ).scalar_one_or_none()
    if obj is None:
        from app.modules.content.cms_service import DEFAULT_DISTRIBUTION

        obj = Page(
            slug="community-guidelines",
            title=_L("قوانین انجمن", "قوانين المجتمع", "Community Guidelines"),
            blocks=[dict(b) for b in _GUIDELINES_BLOCKS],
            seo_meta={"robots": "index,follow"},
            content_type="page",
            workflow_status=workflow.PUBLISHED,
            published_at=now,
            distribution=dict(DEFAULT_DISTRIBUTION),
            created_by=None,
        )
        db.add(obj)
        await db.flush()
        return "created"
    obj.title = _L("قوانین انجمن", "قوانين المجتمع", "Community Guidelines")
    obj.blocks = [dict(b) for b in _GUIDELINES_BLOCKS]
    obj.workflow_status = workflow.PUBLISHED
    await db.flush()
    return "updated"


async def seed_social_demo(db: AsyncSession, creator: User | None) -> dict:
    """گروه‌ها/پست‌های نمایشی — فقط اگر creator داده شده و گروهی نیست."""
    existing = (await db.execute(select(SocialGroup.id).limit(1))).first()
    if existing or creator is None:
        return {"groups": 0, "posts": 0}

    group_specs = [
        (
            "aqeedah-circle",
            _L("حلقهٔ درس عقیده", "حلقة درس العقيدة", "Creed Study Circle"),
            _L(
                "گروه نمایشی — گفت‌وگو دربارهٔ عقیدهٔ ماتریدی",
                "مجموعة تجريبية — حوار حول العقيدة الماتريدية",
                "Demo group — discussion on Maturidi creed",
            ),
        ),
        (
            "hanafi-fiqh",
            _L("فقه حنفی", "الفقه الحنفي", "Hanafi Fiqh"),
            _L(
                "گروه نمایشی — مباحث فقهی مذهب حنفی",
                "مجموعة تجريبية — مباحث الفقه الحنفي",
                "Demo group — Hanafi fiqh discussions",
            ),
        ),
        (
            "quran-tafsir",
            _L("قرآن و تفسیر", "القرآن والتفسير", "Quran & Tafsir"),
            _L(
                "گروه نمایشی — تدبر در آیات و تفسیر",
                "مجموعة تجريبية — تدبر الآيات والتفسير",
                "Demo group — Quranic reflection and tafsir",
            ),
        ),
    ]
    groups: list[SocialGroup] = []
    for slug, name, desc in group_specs:
        g = SocialGroup(
            name=name, description=desc, slug=slug, is_public=True,
            member_count=1, created_by=creator.id,
        )
        db.add(g)
        await db.flush()
        db.add(GroupMembership(group_id=g.id, user_id=creator.id, role="moderator"))
        groups.append(g)

    demo_posts = [
        (
            groups[0].id,
            "«پست نمایشی» — خوش آمدید به حلقهٔ درس عقیده! این پست صرفاً برای نمایش است.",
        ),
        (
            groups[1].id,
            "«پست نمایشی» — در این گروه می‌توانید مباحث فقه حنفی را مطرح کنید.",
        ),
        (
            groups[2].id,
            "«پست نمایشی» — آیهٔ امروز برای تدبر: ﴿إِنَّمَا يَخْشَى اللَّهَ مِنْ عِبَادِهِ الْعُلَمَاءُ﴾",
        ),
    ]
    posts: list[SocialPost] = []
    for group_id, body in demo_posts:
        p = SocialPost(author_id=creator.id, body=body, group_id=group_id)
        db.add(p)
        await db.flush()
        posts.append(p)
    db.add(
        SocialComment(
            post_id=posts[0].id,
            author_id=creator.id,
            body="«کامنت نمایشی» — خوشحالم که این انجمن راه‌اندازی شد.",
        )
    )
    posts[0].comment_count = 1
    await db.flush()

    words_added = 0
    for word in DEMO_BANNED_WORDS:
        exists_w = (
            await db.execute(
                select(ModerationBannedWord).where(ModerationBannedWord.word == word)
            )
        ).scalar_one_or_none()
        if not exists_w:
            db.add(ModerationBannedWord(word=word, added_by=creator.id))
            words_added += 1
    await db.flush()
    return {
        "groups": len(groups),
        "posts": len(posts),
        "banned_words": words_added,
    }


async def seed_social(db: AsyncSession, creator: User | None = None) -> dict:
    """نقطهٔ ورود seed فاز ۱۰ — از seed.py صدا زده می‌شود."""
    rbac = await seed_social_rbac(db)
    settings = await seed_social_settings(db)
    guidelines = await seed_community_guidelines(db)
    demo = await seed_social_demo(db, creator)
    return {
        "rbac": rbac,
        "settings": settings,
        "guidelines": guidelines,
        "demo": demo,
    }
