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
    op.drop_index("uq_build_releases_artifact_key", table_name="build_releases")
    with op.batch_alter_table("build_releases") as batch_op:
        batch_op.create_unique_constraint(
            "uq_build_releases_platform_version",
            ["platform", "version", "build_number"],
        )
