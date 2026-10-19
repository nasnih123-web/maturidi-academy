"""Seed اماکن مشهور — فاز ۱۱.

مختصات واقعی (WGS84) چهار مکان مشهور؛ وضعیت published تا روی نقشهٔ زنده
بیایند. فقط اگر جدولی خالی باشد seed می‌کند (idempotent).

اجرا:
    cd apps/api && .venv/bin/python -m app.modules.places.seed_places
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.database import engine
from app.models.models import ReligiousPlace

PLACES: list[dict] = [
    {
        "name": {"fa": "مسجد الحرام", "ar": "المسجد الحرام", "en": "Masjid al-Haram"},
        "description": {
            "fa": "مقدس‌ترین مسجد جهان اسلام در مکهٔ مکرمه، قبلهٔ مسلمانان.",
            "ar": "أقدس مساجد المسلمين في مكة المكرمة، قبلة المسلمين.",
            "en": "The holiest mosque in Islam, in Makkah — the qibla of Muslims.",
        },
        "lat": 21.4225,
        "lng": 39.8262,
        "type": "holy_site",
    },
    {
        "name": {"fa": "مسجد النبی", "ar": "المسجد النبوي", "en": "Al-Masjid an-Nabawi"},
        "description": {
            "fa": "مسجد پیامبر اکرم ﷺ در مدینهٔ منوره.",
            "ar": "مسجد النبي ﷺ في المدينة المنورة.",
            "en": "The Prophet's Mosque ﷺ in Madinah.",
        },
        "lat": 24.4672,
        "lng": 39.6111,
        "type": "holy_site",
    },
    {
        "name": {"fa": "حرم امام رضا علیه‌السلام", "ar": "مرقد الإمام الرضا عليه السلام", "en": "Imam Reza Shrine"},
        "description": {
            "fa": "حرم مطهر امام رضا علیه‌السلام در مشهد مقدس.",
            "ar": "المرقد الطاهر للإمام الرضا عليه السلام في مشهد المقدسة.",
            "en": "The holy shrine of Imam Reza (AS) in Mashhad.",
        },
        "lat": 36.2880,
        "lng": 59.6157,
        "type": "shrine",
    },
    {
        "name": {"fa": "مسجد الاقصی", "ar": "المسجد الأقصى", "en": "Al-Aqsa Mosque"},
        "description": {
            "fa": "نخستین قبلهٔ مسلمانان در قدس شریف.",
            "ar": "أولى القبلتين في القدس الشريف.",
            "en": "The first qibla of Muslims, in Jerusalem.",
        },
        "lat": 31.7689,
        "lng": 35.2137,
        "type": "holy_site",
    },
]


async def seed_places() -> int:
    """seed اماکن؛ برمی‌گرداند: تعداد سطرهای اضافه‌شده."""
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        existing = (await db.execute(select(func.count()).select_from(ReligiousPlace))).scalar_one()
        if existing:
            return 0
        now = datetime.now(timezone.utc)
        for p in PLACES:
            db.add(
                ReligiousPlace(
                    id=uuid.uuid4(),
                    name=p["name"],
                    description=p["description"],
                    lat=p["lat"],
                    lng=p["lng"],
                    type=p["type"],
                    workflow_status="published",
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
            )
        await db.commit()
        return len(PLACES)


if __name__ == "__main__":
    print("seeded:", asyncio.run(seed_places()))
