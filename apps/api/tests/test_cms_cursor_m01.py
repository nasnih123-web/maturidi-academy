"""تست m-01: صفحه‌بندی کرسری cms_service.list_items (الگوی کتابخانه).

- پیمایش کامل با کرسر: بدون هم‌پوشانی، بدون جاافتادگی، ترتیب پایدار.
- حالت offset قدیمی هم next_cursor می‌دهد (مهاجرت نرم کلاینت).
- کرسر نامعتبر → 400 invalid_cursor.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.core.errors import APIError
from app.models.models import ScholarQuote
from app.modules.content import cms_service


async def _seed_quotes(db, n: int = 7) -> list[str]:
    base = datetime(2026, 1, 1, tzinfo=UTC)
    ids = []
    for i in range(n):
        q = ScholarQuote(
            text={"fa": f"نقل‌قول m01 شماره {i}"},
            scholar={"fa": "عالم آزمایشی"},
            created_at=base + timedelta(minutes=i),
            updated_at=base + timedelta(minutes=i),
        )
        db.add(q)
        await db.flush()
        ids.append(str(q.id))
    await db.commit()
    return ids


async def test_cursor_walk_covers_all_without_overlap(db_session):
    ids = await _seed_quotes(db_session)
    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        items, total, cursor = await cms_service.list_items(
            db_session, "quotes", limit=3, cursor=cursor
        )
        assert total >= len(ids)
        seen.extend(str(it["id"]) for it in items)
        pages += 1
        if cursor is None:
            break
        assert pages < 50, "حلقهٔ کرسر بی‌پایان شد"
    # invariantهای واقعی keyset (مستقل از دادهٔ تست‌های دیگر در DB مشترک):
    assert len(seen) == len(set(seen)), "هم‌پوشانی بین صفحه‌ها"
    assert set(ids) <= set(seen), "ردیفی از قلم افتاد"
    # ترتیب نسبی ردیف‌های این تست: تازه‌ترین اول (created_at desc)
    mine_in_order = [x for x in seen if x in set(ids)]
    assert mine_in_order == list(reversed(ids))


async def test_offset_mode_still_works_and_offers_cursor(db_session):
    await _seed_quotes(db_session, n=5)
    items, total, next_cursor = await cms_service.list_items(
        db_session, "quotes", limit=2, offset=0
    )
    assert len(items) == 2
    assert total >= 5
    assert next_cursor is not None
    # از همان کرسر می‌شود ادامه داد
    items2, _, _ = await cms_service.list_items(
        db_session, "quotes", limit=2, cursor=next_cursor
    )
    first_ids = {str(i["id"]) for i in items}
    assert not ({str(i["id"]) for i in items2} & first_ids)


async def test_invalid_cursor_rejected(db_session):
    with pytest.raises(APIError) as exc:
        await cms_service.list_items(
            db_session, "quotes", limit=2, cursor="not-a-cursor!!"
        )
    assert exc.value.status_code == 400
    assert exc.value.code == "invalid_cursor"
