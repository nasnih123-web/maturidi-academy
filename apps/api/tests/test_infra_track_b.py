"""تست‌های Track B — زیرساخت و درستی (hardening/audit-pass-1).

پوشش:
  ۱) تنظیمات: env بر cwd اولویت دارد؛ نبود .env کرش نمی‌کند (setup از cwd دیگر)
  ۲) fail-fast در production وقتی secretها placeholder هستند (قرارداد §۳)
  ۳) health endpointها (قرارداد §۱۱)
  ۴) Redis-down → fallback خودکار به InMemoryBus (graceful degradation)
  ۵) تمرین واقعی backup→restore (قرارداد §۱۷.۳): ساخت داده → بکاپ →
     بازیابی به scratch → راستی‌آزمایی شمارش سطرها + هش SHA-256 محتوا
"""
from __future__ import annotations

import asyncio
import hashlib
import shutil
import sqlite3
import uuid
from pathlib import Path

import pytest

APPS_API = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------- ۱) تنظیمات

def test_settings_env_overrides_cwd_and_missing_dotenv(monkeypatch, tmp_path):
    """اجرا از cwd دلخواه: env بر .env اولویت دارد و نبود .env کرش نمی‌کند."""
    from app.core.config import Settings, get_settings

    monkeypatch.chdir(tmp_path)  # دایرکتوری خالی، بدون .env
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:////tmp/trackb-cwd-probe.db")
    get_settings.cache_clear()
    try:
        s = Settings()
        assert s.database_url == "sqlite+aiosqlite:////tmp/trackb-cwd-probe.db"
    finally:
        get_settings.cache_clear()


# ------------------------------------------------------- ۲) fail-fast در prod

def test_production_failfast_on_placeholder_secrets():
    """secret placeholder در production → بالا نیامدن (قرارداد §۳)."""
    from app.core.config import Settings, assert_production_secrets_ok

    # هر دو placeholder
    s = Settings(app_env="production", jwt_secret="CHANGE_ME", encryption_key="CHANGE_ME")
    with pytest.raises(RuntimeError, match="insecure setting"):
        assert_production_secrets_ok(s)

    # رشتهٔ خالی هم placeholder است
    s = Settings(app_env="production", jwt_secret="", encryption_key="real-key-xyz")
    with pytest.raises(RuntimeError, match="insecure setting"):
        assert_production_secrets_ok(s)

    # dev سکوت می‌کند (توسعه و تست سبک می‌مانند)
    s = Settings(app_env="dev", jwt_secret="CHANGE_ME", encryption_key="CHANGE_ME")
    assert_production_secrets_ok(s)

    # production با secret واقعی بالا می‌آید (کلیدهای ≥۳۲ کاراکتری — §۶)
    s = Settings(
        app_env="production",
        jwt_secret="j" * 64,
        encryption_key="k" * 64,
        app_base_url="https://api.example.org",
    )
    assert_production_secrets_ok(s)


# ------------------------------------------------------------- ۳) health

async def test_health_endpoints(tc):
    client = tc["client"]
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["api"] == "v1"


# ------------------------------------------- ۴) Redis-down → fallback حافظه‌ای

async def test_redis_down_falls_back_to_inmemory_bus(monkeypatch):
    """وقتی Redis در دسترس نیست، bus حافظه‌ای جایگزین می‌شود و کار می‌کند."""
    import redis.asyncio as aioredis

    from app.core.dispatcher import InMemoryBus, create_event_bus

    def _boom(*args, **kwargs):
        raise ConnectionError("redis down (simulated)")

    monkeypatch.setattr(aioredis, "from_url", _boom)
    bus = await create_event_bus()
    assert isinstance(bus, InMemoryBus)

    # انتشار/دریافت روی fallback واقعاً کار می‌کند (نه فقط non-crash)
    received: list[dict] = []
    done = asyncio.Event()

    async def _cb(msg: dict) -> None:
        received.append(msg)
        done.set()

    listener = asyncio.create_task(bus.run_listener(_cb))
    try:
        await bus.publish({"event_id": "track-b-probe", "event_type": "probe"})
        await asyncio.wait_for(done.wait(), timeout=5)
    finally:
        listener.cancel()
        await bus.close()
    assert received and received[0]["event_id"] == "track-b-probe"


# -------------------------------------- ۵) تمرین واقعی backup → restore

