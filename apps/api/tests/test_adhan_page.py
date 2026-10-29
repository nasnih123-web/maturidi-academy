"""تست‌های صفحهٔ اوقات شرعی (/adhan): جدول تربت جام، روش‌های تازه، بازه، CRM.

- رگرسیون جدول: محاسبهٔ مستقل (موتور PrayTimes با روش council ۱۵/۱۵ و عصر
  حنفی) در برابر هر ۳۶۵ ردیف جدول تربت جام. تلورانس ۲ دقیقه است — نه ۱:
  میانگین قدرمطلق اختلاف‌ها ۰٫۶۹ دقیقه و سقف ۲ دقیقه است (میانگین علامت‌دار
  هر ستون ≤۰٫۱۰ دقیقه؛ خط لولهٔ اپی‌مریس/گردکردنِ مولد جدول با PrayTimes
  فرق می‌کند). مسیر جدول در پروداکشن خودِ ردیف‌های جدول را می‌دهد (دقیق)
  و این تست فقط توافق محاسبهٔ مستقل را کران‌دار می‌کند.
- مسیر جدول از API: تربت جام + council → source=table و زمان‌های عین جدول.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

BASE = "/api/v1"

TORBAT = {"lat": 35.24306, "lng": 60.625}
TABLE_ROW_0101 = ["04:22", "05:31", "11:35", "15:55", "17:39", "18:49"]
SIX = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"]


def _to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


# ---------------------------------------------------------------------------
# تبدیل جلالی (واحد — بدون شبکه و بدون دیتابیس)
# ---------------------------------------------------------------------------


def test_jalali_anchors_and_roundtrip():
    from app.modules.quran import jalali as j

    anchors = [
        (date(2026, 3, 21), (1405, 1, 1)),
        (date(2025, 3, 20), (1403, 12, 30)),
        (date(2027, 3, 20), (1405, 12, 29)),
        (date(2026, 10, 28), (1405, 8, 6)),
        (date(2030, 3, 20), (1408, 12, 30)),
    ]
    for g, jy in anchors:
        assert j.to_jalali(g) == jy, (g, jy)
        assert j.from_jalali(*jy) == g, (jy, g)
    assert j.is_jalali_leap(1403) is True
    assert j.is_jalali_leap(1405) is False
    assert j.is_jalali_leap(1408) is True
    assert j.jalali_month_length(1405, 12) == 29
    assert j.jalali_month_length(1408, 12) == 30
    d = date(2026, 1, 1)
    for _ in range(800):
        assert j.from_jalali(*j.to_jalali(d)) == d
        d += timedelta(days=1)


def test_torbat_table_regression_within_2_minutes():
    """محاسبهٔ مستقل council/حنفی در برابر جدول — میانگین قدرمطلق <۱ و سقف ۲ دقیقه."""
    from app.modules.quran import adhan as adhan_calc
    from app.modules.quran import adhan_data
    from app.modules.quran import jalali as j

    table = adhan_data.load_torbat_table()
    assert len(table) == 365
    assert "12-30" not in table
    diffs: list[int] = []
    for key in sorted(table):
        mm, dd = int(key[:2]), int(key[3:])
        g = j.from_jalali(1405, mm, dd)
        t = adhan_calc.prayer_times(
            g, TORBAT["lat"], TORBAT["lng"], tz=3.5, method="council", madhab="hanafi"
        )
        for i, name in enumerate(SIX):
            diffs.append(abs(_to_min(t[name]) - _to_min(table[key][i])))
    assert max(diffs) <= 2, f"max diff {max(diffs)}"
    assert sum(diffs) / len(diffs) < 1.0, f"mean abs diff {sum(diffs) / len(diffs):.3f}"


def test_ramadan_detection_firm_dates():
    from app.modules.quran import adhan_data

    assert adhan_data.is_ramadan(date(2026, 3, 1)) is True
    assert adhan_data.is_ramadan(date(2025, 3, 15)) is True
    assert adhan_data.is_ramadan(date(2026, 1, 15)) is False
    assert adhan_data.is_ramadan(date(2026, 6, 1)) is False


def test_adhan_defaults_validation_extended():
    from app.core.platform_settings import encode_setting_value

    out = encode_setting_value("json", {}, "adhan.defaults")
    parsed = json.loads(out)
    assert parsed == {
        "calculation_method": "council",
        "madhab": "hanafi",
    }
    out = encode_setting_value(
        "json",
        {"calculation_method": "tehran", "madhab": "shafi"},
        "adhan.defaults",
    )
    assert json.loads(out) == {"calculation_method": "tehran", "madhab": "shafi"}
    # LEGACY TOLERANCE: old stored dicts with default_city parse cleanly,
    # the city simply ignored (never an error, never written back).
    for legacy in (
        {"calculation_method": "tehran", "madhab": "shafi", "default_city": "khaf"},
        {"calculation_method": "council", "madhab": "hanafi", "default_city": ""},
    ):
        out = encode_setting_value("json", legacy, "adhan.defaults")
        assert "default_city" not in json.loads(out)
    for bad in (
        {"calculation_method": "nope", "madhab": "hanafi"},
        {"calculation_method": "council", "madhab": "nope"},
        {"calculation_method": "council", "madhab": "hanafi", "surprise": 1},
    ):
        with pytest.raises(ValueError):
            encode_setting_value("json", bad, "adhan.defaults")


# ---------------------------------------------------------------------------
# API: مسیر جدول، روش‌ها، بازه
# ---------------------------------------------------------------------------


async def test_times_torbat_council_serves_exact_table(tc):
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"city": "torbat-e-jam", "method": "council", "madhab": "hanafi",
                "day": "2026-03-21", "tz": 3.5},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "table"
    assert body["city"] == "torbat-e-jam"
    for i, name in enumerate(SIX):
        assert body["times"][name] == TABLE_ROW_0101[i], name
    assert body["times"]["imsak"] == "04:12"  # فجر − ۱۰ دقیقه


async def test_times_torbat_council_shafi_asr_is_computed(tc):
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"city": "torbat-e-jam", "method": "council", "madhab": "shafi",
                "day": "2026-03-21", "tz": 3.5},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "mixed"
    assert body["sources"]["asr"] == "computed"
    assert body["times"]["asr"] != "15:55"  # عصر شافعی در جدول نیست
    row = dict(zip(SIX, TABLE_ROW_0101))
    for name in ("fajr", "sunrise", "dhuhr", "maghrib", "isha"):
        assert body["times"][name] == row[name], name


async def test_times_torbat_other_method_is_computed(tc):
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"city": "torbat-e-jam", "method": "karachi", "madhab": "hanafi",
                "day": "2026-03-21", "tz": 3.5},
    )
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "computed"


async def test_times_france_method_valid_and_ordered_vs_isna(tc):
    """فرانسه/UOIF (۱۲/۱۲) در برابر ISNA (۱۵/۱۵): زاویهٔ کوچک‌تر یعنی فجر
    دیرتر و عشا زودتر؛ و عصر تابع مذهب می‌ماند (تغییری در منطق عصر نیست)."""
    client = tc["client"]
    base = {"lat": 35.6892, "lng": 51.3890, "day": "2026-10-19", "tz": 3.5}
    fr = await client.get(
        f"{BASE}/adhan/times",
        params={**base, "method": "france", "madhab": "hanafi"},
    )
    assert fr.status_code == 200, fr.text
    fr_body = fr.json()
    assert fr_body["method"] == "france"
    assert set(fr_body["times"]) == {"imsak", "fajr", "sunrise", "dhuhr",
                                     "asr", "maghrib", "isha", "midnight"}
    isna = (await client.get(
        f"{BASE}/adhan/times",
        params={**base, "method": "isna", "madhab": "hanafi"},
    )).json()["times"]
    fr_times = fr_body["times"]
    assert _to_min(fr_times["fajr"]) > _to_min(isna["fajr"])
    assert _to_min(fr_times["isha"]) < _to_min(isna["isha"])
    # بقیهٔ اوقات (طلوع، ظهر، مغرب) به روش وابسته نیستند.
    assert fr_times["sunrise"] == isna["sunrise"]
    assert fr_times["dhuhr"] == isna["dhuhr"]
    assert fr_times["maghrib"] == isna["maghrib"]
    assert fr_times["asr"] == isna["asr"]


async def test_times_unknown_method_is_rejected_by_validation(tc):
    """روش ناشناخته → ۴۲۲ اعتبارسنجی FastAPI (بدون عدد حدسی، بدون مسیر محاسبه)."""
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"city": "torbat-e-jam", "method": "nope", "madhab": "hanafi",
                "day": "2026-03-21", "tz": 3.5},
    )
    assert r.status_code == 422, r.text


async def test_times_invalid_city_and_missing_location(tc):
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"city": "nowhere", "method": "council", "day": "2026-03-21", "tz": 3.5},
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "invalid_city"
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"method": "council", "day": "2026-03-21", "tz": 3.5},
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "missing_location"


async def test_times_date_alias_matches_day(tc):
    client = tc["client"]
    params = {"city": "torbat-e-jam", "method": "council", "madhab": "hanafi", "tz": 3.5}
    a = await client.get(f"{BASE}/adhan/times", params={**params, "day": "2026-03-21"})
    b = await client.get(f"{BASE}/adhan/times", params={**params, "date": "2026-03-21"})
    assert a.status_code == 200 and b.status_code == 200
    assert a.json()["times"] == b.json()["times"]


async def test_times_esfand_30_falls_back_to_computation(tc):
    """۱۴۰۸-۱۲-۳۰ = ۲۰۳۰-۰۳-۲۰؛ جدول ۱۲-۳۰ ندارد → computed."""
    from app.modules.quran import jalali as j

    assert j.to_jalali(date(2030, 3, 20)) == (1408, 12, 30)
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"city": "torbat-e-jam", "method": "council", "madhab": "hanafi",
                "day": "2030-03-20", "tz": 3.5},
    )
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "computed"


async def test_range_week_and_cap(tc):
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/range",
        params={"city": "torbat-e-jam", "method": "council", "madhab": "hanafi",
                "start": "2026-03-21", "end": "2026-03-27", "tz": 3.5},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["days"]) == 7
    assert body["days"][0]["date"] == "2026-03-21"
    assert body["days"][0]["source"] == "table"
    for i, name in enumerate(SIX):
        assert body["days"][0]["times"][name] == TABLE_ROW_0101[i]
    r = await client.get(
        f"{BASE}/adhan/range",
        params={"city": "torbat-e-jam", "method": "council", "madhab": "hanafi",
                "start": "2026-01-01", "end": "2027-01-02", "tz": 3.5},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "range_too_long"


async def test_range_full_jalali_year_length(tc):
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/range",
        params={"city": "torbat-e-jam", "method": "council", "madhab": "hanafi",
                "start": "2026-03-21", "end": "2027-03-20", "tz": 3.5},
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["days"]) == 365


async def test_options_lists_methods_and_cities(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/adhan/options")
    assert r.status_code == 200, r.text
    body = r.json()
    by_id = {m["id"]: m for m in body["methods"]}
    assert by_id["council"]["fajr"] == 15.0 and by_id["council"]["isha"] == 15.0
    assert by_id["tehran"]["fajr"] == 17.7 and by_id["tehran"]["isha"] == 14.0
    assert by_id["tehran"]["maghrib"] == 4.5
    assert by_id["france"]["fajr"] == 12.0 and by_id["france"]["isha"] == 12.0
    # روش حذف‌شده به دستور کاربر هیچ ردیفی ندارد: فهرست دقیقاً همان ۱۰ روش است
    # (۹ روش پیشین + فرانسه/UOIF که در همین تغییر اضافه شد).
    assert set(by_id) == {"council", "tehran", "isna", "mwl", "egypt",
                          "karachi", "makkah", "qom", "jafari", "france"}
    cities = {c["slug"]: c for c in body["cities"]}
    assert cities["torbat-e-jam"]["lat"] == 35.24306
    assert cities["torbat-e-jam"]["lng"] == 60.625


async def test_makkah_ramadan_interval(tc):
    client = tc["client"]
    base = {"lat": 21.3891, "lng": 39.8579, "method": "makkah", "madhab": "shafi",
            "day": "2026-03-01", "tz": 3.0}
    auto = (await client.get(f"{BASE}/adhan/times", params=base)).json()["times"]
    assert _to_min(auto["isha"]) - _to_min(auto["maghrib"]) == 120  # رمضان: خودکار
    off = (await client.get(
        f"{BASE}/adhan/times", params={**base, "ramadan": False})).json()["times"]
    assert _to_min(off["isha"]) - _to_min(off["maghrib"]) == 90


async def test_high_latitude_times_are_finite(tc):
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"lat": 69.6, "lng": 18.9, "method": "mwl", "madhab": "hanafi",
                "day": "2026-06-21", "tz": 2.0},
    )
    assert r.status_code == 200, r.text
    for v in r.json()["times"].values():
        hh, mm = v.split(":")
        assert 0 <= int(hh) <= 23 and 0 <= int(mm) <= 59


# ---------------------------------------------------------------------------
# جست‌وجوی مکان (Nominatim — شبکه همیشه mock است، هرگز زنده نیست)
# ---------------------------------------------------------------------------


def _geocode_module():
    from app.modules.quran import geocode

    return geocode


def _search_item(display, lat, lon, address):
    item = {"display_name": display, "lat": str(lat), "lon": str(lon)}
    if address is not None:
        item["address"] = address
    return item


async def test_geocode_search_short_name_chain(tc, monkeypatch):
    g = _geocode_module()
    calls = []

    def fake_http(path, params):
        calls.append((path, params["q"]))
        return [
            _search_item("X village, County, State", 35.1, 60.5,
                         {"village": "X village", "county": "County"}),
            _search_item("Y town, County, State", 35.2, 60.6,
                         {"town": "Y town", "county": "County"}),
            _search_item("Z County, State", 35.3, 60.7, {"county": "Z County"}),
        ]

    monkeypatch.setattr(g, "_http_get", fake_http)
    client = tc["client"]
    r = await client.get(f"{BASE}/adhan/geocode", params={"q": "chain-probe-xyz"})
    assert r.status_code == 200, r.text
    results = r.json()["results"]
    assert [x["name"] for x in results] == ["X village", "Y town", "Z County"]
    assert results[0]["lat"] == 35.1 and results[0]["lng"] == 60.5
    assert calls[0][0] == "/search"


async def test_geocode_search_no_address_falls_back_to_display_name(tc, monkeypatch):
    g = _geocode_module()
    monkeypatch.setattr(
        g, "_http_get",
        lambda path, params: [_search_item("Nameless Place, Region", 10.0, 20.0, None)],
    )
    client = tc["client"]
    r = await client.get(f"{BASE}/adhan/geocode", params={"q": "fallback-probe-xyz"})
    assert r.status_code == 200, r.text
    assert r.json()["results"][0]["name"] == "Nameless Place"


async def test_geocode_search_upstream_failure_is_502(tc, monkeypatch):
    g = _geocode_module()

    def boom(path, params):
        raise g.GeocodeUpstreamError("nominatim down")

    monkeypatch.setattr(g, "_http_get", boom)
    client = tc["client"]
    r = await client.get(f"{BASE}/adhan/geocode", params={"q": "failure-probe-xyz"})
    assert r.status_code == 502, r.text
    assert r.json()["error"]["code"] == "geocode_upstream_unavailable"


async def test_geocode_reverse_name_and_no_name(tc, monkeypatch):
    g = _geocode_module()
    monkeypatch.setattr(
        g, "_http_get",
        lambda path, params: _search_item(
            "Khaf, Razavi Khorasan, Iran", 34.5723, 60.144,
            {"town": "Khaf", "county": "Khaf"}),
    )
    client = tc["client"]
    r = await client.get(f"{BASE}/adhan/reverse", params={"lat": 34.5723, "lng": 60.144})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Khaf"
    monkeypatch.setattr(
        g, "_http_get",
        lambda path, params: {"display_name": "", "lat": "0.0", "lon": "0.0"},
    )
    r = await client.get(f"{BASE}/adhan/reverse", params={"lat": 0.0, "lng": 0.0})
    assert r.status_code == 200, r.text
    assert r.json()["name"] is None  # نبودِ نام خطا نیست


# ---------------------------------------------------------------------------
# نزدیکی به تربت جام (شعاع ۳۵ کیلومتر) بدون فیلد شهر
# ---------------------------------------------------------------------------


async def test_times_near_torbat_coords_serve_table(tc):
    """مختصات ~۲۰ کیلومتری تربت جام + council → جدول (بدون پارامتر city)."""
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"lat": 35.10, "lng": 60.50, "method": "council", "madhab": "hanafi",
                "day": "2026-03-21", "tz": 3.5},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "table"
    assert body["city"] is None
    for i, name in enumerate(SIX):
        assert body["times"][name] == TABLE_ROW_0101[i], name


async def test_times_far_coords_with_council_are_computed(tc):
    """تهران + council → محاسبه (خارج از شعاع جدول)."""
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"lat": 35.6892, "lng": 51.389, "method": "council", "madhab": "hanafi",
                "day": "2026-03-21", "tz": 3.5},
    )
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "computed"


async def test_times_esfand_30_via_coords_falls_back_to_computation(tc):
    """۱۴۰۸-۱۲-۳۰ با مختصات تربت جام → computed (جدول ۱۲-۳۰ ندارد)."""
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={"lat": 35.24306, "lng": 60.625, "method": "council", "madhab": "hanafi",
                "day": "2030-03-20", "tz": 3.5},
    )
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "computed"
