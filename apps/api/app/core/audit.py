"""ثبت audit log — فاز ۰ §۱۴.

قانون سخت: رمز عبور، توکن، کلید API، سکرت TOTP و هر مقدار احراز هویتی
هرگز در old_values/new_values ذخیره نمی‌شود — فقط {"field": ..., "changed": true}.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.context import request_id_var
from app.models.models import AuditLog

# هر کلیدی که یکی از این زیررشته‌ها را داشته باشد، مقدارش اسکراب می‌شود
_SECRET_HINTS = (
    "password",
    "passwd",
    "pwd",
    "token",
    "totp",
    "secret",
    "api_key",
    "apikey",
    "session",
    "code",
)


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict = {}
        for k, v in value.items():
            kl = str(k).lower()
            if any(h in kl for h in _SECRET_HINTS):
                out[k] = {"field": k, "changed": True}
            else:
                out[k] = _scrub(v)
        return out
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


async def log_audit(
    db: AsyncSession,
    *,
    actor_id: uuid.UUID | None,
    actor_type: str,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    old_values: dict | None = None,
    new_values: dict | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        actor_id=actor_id,
        actor_type=actor_type,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_values=_scrub(old_values) if old_values is not None else None,
        new_values=_scrub(new_values) if new_values is not None else None,
        ip=ip,
        user_agent=user_agent,
        request_id=request_id_var.get(),
    )
    db.add(entry)
    await db.flush()
    return entry