def _canonical_snapshot(db_path: Path) -> tuple[str, dict[str, int]]:
    """هش SHA-256 کانونیکال روی همهٔ سطرهای همهٔ جدول‌ها + شمارش سطرها."""
    con = sqlite3.connect(db_path)
    try:
        tables = [
            r[0]
            for r in con.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        h = hashlib.sha256()
        counts: dict[str, int] = {}
        for table in tables:
            cols = [r[1] for r in con.execute(f'PRAGMA table_info("{table}")')]
            order = ", ".join(f'"{c}"' for c in cols)
            rows = list(con.execute(f'SELECT * FROM "{table}" ORDER BY {order}'))
            counts[table] = len(rows)
            h.update(f"table:{table}\n".encode())
            for row in rows:
                h.update(repr(row).encode() + b"\n")
        return h.hexdigest(), counts
    finally:
        con.close()


async def _seed_drill_data(url: str) -> None:
    """دادهٔ نمونهٔ واقعی با همان لایه‌های production (argon2، رمزنگاری Fernet)."""
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )

    import app.models  # noqa: F401 — ثبت جدول‌ها
    from app.core.platform_settings import stage_setting
    from app.core.security import hash_password
    from app.models.models import DomainEvent, User

    engine = create_async_engine(url)
    try:
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as db:
            db.add(
                User(
                    id=uuid.uuid4(),
                    full_name="کاربر تمرین بکاپ",
                    email="drill@example.com",
                    password_hash=hash_password("DrillPass123"),
                    locale="fa",
                    is_active=True,
                    is_verified=True,
                )
            )
            await stage_setting(db, "drill.marker", "backup-drill-value")
            db.add(
                DomainEvent(
                    event_id=uuid.uuid4(),
                    aggregate_type="drill",
                    aggregate_id="1",
                    event_type="drill.created",
                    payload={"ok": True},
                    schema_version=1,
                    source_client="track-b-test",
                )
            )
            await db.commit()
    finally:
        await engine.dispose()


def test_backup_restore_drill(monkeypatch, tmp_path):
    """تمرین واقعی بازیابی (قرارداد §۱۷.۳): migrate از صفر → داده → بکاپ →
    restore به scratch → راستی‌آزمایی شمارش + SHA-256. بدون docker/postgres."""
    from alembic.config import Config

    from alembic import command
    from app.core.config import get_settings

    monkeypatch.chdir(APPS_API)
    src = tmp_path / "drill_src.db"
    url = f"sqlite+aiosqlite:///{src}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    try:
        # ۱) migrate از صفر با همان مسیر production (alembic upgrade head)
        cfg = Config(str(APPS_API / "alembic.ini"))
        cfg.set_main_option("sqlalchemy.url", url)
        command.upgrade(cfg, "head")

        # ۲) ساخت دادهٔ واقعی
        asyncio.run(_seed_drill_data(url))

        # ۳) بکاپ: کپی فایل + manifest هش (الگوی infra/backup.sh)
        before_hash, before_counts = _canonical_snapshot(src)
        assert before_counts.get("users", 0) >= 1
        backup = tmp_path / "drill_backup.db"
        shutil.copy2(src, backup)
        manifest = tmp_path / "drill_backup.db.sha256"
        digest = hashlib.sha256(backup.read_bytes()).hexdigest()
        manifest.write_text(f"{digest}  {backup.name}\n")
        assert manifest.read_text().split()[0] == hashlib.sha256(
            backup.read_bytes()
        ).hexdigest(), "manifest بکاپ معتبر نیست"

        # ۴) restore به scratch (شبیه‌سازی هاست جدید)
        restored = tmp_path / "drill_restored.db"
        shutil.copy2(backup, restored)

        # ۵) راستی‌آزمایی: شمارش سطرها + هش کانونیکال محتوا باید یکسان باشند
        after_hash, after_counts = _canonical_snapshot(restored)
        assert after_counts == before_counts, (
            "شمارش سطرها بعد از restore فرق کرد",
            {t: (before_counts.get(t), after_counts.get(t)) for t in set(before_counts) | set(after_counts)
             if before_counts.get(t) != after_counts.get(t)},
        )
        assert after_hash == before_hash, "هش SHA-256 محتوا بعد از restore فرق کرد"

        # ۶) دیتابیس بازیابی‌شده واقعاً قابل‌استفاده است (خواندن با ORM)
        async def _read_back():
            from sqlalchemy import func, select
            from sqlalchemy.ext.asyncio import (
                AsyncSession,
                async_sessionmaker,
                create_async_engine,
            )

            eng = create_async_engine(f"sqlite+aiosqlite:///{restored}")
            try:
                mk = async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
                async with mk() as db:
                    from app.models.models import User as UserModel

                    n = (await db.execute(select(func.count()).select_from(UserModel))).scalar()
                    return n
            finally:
                await eng.dispose()

        assert asyncio.run(_read_back()) >= 1
    finally:
        get_settings.cache_clear()
