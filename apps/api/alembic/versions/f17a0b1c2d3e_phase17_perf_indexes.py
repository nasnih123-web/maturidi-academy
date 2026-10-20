"""Phase 17 — ایندکس‌های ترکیبی مسیرهای داغ (slow-query indexing).

Revision ID: f17a0b1c2d3e
Revises: e6f1a2b3c4d5
Create Date: 2026-10-19

Forward-only (§۱۲). هر دو ایندکس از روی کوئری واقعی کد اثبات شده‌اند
(نه حدس) — فقط مسیرهایی که WHERE + ORDER BY ترکیبی دارند و ایندکس
تک‌ستونی موجود جواب‌گوی کامل آن‌ها نیست:

1. social_posts (فید): app/modules/social/service.py::list_feed
   WHERE status = 'published' ORDER BY created_at DESC, id DESC
   (قبلاً فقط ایندکس‌های تک‌ستونی status و created_at)
2. library_items (فهرست عمومی): app/modules/library/service.py::list_public
   WHERE workflow_status = 'published' [AND visibility ...]
   ORDER BY created_at DESC, id DESC
   (قبلاً فقط ایندکس‌های تک‌ستونی)

تغییرات متادیتای مدل (unique=True روی سه ستون idempotency) در همین فاز
به models.py اضافه شد ولی migration لازم ندارد — constraintهای یکتا
مربوطه از قبل در migrationهای فاز ۱۱/۱۵ ساخته شده‌اند.
"""
from collections.abc import Sequence

from alembic import op

revision: str = 'f17a0b1c2d3e'
down_revision: str | None = 'e6f1a2b3c4d5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_social_posts_feed",
        "social_posts",
        ["status", "created_at", "id"],
    )
    op.create_index(
        "ix_library_items_pub_list",
        "library_items",
        ["workflow_status", "visibility", "created_at", "id"],
    )


def downgrade() -> None:
    # forward-only (§۱۲) — این تابع فقط برای ابزار نگه داشته شده و استفاده نمی‌شود
    op.drop_index("ix_library_items_pub_list", table_name="library_items")
    op.drop_index("ix_social_posts_feed", table_name="social_posts")
