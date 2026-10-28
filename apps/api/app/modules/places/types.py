"""Place-type registry for the 3D-globe maps phase.

Types are CRM-extensible: the ``places.types`` platform setting holds the
list, and this module owns the defaults + the defensive parser used by the
settings validator, the public-settings endpoint and the places service.
A type is ``{key, emoji, fa, ar, en}``; ``key`` is the stored value, the
emoji is the globe marker / legend symbol, and fa/ar/en are its labels.

Legacy note: older rows may carry ``shrine`` / ``holy_site`` (pre-globe
types). They are NOT in the default list — the globe renders them with the
``other`` fallback symbol — but an admin can retype them from CRM, and an
update that keeps a row's existing type is never rejected for it (see the
places service). Only the two seeded Haramain places were migrated to
``haramain`` by the globe migration.
"""
from __future__ import annotations

from typing import Any

DEFAULT_PLACE_TYPES: list[dict] = [
    {"key": "mosque", "emoji": "🕌", "fa": "مسجد", "ar": "مسجد", "en": "Mosque"},
    {"key": "haramain", "emoji": "🕋", "fa": "حرمین شریفین", "ar": "الحرمان الشريفان", "en": "The Two Holy Mosques"},
    {"key": "library", "emoji": "📚", "fa": "کتابخانه", "ar": "مكتبة", "en": "Library"},
    {"key": "museum", "emoji": "🏛️", "fa": "موزه", "ar": "متحف", "en": "Museum"},
    {"key": "pilgrimage", "emoji": "🌙", "fa": "مکان زیارتی", "ar": "مكان زيارة", "en": "Pilgrimage site"},
    {"key": "other", "emoji": "📍", "fa": "سایر", "ar": "أخرى", "en": "Other"},
]

_FALLBACK_EMOJI = "📍"


def parse_place_types(value: Any) -> list[dict]:
    """Defensive parse of a stored ``places.types`` value.

    Returns the canonical list (unknown entries dropped, keys de-duplicated
    keeping the first occurrence). Anything unparseable yields the defaults,
    never an exception — a bad stored value must not break the public globe.
    """
    if not isinstance(value, list) or not value:
        return [dict(t) for t in DEFAULT_PLACE_TYPES]
    out: list[dict] = []
    seen: set[str] = set()
    for raw in value:
        if not isinstance(raw, dict):
            continue
        key = raw.get("key")
        if not isinstance(key, str) or not key.strip() or len(key) > 32:
            continue
        key = key.strip()
        if key in seen:
            continue
        seen.add(key)
        emoji = raw.get("emoji")
        out.append({
            "key": key,
            "emoji": emoji if isinstance(emoji, str) and emoji.strip() else _FALLBACK_EMOJI,
            "fa": raw.get("fa") if isinstance(raw.get("fa"), str) and raw.get("fa") else key,
            "ar": raw.get("ar") if isinstance(raw.get("ar"), str) and raw.get("ar") else key,
            "en": raw.get("en") if isinstance(raw.get("en"), str) and raw.get("en") else key,
        })
    return out or [dict(t) for t in DEFAULT_PLACE_TYPES]


def type_keys(types: list[dict]) -> set[str]:
    return {t["key"] for t in types}


def emoji_for(types: list[dict], key: str) -> str:
    for t in types:
        if t["key"] == key:
            return t["emoji"]
    return _FALLBACK_EMOJI
