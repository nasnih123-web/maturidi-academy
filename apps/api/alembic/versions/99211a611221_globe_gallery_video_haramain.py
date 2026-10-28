"""Globe phase: religious_places.images gallery + video_url, Haramain retype.

- ``images`` is a JSON list of {url, caption} (http(s) only, enforced in
  schemas); ``video_url`` is a regular-video URL (YouTube/Vimeo/Aparat
  embeds on the web). Both nullable: existing rows need no backfill.
- Data migration: the two seeded Haramain places — matched ONLY by
  coordinate ranges (+-0.05 degrees, ~5.5 km) around their exact seed
  coordinates AND only where type is currently ``holy_site`` — become
  ``haramain``. No other row is touched: al-Aqsa (also ``holy_site``) and
  the Imam Reza ``shrine`` row keep their types and stay editable (the
  places service never rejects an update that keeps a row's existing type).
- The images column uses generic sa.JSON() (repo precedent, e.g. the
  articles migration) so the migration runs on SQLite and Postgres alike;
  the model declares JSONB, which is wire-compatible for JSON values.
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "99211a611221"
down_revision = "5247e53171bf"
branch_labels = None
depends_on = None

# (lat, lng) of the two Haramain seed places; +-0.05 deg windows.
_HARAMAIN = (
    (21.4225, 39.8262),  # مسجد الحرام
    (24.4672, 39.6111),  # مسجد النبی
)


def _retype_sql(target: str, source: str) -> str:
    cases = " OR ".join(
        f"(lat BETWEEN {lat - 0.05} AND {lat + 0.05} "
        f"AND lng BETWEEN {lng - 0.05} AND {lng + 0.05})"
        for lat, lng in _HARAMAIN
    )
    return (
        f"UPDATE religious_places SET type = '{target}' "
        f"WHERE type = '{source}' AND ({cases})"
    )


def upgrade() -> None:
    op.add_column("religious_places", sa.Column("images", sa.JSON(), nullable=True))
    op.add_column("religious_places", sa.Column("video_url", sa.String(1024), nullable=True))
    op.execute(_retype_sql("haramain", "holy_site"))


def downgrade() -> None:
    op.execute(_retype_sql("holy_site", "haramain"))
    op.drop_column("religious_places", "video_url")
    op.drop_column("religious_places", "images")
