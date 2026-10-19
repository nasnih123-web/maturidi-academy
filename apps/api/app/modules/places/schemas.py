"""اسکیماهای اماکن مذهبی — فاز ۱۱.

قانون §۱۵.۴: هیچ متن قابل‌مشاهده‌ای هاردکد نیست — name/description همیشه
LocalizedText ({fa, ar, en}).
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

PLACE_TYPES = ("mosque", "shrine", "holy_site", "museum", "other")


class LocalizedText(BaseModel):
    fa: str = ""
    ar: str = ""
    en: str = ""


class PlaceCreate(BaseModel):
    name: LocalizedText
    description: LocalizedText | None = None
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    type: str = Field(default="mosque")
    video_360_id: UUID | None = None

    def model_post_init(self, __context) -> None:
        if self.type not in PLACE_TYPES:
            raise ValueError(f"unknown place type: {self.type}")


class PlaceUpdate(BaseModel):
    name: LocalizedText | None = None
    description: LocalizedText | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    type: str | None = None
    video_360_id: UUID | None = None

    def model_post_init(self, __context) -> None:
        if self.type is not None and self.type not in PLACE_TYPES:
            raise ValueError(f"unknown place type: {self.type}")


class PlaceTransition(BaseModel):
    target: str


class PlaceOut(BaseModel):
    id: UUID
    name: dict
    description: dict | None
    lat: float
    lng: float
    type: str
    video_360_id: UUID | None
    workflow_status: str
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlaceList(BaseModel):
    items: list[PlaceOut]
    total: int
