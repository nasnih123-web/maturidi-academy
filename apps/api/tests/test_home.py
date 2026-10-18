"""تست‌های خانه و جست‌وجو — فاز ۳.

روی دیتابیس SQLite مشترک (فیکسچر tc) — داده‌ها با کلیدهای یکتا ساخته می‌شوند تا
با تست‌های دیگر تداخل نکنند؛ هر جهشِ platform_settings با reset_settings_cache
همراه است چون get_setting کش درون‌فرایندی دارد.
"""
from __future__ import annotations

from sqlalchemy import delete, select

BASE = "/api/v1"

EXPECTED_KEYS = [
    "hero",
    "live_status",
    "latest_fatwas",
    "quran_of_day",
    "suggested_lessons",
    "fresh_library",
    "community",
    "nearby_map",
    "donation_banner",
    "footer",
]


async def _seed_sections(tc):
    from app.seed import seed_home_sections

    async with tc["maker"]() as db:
        await seed_home_sections(db)
        await db.commit()


async def _set_theme_keys(tc, keys: dict):
    from app.core.platform_settings import reset_settings_cache, stage_setting

    async with tc["maker"]() as db:
        for k, v in keys.items():
            await stage_setting(db, k, v)
        await db.commit()
    reset_settings_cache()


async def _clear_theme_keys(tc):
    from app.core.platform_settings import reset_settings_cache
    from app.models.models import PlatformSetting

    async with tc["maker"]() as db:
        await db.execute(delete(PlatformSetting).where(PlatformSetting.key.like("theme.%")))
        await db.commit()
    reset_settings_cache()


async def _add_section(tc, key, title_fa, subtitle_fa=None, visible=True, sort_order=100):
    from app.models.models import HomeSection

    async with tc["maker"]() as db:
        row = HomeSection(
            key=key,
            sort_order=sort_order,
            visible=visible,
            title={"fa": title_fa, "ar": "نص عربي", "en": "English text"},
            subtitle=(
                {"fa": subtitle_fa, "ar": "نص عربي", "en": "English text"}
                if subtitle_fa
                else None
            ),
        )
        db.add(row)
        await db.commit()


# ---------- /home/sections ----------


async def test_home_sections_ten_in_order(tc):
    await _seed_sections(tc)
    client = tc["client"]
    r = await client.get(f"{BASE}/home/sections")
    assert r.status_code == 200, r.text
    body = r.json()
    # شکل frozen
    assert set(body.keys()) == {"theme", "sections"}
    assert body["theme"] is None  # هیچ کلید theme.* تنظیم نشده
    assert [s["key"] for s in body["sections"]] == EXPECTED_KEYS
    assert [s["order"] for s in body["sections"]] == list(range(1, 11))
    assert all(s["visible"] for s in body["sections"])
    hero = body["sections"][0]
    assert hero["title"] == {
        "fa": "آکادمی ماتریدی",
        "ar": "أكاديمية الماتريدي",
        "en": "Maturidi Academy",
    }
    assert hero["data"] == {"search_enabled": True}
    assert hero["empty"] is None
    fatwa = body["sections"][2]
    assert fatwa["data"] is None
    assert fatwa["empty"]["title"]["fa"] == "به‌زودی"
    assert fatwa["empty"]["hint"]["en"] == "This section will be available soon."
    donate = body["sections"][8]
    assert donate["data"] == {"cta_url": "/donate"}


async def test_home_hidden_section_excluded(tc):
    await _add_section(tc, "hidden_ghost", "روح پنهان xyzghost", visible=False, sort_order=50)
    client = tc["client"]
    r = await client.get(f"{BASE}/home/sections")
    assert r.status_code == 200, r.text
    keys = [s["key"] for s in r.json()["sections"]]
    assert "hidden_ghost" not in keys
    assert keys == EXPECTED_KEYS  # ترتیب ۱۰ بخش اصلی دست‌نخورده


