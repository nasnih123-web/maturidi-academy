"""Reset quran.reciters so the seed re-creates it with all 38 reciters.

Context (2026-11-03): the live reader offers a single reciter because
the stored ``quran.reciters`` setting is the legacy seed value
``["ar.alafasy"]`` — seed only fills MISSING keys, so changing the seed
value alone would never reach production. The stored value is provably
untouched (it equals the legacy seed value exactly), so deleting the row
loses no admin customization.

Mechanism: this migration only DELETEs the row. On the next boot,
``start.sh`` runs ``alembic upgrade head`` and then the seed, which
re-creates ``quran.reciters`` from the updated ``seed.py`` (all 38
playable AlQuran Cloud audio editions, verified against the live catalog
2026-11-03) through the normal encrypted ``stage_setting`` path. The CRM
منابع tab stays the management point afterwards: an admin can still edit
the list there, and a later seed run will not overwrite it.

Downgrade: DELETEs the row again, so a revert + seed re-creates the old
single-reciter value from the reverted ``seed.py``.
"""
from __future__ import annotations

from alembic import op

revision = "9e546ce5407f"
down_revision = "561ac1e04634"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM platform_settings WHERE key = 'quran.reciters'")


def downgrade() -> None:
    op.execute("DELETE FROM platform_settings WHERE key = 'quran.reciters'")
