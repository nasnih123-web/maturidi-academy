"""روتر خانه و جست‌وجو — فاز ۳.

هر دو endpoint عمومی‌اند (بدون احراز هویت). فقط سیم‌کشی؛ منطق در service.py (§۱۵.۶).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.home import service
from app.modules.home.schemas import HomeOut, SearchOut

router = APIRouter(prefix="/api/v1", tags=["home"])


@router.get("/home/sections", response_model=HomeOut)
async def get_home_sections(db: AsyncSession = Depends(get_db)):
    """بخش‌های خانه: فقط visibleها به‌ترتیب sort_order + رونویسی‌های تم (یا null)."""
    return await service.get_home_sections(db)


@router.get("/search", response_model=SearchOut)
async def search(
    q: str = Query(min_length=1, max_length=200, description="متن جست‌وجو — ۱ تا ۲۰۰ کاراکتر"),
    type: str | None = Query(
        default=None,
        description="فیلتر نوع نتیجه: section | theme | fatwa | library | course | page",
    ),
    limit: int = Query(default=10, ge=1, le=50, description="حداکثر نتایج"),
    db: AsyncSession = Depends(get_db),
):
    """جست‌وجوی سراسری واقعی (M-01): بخش‌ها، تم‌ها، فتوا، کتابخانه، دوره، صفحهٔ CMS."""
    # q خالی/فقط-فاصله بعد از trim در service به 422 تبدیل می‌شود (پاکت یکدست).
    return await service.search(db, q=q, result_type=type, limit=limit)
