"""اسکلت Content Control Center — فاز ۲ (قرارداد §۹.۵).

**اصل:** این مرکز منطق دامنهٔ فتوا/LMS/کتابخانه/قرآن را کپی نمی‌کند؛ هر ماژولِ
آینده یک `ContentAdapter` ثبت می‌کند و محتوا از طریق همین مرکزِ واحد جست‌وجو،
پیش‌نمایش و سیاست‌گذاری می‌شود — بدون UI مدیریتی جداگانه برای هر ماژول.

در این فاز هیچ ماژول محتوایی وجود ندارد → رجیستری خالی شروع می‌شود و
endpointها لیست خالی برمی‌گردانند. آنچه تست می‌شود «ماشین» است، نه داده.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Any

from app.core.errors import APIError


@dataclass(frozen=True)
class ContentRef:
    """ارجاع یکدست به هر محتوای قابل‌نمایش — شناسهٔ دامنه + نوع + وضعیت گردش‌کار."""

    content_type: str  # مثل "fatwa"، "book" — همان کلید ثبت adapter
    id: str
    module: str  # ماژول مالک: fatwa | library | lms | quran | cms | ...
    status: str  # draft | in_review | approved | published | rejected | archived (§۹)
    owner_id: str | None
    title: dict  # LocalizedText {"fa":..,"ar":..,"en":..}
    created_at: str  # ISO 8601
    updated_at: str  # ISO 8601
    languages: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ContentPreview:
    """پیش‌نمایش قبل از انتشار — روی surface مقصد و در locale لازم (§۹.۵)."""

    ref: ContentRef
    preview: dict  # دادهٔ ساخت‌یافتهٔ پیش‌نمایش (html/text/blocks بر عهدهٔ adapter)
    surfaces: list[str] = field(default_factory=list)  # placementهای مقصد
    locales: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ContentPolicies:
    """سیاست‌های §۹.۵: AI، توزیع، زمان‌بندی، placement."""

    ai_policy: dict  # {"allowed_uses": ["fatwa","assistant",...] | [], "default": "none"}
    distribution: dict  # {"web": true/false, "mobile": ..., "telegram": {"mode": "manual_approval"...}}
    schedule: dict | None  # {"publish_at": iso|null, "unpublish_at": iso|null, "timezone": ...}
    placement: list[dict] = field(default_factory=list)  # [{"surface":..,"sort_order":..,"active":..}]


class ContentAdapter(ABC):
    """قراردادی که هر ماژول محتوایی پیاده‌سازی و با register_adapter ثبت می‌کند."""

    content_type: str = ""
    module: str = ""

    @abstractmethod
    async def list_items(self, filters: dict[str, Any]) -> list[ContentRef]:
        """فیلترها: type, module, status, owner, date_from, date_to, q."""

    @abstractmethod
    async def get_preview(self, item_id: str) -> ContentPreview | None:
        """None یعنی آیتم وجود ندارد."""

    @abstractmethod
    async def get_policies(self, item_id: str) -> ContentPolicies | None:
        """None یعنی آیتم وجود ندارد."""


_registry: dict[str, ContentAdapter] = {}


def register_adapter(adapter: ContentAdapter) -> None:
    """ثبت adapter یک نوع محتوا — در فازهای بعدی توسط همان ماژول صدا زده می‌شود."""
    if not adapter.content_type:
        raise ValueError("adapter.content_type must be set")
    _registry[adapter.content_type] = adapter


def unregister_adapter(content_type: str) -> None:
    """حذف از رجیستری — عمدتاً برای تست."""
    _registry.pop(content_type, None)


def get_adapter(content_type: str) -> ContentAdapter | None:
    return _registry.get(content_type)


def registered_types() -> list[str]:
    return sorted(_registry)


async def list_content(filters: dict[str, Any]) -> list[dict]:
    """جست‌وجوی سراسری روی همهٔ adapterهای ثبت‌شده — خالی بودن رجیستری خطا نیست."""
    wanted_type = filters.get("type")
    wanted_module = filters.get("module")
    out: list[dict] = []
    for content_type in registered_types():
        if wanted_type and content_type != wanted_type:
            continue
        adapter = _registry[content_type]
        if wanted_module and adapter.module != wanted_module:
            continue
        for ref in await adapter.list_items(filters):
            out.append(asdict(ref))
    out.sort(key=lambda r: r.get("updated_at") or "", reverse=True)
    return out


async def preview_content(content_type: str, item_id: str) -> dict:
    adapter = get_adapter(content_type)
    if adapter is None:
        raise APIError(404, "unknown_content_type", f"نوع محتوای ناشناخته: {content_type}")
    preview = await adapter.get_preview(item_id)
    if preview is None:
        raise APIError(404, "content_not_found", "محتوا یافت نشد")
    data = asdict(preview)
    return data


async def content_policies(content_type: str, item_id: str) -> dict:
    adapter = get_adapter(content_type)
    if adapter is None:
        raise APIError(404, "unknown_content_type", f"نوع محتوای ناشناخته: {content_type}")
    policies = await adapter.get_policies(item_id)
    if policies is None:
        raise APIError(404, "content_not_found", "محتوا یافت نشد")
    return asdict(policies)
