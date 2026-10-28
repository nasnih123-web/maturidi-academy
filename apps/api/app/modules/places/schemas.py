"""اسکیماهای اماکن مذهبی — فاز ۱۱ + کرهٔ سه‌بعدی.

قانون §۱۵.۴: هیچ متن قابل‌مشاهده‌ای هاردکد نیست — name/description همیشه
LocalizedText ({fa, ar, en}).

اعتبارسنجی نوع مکان این‌جا نیست: نوع‌ها از تنظیم CRM places.types
می‌آیند و سرویس (با دسترسی به DB) آن‌ها را بررسی می‌کند. بررسی نوع در
model_post_init با ValueError باعث ۵۰۰ می‌شد (ctx خطای Pydantic قابل
سریالایز نیست و 422 handler آن را با json.dumps ساده رد می‌کند)؛ پس نوع
فقط در سرویس با APIError 422 رد می‌شود.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from .types import DEFAULT_PLACE_TYPES

# Back-compat: the default type keys (the settings-driven list lives in
# types.py; the service validates against the live setting, not this).
PLACE_TYPES = tuple(t["key"] for t in DEFAULT_PLACE_TYPES)


def _normalize_url(v: object) -> str | None:
    """Normalize only (strip, empty -> None); never raise.

    The http(s)-only + length rules live on the field itself (pattern +
    max_length) so a bad URL fails with a JSON-serializable 422: a ValueError
    raised here would land in the ValidationError ctx as a raw exception
    object, which the app's 422 envelope passes to plain json.dumps and
    would turn into a 500 instead of a 422.
    """
    if v is None:
        return None
    if not isinstance(v, str):
        return v  # type: ignore[return-value]  # type error left to pydantic (serializable)
    v = v.strip()
    return v or None


# URLs must be plain http(s) — never javascript:/data: URIs.
URL_FIELD = Field(default=None, max_length=1024, pattern=r"^https?://")


class LocalizedText(BaseModel):
    fa: str = ""
    ar: str = ""
    en: str = ""


class PlaceImage(BaseModel):
    """One gallery image: an http(s) URL plus an optional caption."""

    url: str = Field(..., max_length=1024, pattern=r"^https?://")
    caption: str = Field(default="", max_length=200)

    _normalize_url = field_validator("url", mode="before")(_normalize_url)


class PlaceCreate(BaseModel):
    name: LocalizedText
    description: LocalizedText | None = None
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    type: str = Field(default="mosque")
    city: str | None = Field(default=None, max_length=128)
    image_url: str | None = URL_FIELD
    images: list[PlaceImage] | None = Field(default=None, max_length=20)
    video_360_id: UUID | None = None
    video_url: str | None = URL_FIELD

    _normalize_image = field_validator("image_url", "video_url", mode="before")(_normalize_url)


class PlaceUpdate(BaseModel):
    name: LocalizedText | None = None
    description: LocalizedText | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    type: str | None = None
    city: str | None = Field(default=None, max_length=128)
    image_url: str | None = URL_FIELD
    images: list[PlaceImage] | None = Field(default=None, max_length=20)
    video_360_id: UUID | None = None
    video_url: str | None = URL_FIELD

    _normalize_image = field_validator("image_url", "video_url", mode="before")(_normalize_url)


class PlaceTransition(BaseModel):
    target: str


class PlaceSubmission(BaseModel):
    """Anonymous public registration: always lands as a draft for CRM review
    (never published automatically, never visible on the public globe).
    Visitors submit a single image URL; the admin expands it to a gallery
    after approval."""

    name: LocalizedText
    description: LocalizedText | None = None
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    type: str = Field(default="mosque")
    city: str | None = Field(default=None, max_length=128)
    image_url: str | None = URL_FIELD

    _normalize_image = field_validator("image_url", mode="before")(_normalize_url)


class PlaceOut(BaseModel):
    id: UUID
    name: dict
    description: dict | None
    lat: float
    lng: float
    type: str
    city: str | None = None
    image_url: str | None = None
    images: list[dict] | None = None
    video_360_id: UUID | None
    video_url: str | None = None
    workflow_status: str
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlaceList(BaseModel):
    items: list[PlaceOut]
    total: int
