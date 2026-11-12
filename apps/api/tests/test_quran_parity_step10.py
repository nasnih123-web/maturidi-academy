"""تست‌های گام ۱۰ برابری با ترتیل — ایراد ۱۰ (زمان‌بندی تولیدشدهٔ قاری‌ها).

پوشش (دادهٔ مصنوعی در پوشهٔ موقت؛ مدل و شبکه در کار نیست):
- `get_generated_timing` دادهٔ تولیدشده را با همان قرارداد
  (کلمه‌ها نسبت به ابتدای فایل آیه، audio_url هر آیه) می‌خواند؛
- ویرایش ‎-2‎ از راه مانیفست به دادهٔ قاری پایه حل می‌شود؛
- نبود داده / سورهٔ نامعتبر → RecitationTimingError صادقانه؛
- `generated_available` پوشش را از مانیفست می‌شمارد (و شریک‌ها)؛
- دادهٔ واقعی پایلوت (ar.husary سورهٔ ۶۷) اگر روی دیسک هست، شکل
  و پوشش‌اش راستی‌آزمایی می‌شود.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.modules.quran import recitation_timing as rt


def _write_store(root: Path) -> None:
    (root / "ar.husary").mkdir(parents=True)
    body = {
        "edition": "ar.husary",
        "surah": 67,
        "source": "phoneme_alignment",
        "folder": "Husary_128kbps",
        "ayahs": [
            {
                "ayah": 1,
                "audio_url": "https://everyayah.com/data/Husary_128kbps/067001.mp3",
                "duration_ms": 15072,
                "words": [
                    {"word": 5, "start_ms": 960, "end_ms": 2840},
                    {"word": 6, "start_ms": 2840, "end_ms": 3840},
                ],
                "counts": {"correct": 9, "skipped": 4},
            }
        ],
    }
    (root / "ar.husary" / "067.json").write_text(
        json.dumps(body, ensure_ascii=False), encoding="utf-8"
    )
    manifest = {
        "version": 1,
        "editions": {
            "ar.husary": {
                "folder": "Husary_128kbps",
                "surahs_done": [67],
                "ayahs_done": 30,
                "surah_ayah_counts": {"67": 30},
                "ayahs_failed": {},
            }
        },
        "shared": {"ar.husary-2": "ar.husary"},
        "excluded": {"en.walk": "spoken translation narration"},
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )


@pytest.fixture()
def store(tmp_path, monkeypatch):
    _write_store(tmp_path)
    monkeypatch.setattr(rt, "_GENERATED_DIR", tmp_path)
    return tmp_path


def test_generated_timing_serves_ayah_relative_words(store):
    out = rt.get_generated_timing("ar.husary", 67)
    assert out["source"] == "phoneme_alignment"
    assert out["reciter"] == "ar.husary"
    ayah = out["ayahs"][0]
    assert ayah["audio_url"].endswith("067001.mp3")
    assert ayah["duration_ms"] == 15072
    assert ayah["words"] == [
        {"word": 5, "start_ms": 960, "end_ms": 2840},
        {"word": 6, "start_ms": 2840, "end_ms": 3840},
    ]


def test_generated_timing_alias_resolves_to_base(store):
    out = rt.get_generated_timing("ar.husary-2", 67)
    assert out["reciter"] == "ar.husary-2"
    assert out["ayahs"][0]["words"][0]["word"] == 5


def test_generated_timing_missing_is_honest_error(store):
    with pytest.raises(rt.RecitationTimingError):
        rt.get_generated_timing("ar.husary", 68)
    with pytest.raises(rt.RecitationTimingError):
        rt.get_generated_timing("ar.minshawi", 67)
    with pytest.raises(rt.RecitationTimingError):
        rt.get_generated_timing("ar.husary", 0)


def test_generated_available_counts_from_manifest(store):
    available = rt.generated_available()
    assert available == {"ar.husary": 1, "ar.husary-2": 1}


def test_generated_available_without_manifest(tmp_path, monkeypatch):
    monkeypatch.setattr(rt, "_GENERATED_DIR", tmp_path)
    assert rt.generated_available() == {}
    with pytest.raises(rt.RecitationTimingError):
        rt.get_generated_timing("ar.husary", 67)


def test_pilot_data_on_disk_is_wellformed():
    """دادهٔ واقعی پایلوت گام ۱۰ (حصری، سورهٔ ملک) — اگر تولید شده."""
    path = (
        Path(__file__).resolve().parent.parent
        / "app/modules/quran/data/timings/ar.husary/067.json"
    )
    if not path.is_file():
        pytest.skip("pilot data not generated on this machine")
    body = json.loads(path.read_text(encoding="utf-8"))
    assert body["source"] == "phoneme_alignment"
    assert len(body["ayahs"]) == 30
    total_words = timed = 0
    for ayah in body["ayahs"]:
        total_words += sum(ayah["counts"].values())
        timed += len(ayah["words"])
        starts = [w["start_ms"] for w in ayah["words"]]
        assert starts == sorted(starts)
        for w in ayah["words"]:
            assert 0 <= w["start_ms"] < w["end_ms"] <= ayah["duration_ms"] + 50
    # پایلوت ۲۰۲۶-۱۱-۱۲: ۳۳۳ از ۳۵۲ کلمه زمان گرفتند (۹۴٫۶٪).
    assert timed == 333 and total_words == 352
