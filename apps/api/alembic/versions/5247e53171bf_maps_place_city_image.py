"""Maps phase (overnight/w10): religious_places.city + image_url.

City is a free-text label (manual fallback when geolocation is unavailable —
never geocoded). image_url is an optional http(s) image shown on the place
detail page and, per the CRM `places.popup` setting, inside map popups.
Both nullable: existing rows need no backfill.
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "5247e53171bf"
down_revision = "3c1a89148641"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("religious_places", sa.Column("city", sa.String(128), nullable=True))
    op.add_column("religious_places", sa.Column("image_url", sa.String(1024), nullable=True))


def downgrade() -> None:
    op.drop_column("religious_places", "image_url")
    op.drop_column("religious_places", "city")
