"""FIX2-11: یکتایی انتشار از سه‌تایی به artifact_key — ADR-0046.

قید uq_build_releases_platform_version روی (platform, version,
build_number) مانع ثبت انتشار چندفایلی بود: build-callback.sh برای
هر فایل یک رکورد با همان سه‌تایی POST می‌کند و رکورد دوم به بعد با
IntegrityError رد می‌شد. حالا یکتایی روی artifact_key است (هر فایل
ذخیره‌شده دقیقاً یک رکورد؛ artifact_keyهای NULL در هر دو dialect
متمایز شمرده می‌شوند و انتشارهای دستی بدون فایل آزاد می‌مانند) و
(platform, version, build_number) «گروه انتشار» واحد نگهداری
prune_releases می‌شود.

Revision ID: b5c6d7e8f9a0
Revises: a4b5c6d7e8f9
"""
from __future__ import annotations

from alembic import op

revision = "b5c6d7e8f9a0"
down_revision = "a4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite برای drop قید به batch mode نیاز دارد؛ روی PostgreSQL هم
    # همین مسیر امن و معادل است.
    with op.batch_alter_table("build_releases") as batch_op:
        batch_op.drop_constraint(
            "uq_build_releases_platform_version", type_="unique"
        )
    op.create_index(
        "uq_build_releases_artifact_key",
        "build_releases",
        ["artifact_key"],
        unique=True,
    )


def downgrade() -> None:
    # Pass 4 / C9: downgrade کور، قید سه‌تاییِ قدیم را بدون بررسی
    # داده بازمی‌گرداند — ولی upgrade دقیقاً برای این ساخته شد که
    # گروه‌های چندفایلی با یک (platform, version, build_number) و
    # artifact_keyهای متفاوت مجاز باشند. اگر چنین گروهی وجود داشته
    # باشد، CREATE UNIQUE همان‌جا می‌شکند (روی SQLite حتی ممکن است
    # ایندکس artifact_key از قبل حذف شده باشد). پس اول داده چک
    # می‌شود و در صورت تعارض، downgrade پیش از هر DDL با پیام
    # اقدام‌پذیر (نام گروه‌های متعارض) رد می‌شود — schema دست‌نخورده
    # می‌ماند و هیچ ردیفی حذف/ادغام نمی‌شود. این مهاجرتِ اعمال‌شده
    # بازنویسی نمی‌شود؛ گارد، همین downgrade را امن می‌کند.
    from sqlalchemy import text

    conn = op.get_bind()
    dup_rows = conn.execute(
        text(
            "SELECT platform, version, build_number, COUNT(*) AS n "
            "FROM build_releases "
            "WHERE platform IS NOT NULL AND version IS NOT NULL "
            "AND build_number IS NOT NULL "
            "GROUP BY platform, version, build_number HAVING COUNT(*) > 1 "
            "ORDER BY n DESC LIMIT 10"
        )
    ).all()
    if dup_rows:
        groups = ", ".join(
            f"{r[0]}/{r[1]}/{r[2]} (x{r[3]})" for r in dup_rows
        )
        raise RuntimeError(
            "downgrade refused: multi-file release groups share "
            "(platform, version, build_number) and cannot satisfy the "
            "old unique constraint — conflicting groups: "
            f"{groups}. Keep the artifact_key unique index (do not "
            "downgrade past b5c6d7e8f9a0) or split the groups first; "
            "no rows were deleted or merged."
        )
    op.drop_index("uq_build_releases_artifact_key", table_name="build_releases")
    with op.batch_alter_table("build_releases") as batch_op:
        batch_op.create_unique_constraint(
            "uq_build_releases_platform_version",
            ["platform", "version", "build_number"],
        )
