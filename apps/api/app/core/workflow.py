"""ماشین وضعیت مشترک گردش‌کار محتوا — قرارداد §۹.

یک پیاده‌سازی واحد برای همهٔ انواع محتوا (فتوا، کتابخانه، صفحات CMS،
پست‌های اجتماعی و ...):

    draft → in_review → approved → published
              ↘ rejected / archived

قوانین:
- هیچ جهشی مجاز نیست (مثلاً draft → published مستقیم ممکن نیست).
- published فقط می‌تواند archived شود (unpublish صریح)؛ بازگشت به چرخه
  از archived → draft انجام می‌شود (rollback §۹.۵).
- rejected و archived نقاط پایانی چرخه‌اند؛ فعال‌سازی مجدد فقط از draft.
- این ماژول هیچ I/O ندارد تا در serviceها و تست‌ها به‌راحتی استفاده شود.
"""
from __future__ import annotations

from app.core.errors import APIError

DRAFT = "draft"
IN_REVIEW = "in_review"
APPROVED = "approved"
PUBLISHED = "published"
REJECTED = "rejected"
ARCHIVED = "archived"

STATUSES: tuple[str, ...] = (DRAFT, IN_REVIEW, APPROVED, PUBLISHED, REJECTED, ARCHIVED)

# نگاشت وضعیت → وضعیت‌های مجاز بعدی
TRANSITIONS: dict[str, frozenset[str]] = {
    DRAFT: frozenset({IN_REVIEW, ARCHIVED}),
    IN_REVIEW: frozenset({APPROVED, REJECTED, DRAFT, ARCHIVED}),
    APPROVED: frozenset({PUBLISHED, REJECTED, DRAFT, ARCHIVED}),
    PUBLISHED: frozenset({ARCHIVED}),
    REJECTED: frozenset({DRAFT, ARCHIVED}),
    ARCHIVED: frozenset({DRAFT}),
}


def can_transition(current: str, target: str) -> bool:
    """آیا گذار current → target طبق ماشین §۹ مجاز است؟"""
    return target in TRANSITIONS.get(current, frozenset())


def validate_transition(current: str, target: str) -> None:
    """گذار را اعتبارسنجی می‌کند؛ در صورت نامعتبر بودن خطای 422 می‌دهد."""
    if target not in STATUSES:
        raise APIError(422, "unknown_status", f"وضعیت ناشناخته: {target}")
    if not can_transition(current, target):
        raise APIError(
            422,
            "invalid_transition",
            f"گذار از «{current}» به «{target}» مجاز نیست",
            details={"from": current, "to": target},
        )


def next_allowed(current: str) -> list[str]:
    """وضعیت‌های مجاز بعدی — برای نمایش در CRM."""
    return sorted(TRANSITIONS.get(current, frozenset()))
