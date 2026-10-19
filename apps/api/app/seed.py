"""بوت‌استرپ اولیه — فاز ۱.

ایجاد نقش‌ها و مجوزهای پایه، اولین super_admin (از متغیرهای محیطی
ADMIN_EMAIL / ADMIN_PHONE / ADMIN_PASSWORD) و seed تنظیمات پیش‌فرض پلتفرم.

اجرا:  python -m app.seed   (بعد از alembic upgrade head)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.database import engine
from app.core.platform_settings import (
    bump_settings_version,
    encode_setting_value,
    get_setting,
    stage_setting,
)
from app.core.secrets import encrypt_value
from app.core.security import hash_password
from app.modules.content.cms_service import ensure_calendar_settings, seed_legal_pages
from app.models.models import (
    HomeSection,
    Permission,
    PlatformSetting,
    Role,
    RolePermission,
    Theme,
    User,
    UserRole,
)

# مجوزهای پایه — با رشد فازها تکمیل می‌شود
BASE_PERMISSIONS = [
    ("users.manage", "مدیریت کاربران"),
    ("roles.manage", "مدیریت نقش‌ها و مجوزها"),
    ("content.publish", "انتشار محتوا"),
    ("fatwa.approve", "تأیید فتوا"),
    ("settings.manage", "مدیریت تنظیمات پلتفرم"),
    ("platform.settings", "تنظیمات پلتفرم — فقط super_admin (فاز ۲)"),
    ("realtime.admin", "اشتراک کانال‌های مدیریتی بلادرنگ (فاز ۲)"),
    ("media.manage", "مدیریت رسانه"),
    ("finance.manage", "مدیریت مالی"),
    ("knowledge.manage", "مدیریت پایگاه دانش فتوا (فاز ۶)"),
    ("calculators.manage", "مدیریت پیکربندی ماشین‌حساب‌های ارث/زکات (فاز ۷)"),
    ("calculators.approve", "تأیید پیکربندی ماشین‌حساب‌ها — عالم (فاز ۷)"),
    ("lms.manage", "مدیریت LMS — دوره‌ها، درس‌ها، هم‌گروهی‌ها (فاز ۸)"),
    ("library.manage", "مدیریت کتابخانهٔ چندرسانه‌ای — آپلود، نسخه، گردش‌کار، ایندکس AI (فاز ۹)"),
    ("social.moderate", "نظارت بر شبکهٔ اجتماعی — صف گزارش‌ها (فاز ۱۰)"),
    ("moderation.words", "مدیریت کلمات ممنوعه (فاز ۱۰)"),
    ("fatwa.submit", "ثبت فتوای رسمی — پنل مؤلفین (فاز ۱۰)"),
    ("fatwa.answer_cluster", "پاسخ به خوشه‌های سوال — مفتی (فاز ۱۰)"),
    ("places.manage", "مدیریت اماکن مذهبی — نقشهٔ زنده (فاز ۱۱)"),
    ("telegram.manage", "مدیریت تلگرام — بات، اتصال حساب، درون‌ریزی، توزیع (فاز ۱۱)"),
    ("api_keys.manage", "مدیریت کلیدهای API ویجت‌ها (فاز ۱۱)"),
    ("voice.manage", "مدیریت دستیار صوتی — تنظیمات STT/TTS و لاگ مصرف (فاز ۱۲)"),
]

BASE_ROLES = [
    ("super_admin", "مدیر ارشد — همهٔ مجوزها"),
    ("admin", "مدیر — بدون مدیریت نقش‌ها"),
    ("scholar", "عالم/مفتی — فتوا و محتوا"),
    ("scholar_author", "مؤلف فتوا — ثبت فتوای رسمی (فاز ۱۰)"),
    ("user", "کاربر عادی"),
]


def _L(fa: str, ar: str, en: str) -> dict:
    """LocalizedText — قرارداد §۱۵.۴: هرگز متن قابل‌مشاهده هاردکدِ تک‌زبانه نیست."""
    return {"fa": fa, "ar": ar, "en": en}


_SOON = {
    "empty_title": _L("به‌زودی", "قريباً", "Coming soon"),
    "empty_hint": _L(
        "این بخش به‌زودی فعال می‌شود.",
        "سيتم تفعيل هذا القسم قريباً.",
        "This section will be available soon.",
    ),
}

# seed بخش‌های خانه — فاز ۳. ترتیب sort_order همان ترتیب نمایش است.
# بخش‌هایی که ماژول‌شان هنوز در فازهای بعد ساخته نشده: data=null + پیام «به‌زودی».
HOME_SECTIONS_SEED: list[dict] = [
    {
        "key": "hero",
        "sort_order": 1,
        "title": _L("آکادمی ماتریدی", "أكاديمية الماتريدي", "Maturidi Academy"),
        "subtitle": _L(
            "آموزش اصیل اسلامی؛ از عقیده تا عمل",
            "تعليم إسلامي أصيل؛ من العقيدة إلى العمل",
            "Authentic Islamic learning — from creed to practice",
        ),
        "data": {"search_enabled": True},
    },
    {
        "key": "live_status",
        "sort_order": 2,
        "title": _L("پخش زنده", "البث المباشر", "Live Now"),
        "subtitle": _L(
            "کلاس‌ها و برنامه‌های زندهٔ آکادمی",
            "دروس الأكاديمية وبرامجها المباشرة",
            "Academy live classes and programs",
        ),
        "data": None,
        **_SOON,
    },
    {
        "key": "latest_fatwas",
        "sort_order": 3,
        "title": _L("تازه‌ترین فتواها", "أحدث الفتاوى", "Latest Fatwas"),
        "subtitle": _L(
            "پاسخ‌های شرعی علمای آکادمی",
            "أجوبة العلماء الشرعية",
            "Scholarly answers from the academy",
        ),
        "data": None,
        **_SOON,
    },
    {
        "key": "quran_of_day",
        "sort_order": 4,
        "title": _L("آیهٔ روز", "آية اليوم", "Verse of the Day"),
        "subtitle": _L(
            "آیه‌ای برای تأمل روزانه",
            "آية للتأمل اليومي",
            "A verse for daily reflection",
        ),
        "data": None,
        **_SOON,
    },
    {
        "key": "suggested_lessons",
        "sort_order": 5,
        "title": _L("درس‌های پیشنهادی", "دروس مقترحة", "Suggested Lessons"),
        "subtitle": _L(
            "مسیر یادگیری متناسب با شما",
            "مسار تعلم يناسبك",
            "A learning path tailored for you",
        ),
        "data": None,
        **_SOON,
    },
    {
        "key": "fresh_library",
        "sort_order": 6,
        "title": _L("تازه‌های کتابخانه", "جديد المكتبة", "New in the Library"),
        "subtitle": _L(
            "کتاب‌ها و منابع تازه منتشرشده",
            "كتب وموارد منشورة حديثاً",
            "Recently published books and resources",
        ),
        "data": None,
        **_SOON,
    },
    {
        "key": "community",
        "sort_order": 7,
        "title": _L("جامعه", "المجتمع", "Community"),
        "subtitle": _L(
            "همراه با دیگر دانشجویان",
            "مع بقية الطلاب",
            "Learn alongside fellow students",
        ),
        "data": None,
        **_SOON,
    },
    {
        "key": "nearby_map",
        "sort_order": 8,
        "title": _L("نقشهٔ نزدیک", "الخريطة القريبة", "Nearby Map"),
        "subtitle": _L(
            "مساجد و مراکز آموزشی نزدیک شما",
            "المساجد والمراكز التعليمية القريبة منك",
            "Mosques and learning centers near you",
        ),
        "data": None,
        **_SOON,
    },
    {
        "key": "donation_banner",
        "sort_order": 9,
        "title": _L("حمایت از آکادمی", "ادعم الأكاديمية", "Support the Academy"),
        "subtitle": _L(
            "با حمایت شما، آموزش رایگان می‌ماند",
            "بدعمكم يبقى التعليم مجانياً",
            "Your support keeps learning free",
        ),
        "data": {"cta_url": "/donate"},  # مسیر فازهای بعد — فعلاً بی‌اثر
    },
    {
        "key": "footer",
        "sort_order": 10,
        "title": _L("آکادمی ماتریدی", "أكاديمية الماتريدي", "Maturidi Academy"),
        "subtitle": None,
        "data": None,
    },
]


async def seed_home_sections(db: AsyncSession) -> None:
    """upsert idempotent بخش‌های خانه بر اساس key.

    روی رکورد موجود: عنوان/زیرعنوان/داده/empty و sort_order به‌روز می‌شود،
    ولی `visible` دست نخورده می‌ماند (ادمین ممکن است بخشی را پنهان کرده باشد).
    """
    for spec in HOME_SECTIONS_SEED:
        row = (
            await db.execute(select(HomeSection).where(HomeSection.key == spec["key"]))
        ).scalar_one_or_none()
        if row is None:
            row = HomeSection(key=spec["key"], visible=True)
            db.add(row)
        row.sort_order = spec["sort_order"]
        row.title = spec["title"]
        row.subtitle = spec.get("subtitle")
        row.data = spec.get("data")
        row.empty_title = spec.get("empty_title")
        row.empty_hint = spec.get("empty_hint")
    await db.flush()


async def seed_platform_settings_defaults(db: AsyncSession) -> list[str]:
    """مقداردهی اولیهٔ idempotent کلیدهای polish (Track A) — فقط کلیدِ غایب seed می‌شود.

    - particles: پیش‌فرض ذرات مشترک وب/CRM
    - fonts.<locale>: ‏null = فونت داخلی (Vazirmatn/Cairo/Inter)
    - home.sections: اسلات‌های زیرِ هیرو به ترتیب فعلی seed بخش‌ها
    - hero.<locale>: کپی فعلی هیروی وب (از apps/web/messages + seed بخش hero)
    - quran.*: provider فعال، ترجمه‌ها/تفسیرها/قاری‌ها، زبان‌های فعال،
      نمایش ترجمه/تفسیر، حالت هایلایت، اندازهٔ فونت، رفتار پخش (فاز ۵)
    - munajat.*: فعال‌بودن مناجات شبانه و پنجرهٔ زمانی آن (فاز ۵)
    """
    defaults: dict[str, Any] = {
        "particles": {
            "enabled": True,
            "count": 100,
            "speed": 1.0,
            "parallax": 1.0,
            "lines": True,
        },
        "fonts.fa": None,
        "fonts.ar": None,
        "fonts.en": None,
        "home.sections": [
            {"id": key, "variant": key, "enabled": True}
            for key in (
                "live_status",
                "latest_fatwas",
                "quran_of_day",
                "suggested_lessons",
                "fresh_library",
                "community",
                "nearby_map",
                "donation_banner",
                "footer",
            )
        ],
        "hero.fa": {
            "title": "آکادمی ماتریدی",
            "subtitle": "آموزش اصیل اسلامی؛ از عقیده تا عمل",
            "primary_cta": {"label": "شروع یادگیری", "href": "/fa/courses"},
            "secondary_cta": {"label": "مشاهدهٔ کتابخانه", "href": "/fa/library"},
        },
        "hero.ar": {
            "title": "أكاديمية الماتريدي",
            "subtitle": "تعليم إسلامي أصيل؛ من العقيدة إلى العمل",
            "primary_cta": {"label": "ابدأ التعلم", "href": "/ar/courses"},
            "secondary_cta": {"label": "تصفح المكتبة", "href": "/ar/library"},
        },
        "hero.en": {
            "title": "Maturidi Academy",
            "subtitle": "Authentic Islamic learning — from creed to practice",
            "primary_cta": {"label": "Start learning", "href": "/en/courses"},
            "secondary_cta": {"label": "Browse library", "href": "/en/library"},
        },
        # --- فاز ۵ (Track 1): قرآن / مناجات ---
        "quran.provider": "alquran_cloud",
        "quran.translations": ["en.sahih", "fa.makarem"],
        "quran.tafsirs": ["ar.muyassar"],
        "quran.reciters": ["ar.alafasy"],
        "quran.active_languages": ["fa", "ar", "en"],
        "quran.show_translation": True,
        "quran.show_tafsir": True,
        "quran.highlight_mode": "ayah",
        "quran.font_size": 20,
        "quran.playback": {"autoplay": False, "repeat": "off"},
        "munajat.enabled": True,
        "munajat.window": {"start": "02:00", "end": "05:00"},
        "adhan.defaults": {"calculation_method": "mwl", "madhab": "shafi"},
        # --- فاز ۶: موتور فتوای هوشمند ---
        "ai.provider": "none",
        "ai.claude_model": "claude-sonnet-4-5",
        "ai.claude_model": "claude-sonnet-4-5",
        "ai.daily_quota_per_user": 20,
        "ai.rate_per_minute": 5,
        "ai.external_research_enabled": False,
        "ai.stream_timeout_s": 60,
        "ai.embedding_provider": "hash",
        "ai.embedding_endpoint": None,
        "ai.embedding_model": None,
        # --- فاز ۹: کتابخانهٔ چندرسانه‌ای ---
        "media.auto_pipeline": True,  # صف خودکار transcribe/OCR پس از آپلود
        "media.ocr_langs": "fas+ara+eng",
    }
    seeded: list[str] = []
    for key, value in defaults.items():
        if await get_setting(db, key) is None:
            await stage_setting(db, key, encode_setting_value("json", value, key))
            seeded.append(key)
    if seeded:
        bump_settings_version(seeded)
        await db.flush()
    return seeded
    """upsert idempotent بخش‌های خانه بر اساس key.

    روی رکورد موجود: عنوان/زیرعنوان/داده/empty و sort_order به‌روز می‌شود،
    ولی `visible` دست نخورده می‌ماند (ادمین ممکن است بخشی را پنهان کرده باشد).
    """
    for spec in HOME_SECTIONS_SEED:
        row = (
            await db.execute(select(HomeSection).where(HomeSection.key == spec["key"]))
        ).scalar_one_or_none()
        if row is None:
            row = HomeSection(key=spec["key"], visible=True)
            db.add(row)
        row.sort_order = spec["sort_order"]
        row.title = spec["title"]
        row.subtitle = spec.get("subtitle")
        row.data = spec.get("data")
        row.empty_title = spec.get("empty_title")
        row.empty_hint = spec.get("empty_hint")
    await db.flush()


async def _get_or_create_role(db: AsyncSession, name: str, description: str) -> Role:
    role = (await db.execute(select(Role).where(Role.name == name))).scalar_one_or_none()
    if not role:
        role = Role(name=name, description=description)
        db.add(role)
        await db.flush()
    return role


async def _get_or_create_permission(db: AsyncSession, key: str, description: str) -> Permission:
    perm = (
        await db.execute(select(Permission).where(Permission.key == key))
    ).scalar_one_or_none()
    if not perm:
        perm = Permission(key=key, description=description)
        db.add(perm)
        await db.flush()
    return perm


async def main() -> None:
    email = os.environ.get("ADMIN_EMAIL", "").strip() or None
    phone = os.environ.get("ADMIN_PHONE", "").strip() or None
    password = os.environ.get("ADMIN_PASSWORD", "")

    if not password or not (email or phone):
        print(
            "خطا: ADMIN_PASSWORD و یکی از ADMIN_EMAIL یا ADMIN_PHONE باید تنظیم شوند",
            file=sys.stderr,
        )
        sys.exit(1)

    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        roles: dict[str, Role] = {}
        for name, desc in BASE_ROLES:
            roles[name] = await _get_or_create_role(db, name, desc)

        perms: dict[str, Permission] = {}
        for key, desc in BASE_PERMISSIONS:
            perms[key] = await _get_or_create_permission(db, key, desc)

        # super_admin همهٔ مجوزها را دارد
        for perm in perms.values():
            exists = (
                await db.execute(
                    select(RolePermission).where(
                        RolePermission.role_id == roles["super_admin"].id,
                        RolePermission.permission_id == perm.id,
                    )
                )
            ).first()
            if not exists:
                db.add(
                    RolePermission(
                        role_id=roles["super_admin"].id, permission_id=perm.id
                    )
                )

        # اولین super_admin
        stmt = select(User)
        if email:
            stmt = stmt.where(User.email == email)
        else:
            stmt = stmt.where(User.phone == phone)
        admin = (await db.execute(stmt)).scalar_one_or_none()
        if not admin:
            admin = User(
                full_name="مدیر ارشد",
                email=email,
                phone=phone,
                password_hash=hash_password(password),
                locale="fa",
                is_active=True,
                is_verified=True,
            )
            db.add(admin)
            await db.flush()
            db.add(UserRole(user_id=admin.id, role_id=roles["super_admin"].id))
            print(f"super_admin ساخته شد: {email or phone}")
        else:
            print(f"super_admin از قبل وجود دارد: {email or phone}")

        # تنظیمات پیش‌فرض پلتفرم (مقادیر حساس رمزنگاری‌شده — فاز ۰ §۳)
        defaults = {
            "app_display_name": {"fa": "آکادمی ماتریدی", "ar": "أكاديمية الماتريدي", "en": "Maturidi Academy"},
            "default_locale": "fa",
            "terms_version": "v1",
        }
        for key, value in defaults.items():
            exists = await db.get(PlatformSetting, key)
            if not exists:
                db.add(
                    PlatformSetting(
                        key=key,
                        value=encrypt_value(json.dumps(value, ensure_ascii=False)),
                        encryption_key_version=1,
                    )
                )

        # تم پیش‌فرض فعال
        active = (
            await db.execute(select(Theme).where(Theme.is_active.is_(True)))
        ).scalar_one_or_none()
        if not active:
            db.add(
                Theme(
                    name={"fa": "پیش‌فرض", "ar": "الافتراضي", "en": "Default"},
                    is_active=True,
                )
            )

        # بخش‌های خانه — فاز ۳ (idempotent)
        await seed_home_sections(db)

        # صفحه‌های حقوقی + تنظیمات تقویم — فاز ۴ (idempotent)
        await seed_legal_pages(db)
        await ensure_calendar_settings(db)

        # پیش‌فرض‌های تنظیمات polish — میل‌استون polish (idempotent)
        await seed_platform_settings_defaults(db)

        # چانک‌های نمایشی فتوا — فاز ۶ (idempotent؛ فقط نقل‌قول verbatim)
        from app.seed_fatwa import seed_fatwa_demo

        fatwa_seed = await seed_fatwa_demo(db)
        print(f"seed فتوا: {fatwa_seed}")

        # پیکربندی‌های draft ماشین‌حساب‌ها — فاز ۷ (idempotent؛ بدون هیچ عدد فقهی)
        from app.seed_calculators import seed_calculator_rules

        calc_seed = await seed_calculator_rules(db)
        print(f"seed ماشین‌حساب‌ها: {calc_seed}")

        # برنامهٔ درسی نمایشی LMS — فاز ۸ (idempotent؛ فقط ارجاع به محتوای واقعی)
        from app.modules.lms.seed_lms import seed_lms_demo

        lms_seed = await seed_lms_demo(db)
        print(f"seed LMS: {lms_seed}")

        # آیتم‌های نمایشی کتابخانه — فاز ۹ (idempotent؛ فایل‌های واقعی تولیدشده در کد)
        from app.modules.library.seed_library import seed_library_demo

        lib_seed = await seed_library_demo(db)
        print(f"seed کتابخانه: {lib_seed}")

        # نقش/مجوزها، تنظیمات، گروه‌ها و صفحهٔ قوانین انجمن — فاز ۱۰ (idempotent)
        from app.seed_social import seed_social

        social_seed = await seed_social(db, admin)
        print(f"seed شبکهٔ اجتماعی: {social_seed}")

        await db.commit()
    print("seed انجام شد.")


if __name__ == "__main__":
    asyncio.run(main())
