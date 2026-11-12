"""تست‌های گام ۵ برابری با ترتیل — ایراد ۹ (ترجمه/تفسیر).

پوشش:
- provider باندل‌شده دو ترجمهٔ فارسیِ خود ترتیل (رواد/تاجی) را از
  دادهٔ سمت سرور می‌دهد: پوشش کامل، متن واقعی فارسی، بدون شبکه.
- edition ناشناخته و تفسیرِ نصب‌نشده خطای صادقانه می‌دهند؛
  bundled_available دقیقاً وضعیت دیسک را گزارش می‌کند.
- مسیریابی به‌ازای edition: رواد/تاجی/تفسیرهای فارسی از bundled
  می‌آیند و بقیه از provider نوعشان.
- importer تفسیر QUL: هر دو شکل جدول (sura+aya و ayah_key) را
  می‌خواند و پوشش ناقص را رد می‌کند.
- کش stale-on-error: با قطع upstream، آخرین پاسخ گرفته‌شده سرو
  می‌شود؛ بدون کش، همان خطا بالا می‌آید.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import pytest

from app.modules.quran import providers as qp
from app.modules.quran import service as quran_service


async def test_bundled_rowwad_and_taji_serve_full_translations():
    provider = qp.BundledEditionsProvider()
    for edition in ("fa.rowwad", "fa.taji"):
        data = qp._load_bundled(edition)
        assert len(data) == 6236
        out = await provider.fetch_ayah(1, 1, translation_edition=edition)
        text = out["editions"][edition].text
        # متن واقعی فارسی بسمله — رواد «الله» می‌نویسد، تاجی «خداوند».
        assert text and text.startswith("به نام")
        surah = await provider.fetch_surah(1, translation_edition=edition)
        assert [a["number_in_surah"] for a in surah["ayahs"]] == list(range(1, 8))
        assert surah["edition_ids"] == [edition]
    # دو ترجمه متن یکسان ندارند.
    r = await provider.fetch_ayah(2, 255, translation_edition="fa.rowwad")
    t = await provider.fetch_ayah(2, 255, translation_edition="fa.taji")
    assert r["editions"]["fa.rowwad"].text != t["editions"]["fa.taji"].text


async def test_bundled_unknown_and_uninstalled_are_honest_errors():
    provider = qp.BundledEditionsProvider()
    with pytest.raises(qp.QuranProviderError):
        await provider.fetch_ayah(1, 1, translation_edition="fa.nope")
    with pytest.raises(qp.QuranProviderError):
        await provider.fetch_ayah(1, 1, text_edition="quran-uthmani")
    available = qp.bundled_available()
    assert available["translation"] == ["fa.rowwad", "fa.taji"]
    for edition in ("fa.mokhtasar", "fa.saadi"):
        if edition not in available["tafsir"]:
            with pytest.raises(qp.QuranProviderError):
                await provider.fetch_ayah(1, 1, tafsir_edition=edition)


def test_edition_provider_overrides_route_groups():
    sel = {
        "providers_by_type": {
            "text": "self_hosted",
            "translation": "alquran_cloud",
            "tafsir": "alquran_cloud",
            "audio": "alquran_cloud",
        },
        "text_edition": "quran-uthmani",
        "translation_edition": None,
        "tafsir_edition": None,
        "reciter_edition": None,
    }
    groups = dict(
        quran_service._group_editions_by_provider(
            sel, translation="fa.taji", tafsir="fa.mokhtasar"
        )
    )
    assert groups["bundled"] == {
        "translation_edition": "fa.taji",
        "tafsir_edition": "fa.mokhtasar",
    }
    groups = dict(
        quran_service._group_editions_by_provider(
            sel, translation="fa.fooladvand", tafsir="ar.muyassar"
        )
    )
    assert groups["alquran_cloud"] == {
        "translation_edition": "fa.fooladvand",
        "tafsir_edition": "ar.muyassar",
    }


def _make_sqlite(path: Path, shape: str) -> None:
    con = sqlite3.connect(path)
    if shape == "sura_aya":
        con.execute("CREATE TABLE tafsir (sura INT, aya INT, text TEXT)")
        con.executemany(
            "INSERT INTO tafsir VALUES (?, ?, ?)",
            [(1, 1, "الف"), (1, 2, "ب"), (2, 1, "ج")],
        )
    else:
        con.execute("CREATE TABLE tafsir (ayah_key TEXT, text TEXT)")
        con.executemany(
            "INSERT INTO tafsir VALUES (?, ?)",
            [("1:1", "الف"), ("1:2", "ب"), ("2:1", "ج")],
        )
    con.commit()
    con.close()


def test_importer_reads_both_shapes_and_rejects_incomplete(tmp_path):
    import importlib.util

    script = (
        Path(__file__).resolve().parent.parent
        / "scripts"
        / "import_qul_tafsir.py"
    )
    spec = importlib.util.spec_from_file_location("import_qul_tafsir", script)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)

    for shape in ("sura_aya", "key"):
        db_file = tmp_path / f"{shape}.sqlite"
        _make_sqlite(db_file, shape)
        data = module.convert(db_file)
        assert data == {"1:1": "الف", "1:2": "ب", "2:1": "ج"}
        with pytest.raises(ValueError):
            module.validate_full(data)  # پوشش کامل ۶۲۳۶ نیست → رد


async def test_alquran_stale_cache_served_on_upstream_failure(monkeypatch):
    provider = qp.AlQuranCloudProvider()
    stale_result = {"ayahs": [], "edition_ids": ["fa.fooladvand"]}
    key = "surah:alquran_cloud:1:fa.fooladvand"
    with qp._cache_lock:
        qp._cache[key] = (time.monotonic() - 100_000.0, stale_result)
    try:
        async def _boom(path: str):
            raise qp.QuranProviderError("down", provider_id="alquran_cloud")

        monkeypatch.setattr(provider, "_get", _boom)
        out = await provider.fetch_surah(1, translation_edition="fa.fooladvand")
        assert out is stale_result
        # بدون کش، خطا باید بالا بیاید نه پاسخ ساختگی.
        with qp._cache_lock:
            qp._cache.pop(key, None)
        with pytest.raises(qp.QuranProviderError):
            await provider.fetch_surah(1, translation_edition="fa.fooladvand")
    finally:
        with qp._cache_lock:
            qp._cache.pop(key, None)