async def test_home_theme_overrides(tc):
    client = tc["client"]
    await _set_theme_keys(
        tc,
        {
            "theme.palette.color-primary-700": "#0a5c44",
            "theme.fonts.body": "Vazirmatn",
            "theme.fonts.heading": "Lalezar",
            "theme.unknown.foo": "ignored",  # کلید ناشناخته زیر theme.* نادیده گرفته می‌شود
        },
    )
    r = await client.get(f"{BASE}/home/sections")
    assert r.status_code == 200, r.text
    theme = r.json()["theme"]
    assert theme == {
        "palette": {"color-primary-700": "#0a5c44"},
        "fonts": {"body": "Vazirmatn", "heading": "Lalezar"},
    }
    # پاک‌سازی: دوباره theme باید null شود
    await _clear_theme_keys(tc)
    r = await client.get(f"{BASE}/home/sections")
    assert r.json()["theme"] is None


# ---------- /search ----------


async def test_search_prefix_beats_substring(tc):
    client = tc["client"]
    await _add_section(tc, "s_alpha", "کتابخانهٔ بزرگ", sort_order=100)
    await _add_section(tc, "s_beta", "منابع کتاب", sort_order=101)
    r = await client.get(f"{BASE}/search", params={"q": "کتاب"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) == {"query", "results", "total"}
    assert body["query"] == "کتاب"
    # s_alpha تطابق پیشوندی (امتیاز ۲) و s_beta تطابق درونی (امتیاز ۱)
    assert body["results"][0]["id"] == "s_alpha"
    assert body["results"][0]["score"] > body["results"][1]["score"]
    assert body["results"][0]["type"] == "section"
    assert body["results"][0]["title"]["fa"] == "کتابخانهٔ بزرگ"
    assert body["total"] >= 2


async def test_search_type_filter(tc):
    from app.models.models import Theme

    async with tc["maker"]() as db:
        db.add(
            Theme(name={"fa": "قالب آزمایشی جست‌وجو", "ar": "قالب", "en": "Search Theme"})
        )
        await db.commit()
    client = tc["client"]

    r = await client.get(f"{BASE}/search", params={"q": "قالب"})
    ids_all = {hit["type"] for hit in r.json()["results"]}
    assert ids_all == {"theme"}

    r = await client.get(f"{BASE}/search", params={"q": "قالب", "type": "section"})
    body = r.json()
    assert body["results"] == [] and body["total"] == 0

    r = await client.get(f"{BASE}/search", params={"q": "کتاب", "type": "section"})
    assert all(h["type"] == "section" for h in r.json()["results"])

    # type ناشناخته → خالی، نه خطا (forward-compatible)
    r = await client.get(f"{BASE}/search", params={"q": "کتاب", "type": "fatwa"})
    assert r.status_code == 200 and r.json()["results"] == []


async def test_search_hidden_section_not_searchable(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/search", params={"q": "xyzghost"})
    assert r.status_code == 200, r.text
    assert r.json()["results"] == [] and r.json()["total"] == 0


async def test_search_q_blank_422(tc):
    client = tc["client"]
    for params in ({"q": "   "}, {"q": ""}):
        r = await client.get(f"{BASE}/search", params=params)
        assert r.status_code == 422, r.text
        assert "error" in r.json() and "request_id" in r.json()  # پاکت یکدست
    # q اصلاً نفرستاده شود
    r = await client.get(f"{BASE}/search")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    # بیش از ۲۰۰ کاراکتر
    r = await client.get(f"{BASE}/search", params={"q": "x" * 201})
    assert r.status_code == 422


async def test_search_no_match(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/search", params={"q": "zzzz_no_match_token"})
    assert r.status_code == 200, r.text
    assert r.json() == {"query": "zzzz_no_match_token", "results": [], "total": 0}


async def test_search_limit(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/search", params={"q": "کتاب", "limit": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["results"]) == 1
    assert body["total"] >= 2  # total قبل از limit
    # سقف ۵۰
    r = await client.get(f"{BASE}/search", params={"q": "کتاب", "limit": 51})
    assert r.status_code == 422
