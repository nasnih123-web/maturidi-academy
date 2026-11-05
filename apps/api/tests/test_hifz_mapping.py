"""تست‌های بارگذار نگاشت واج‌به‌کلمه (فاز ۳: یکپارچه‌سازی دادهٔ واقعی).

پوشش:
- تجزیهٔ واجی با تطابقِ حریصانهٔ بلندترین نماد (tokens.txt).
- تراز DP: ادغام (یک واج → چند کلمه) و شکافت (چند واج → یک کلمه).
- جداسازی بسمله/رد وقف از متن Tanzil و ترجمهٔ شاخص‌ها به مبنای
  ارائه‌شده (بسمله در آیهٔ ۱، رد وقف در جای خود).
- بارگذاری کامل از پوشهٔ مصنوعی: پیش‌چسب بسمله، رد خودکار وقف،
  رد آیهٔ دارای نماد ناشناخته یا تراز ناممکن، خطای صادقانه برای
  فایلِ گمشده/خراب.
- آزمون دادهٔ واقعی (فقط وقتی QURAN_PHONEME_MAP_DIR تنظیم شده باشد):
  پذیرش کلی، قطعه‌های دقیق آیه‌های نمونه، و تراز زندهٔ سرتاسری با
  رشته‌های واجی واقعی از نگاشت از مسیر feed_phonemes.
- هیچ دادهٔ واقعی در تست‌ها متعهد نشده است (فایل‌های JSON نگاشت،
  بیرون از مخزن می‌مانند؛ آزمون واقعی با متغیر محیطی فعال می‌شود).
"""

from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.modules.quran.hifz_mapping import (
    MappingPendingError,
    _align_segments,
    _levenshtein_bounded,
    _segment_phonemes,
    _split_adjusted,
    load_phoneme_mapping,
)

_TANZIL = Path(__file__).resolve().parent.parent / (
    "app/modules/quran/data/tanzil_uthmani.txt"
)


def _tanzil_dict():
    out = {}
    for line in _TANZIL.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^(\d+)\|(\d+)\|(.*)$", line)
        if m:
            out.setdefault(int(m.group(1)), {})[int(m.group(2))] = m.group(3)
    return out


def _tanzil_ayah(surah: int, ayah: int) -> str:
    return _tanzil_dict()[surah][ayah]


# ---------------------------------------------------------------------------
# تجزیهٔ واجی و تراز DP
# ---------------------------------------------------------------------------


def test_segment_phonemes_prefers_longest_symbol():
    symbols = {"اا", "ا", "بَ", "ب", "ل"}
    assert _segment_phonemes("اابَ", symbols) == ["اا", "بَ"]
    assert _segment_phonemes("ابل", symbols) == ["ا", "ب", "ل"]


def test_segment_phonemes_unknown_symbol_returns_none():
    symbols = {"ا", "ب"}
    assert _segment_phonemes("اX", symbols) is None
    assert _segment_phonemes("", symbols) == []


def test_levenshtein_bounded_matches_plain_and_exits_early():
    from app.modules.quran.alignment import levenshtein

    cases = [
        ("abc", "abc"),
        ("abc", "abd"),
        ("kitten", "sitting"),
        ("", "abc"),
        ("abc", ""),
        ("aaaa", "bbbb"),
    ]
    for a, b in cases:
        assert _levenshtein_bounded(a, b, 100) == levenshtein(a, b)
    # Within bound → exact; beyond bound → bound+1 (early exit).
    assert _levenshtein_bounded("abc", "abd", 1) == 1
    assert _levenshtein_bounded("abc", "abd", 0) == 1
    assert _levenshtein_bounded("abc", "xyz", 1) == 2


def test_align_segments_merge_one_phoneme_to_two_words():
    # ادغام در تلفظ پیوسته: یک واج، دو کلمهٔ نوشتاری.
    aligned = _align_segments(
        ["بَرَااااءَتُممممِنَ"], ["بَرَآءَةٌ", "مِّنَ"]
    )
    assert aligned is not None
    _cost, pairs = aligned
    assert pairs == [((0, 1), (0,))]


def test_align_segments_split_two_phonemes_to_one_word():
    # شکافت حروف مقطعه: دو واج، یک کلمهٔ نوشتاری.
    aligned = _align_segments(
        ["ءَلِف", "لَااااااممممِۦۦۦۦۦۦم"], ["الٓمٓ"]
    )
    assert aligned is not None
    _cost, pairs = aligned
    assert pairs == [((0,), (0, 1))]


def test_align_segments_four_word_merge():
    # زنجیرهٔ ادغام چهارکلمه‌ای (مثل ۱۰۵:۴) با سقف ۶ پوشش داده می‌شود.
    aligned = _align_segments(["abcdefgh"], ["ab", "cd", "ef", "gh"])
    assert aligned is not None
    _cost, pairs = aligned
    assert pairs == [((0, 1, 2, 3), (0,))]


def test_align_segments_impossible_returns_none():
    # یک واج نمی‌تواند نه کلمه را بپوشاند (سقف ادغام ۸ کلمه).
    assert (
        _align_segments(["ق"], ["ا", "ب", "ج", "د", "ه", "و", "ز", "ح", "ط"]) is None
    )


# ---------------------------------------------------------------------------
# جداسازی بسمله و رد وقف
# ---------------------------------------------------------------------------


def test_split_adjusted_basmalah_and_pause():
    tanzil = _tanzil_dict()
    full, adjusted, index_map = _split_adjusted(tanzil, 112, 1)
    assert len(full) == 8  # بسمله (۴) + ۴ کلمهٔ آیه
    # مقایسه با خود Tanzil، نه با حروف تایپ‌شده (ترتیب شَدّه/فتحه در
    # متن، با تایپ دستی فرق می‌کند).
    assert adjusted == _tanzil_ayah(112, 1).split()[4:]
    assert index_map == {0: 4, 1: 5, 2: 6, 3: 7}
    # آیهٔ ۲:۲۵۵ رد وقف دارد و از adjusted حذف می‌شود.
    full255, adjusted255, _ = _split_adjusted(tanzil, 2, 255)
    assert len(adjusted255) < len(full255)
    assert all(not (len(w) == 1 and w in "ۖۗۘۙۚۛۜ") for w in adjusted255)
    # ۱:۱ بسمله است، نه پیش‌چسب؛ ۹:۱ بسمله ندارد.
    full11, adjusted11, _ = _split_adjusted(tanzil, 1, 1)
    assert full11 == adjusted11
    _, adjusted91, _ = _split_adjusted(tanzil, 9, 1)
    assert adjusted91[0] == "بَرَآءَةٌ"


# ---------------------------------------------------------------------------
# بارگذاری از پوشهٔ مصنوعی
# ---------------------------------------------------------------------------


def _write_fixture(tmp_path: Path, entries: dict) -> Path:
    """پوشهٔ نگاشت مصنوعی: tokens تک‌حرفی + ordered کوچک."""
    d = tmp_path / "phoneme"
    d.mkdir()
    chars = set()
    for entry in entries.values():
        for w in entry["aya_phonemes_list"]:
            chars.update(w)
    lines = [f"{c} {i}" for i, c in enumerate(sorted(chars))]
    lines.append(f"<blank> {len(lines)}")
    (d / "tokens.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (d / "ordered_quran_phonemes.json").write_text(
        json.dumps(entries, ensure_ascii=False), encoding="utf-8"
    )
    return d


def _entry(words: list[str]) -> dict:
    return {
        "aya_text": " ".join(words),
        "aya_phoneme": " ".join(words),
        "aya_phonemes_list": list(words),
    }


def test_load_synthetic_dir_basmalah_prepend_and_pause_autoskip(
    tmp_path, monkeypatch
):
    # ۱۱۲:۱ با بسمله + ۱:۱؛ ۲:۲۵۵ با یک رد وقف در میان کلمه‌ها.
    words112 = _tanzil_ayah(112, 1).split()[4:]
    words11 = _tanzil_ayah(1, 1).split()
    words255 = _tanzil_ayah(2, 255).split()
    # adjusted ۲:۲۵۵ = کلمه‌ها بدون رد وقف؛ plist همان‌هاست.
    adjusted255 = [w for w in words255 if not (len(w) == 1 and w in "ۖۗۘۙۚۛۜ")]
    entries = {
        "1:1": _entry(words11),
        "112:1": _entry(words112),
        "2:255": _entry(adjusted255),
    }
    d = _write_fixture(tmp_path, entries)
    monkeypatch.setenv("QURAN_PHONEME_MAP_DIR", str(d))
    mapping = load_phoneme_mapping()
    segs112 = mapping.segments_for(112, 1)
    assert segs112 is not None
    # بسمله (۰ تا ۳) + ۴ کلمهٔ آیه (۴ تا ۷).
    assert [s.word_indices for s in segs112[:4]] == [(0,), (1,), (2,), (3,)]
    assert [s.word_indices for s in segs112[4:]] == [(4,), (5,), (6,), (7,)]
    assert all(s.phoneme is not None for s in segs112)
    # ۱:۱ پیش‌چسب ندارد.
    segs11 = mapping.segments_for(1, 1)
    assert segs11 is not None
    assert [s.word_indices for s in segs11] == [(0,), (1,), (2,), (3,)]
    # ۲:۲۵۵: رد وقف، قطعهٔ رد خودکار (phoneme=None) در جای درست است.
    segs255 = mapping.segments_for(2, 255)
    assert segs255 is not None
    auto = [s for s in segs255 if s.phoneme is None]
    assert auto, "pause marks must become auto-skip segments"
    covered = sorted(w for s in segs255 for w in s.word_indices)
    assert covered == list(range(len(words255)))
    # هیچ آیهٔ دیگری پذیرفته نشده است.
    assert mapping.segments_for(112, 2) is None


def test_load_synthetic_dir_rejects_unknown_symbol_and_impossible(
    tmp_path, monkeypatch
):
    words112 = _tanzil_ayah(112, 1).split()[4:]
    words11 = _tanzil_ayah(1, 1).split()
    entries = {
        "1:1": _entry(words11),
        "112:1": _entry(words112),
        # نماد ناشناخته: «X» در tokens تک‌حرفیِ ساخته‌شده نیست… ولی
        # چون tokens از روی همین ورودی ساخته می‌شود، برای رد، ورودی
        # را پس از ساخت tokens خراب می‌کنیم (پایین).
        "112:2": _entry(_tanzil_ayah(112, 2).split()),
        # تراز ناممکن: یک واج برای چهار کلمه.
        "112:3": {
            "aya_text": "x",
            "aya_phoneme": "ق",
            "aya_phonemes_list": ["ق"],
        },
    }
    d = _write_fixture(tmp_path, entries)
    # خراب‌کردن ۱۱۲:۲ پس از ساخت tokens: نماد X در tokens نیست.
    data = json.loads((d / "ordered_quran_phonemes.json").read_text(encoding="utf-8"))
    data["112:2"]["aya_phonemes_list"] = ["X"]
    (d / "ordered_quran_phonemes.json").write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8"
    )
    monkeypatch.setenv("QURAN_PHONEME_MAP_DIR", str(d))
    mapping = load_phoneme_mapping()
    assert mapping.segments_for(112, 1) is not None
    assert mapping.segments_for(112, 2) is None  # نماد ناشناخته
    assert mapping.segments_for(112, 3) is None  # تراز ناممکن


def test_load_returns_cached_mapping_object_on_second_call(tmp_path, monkeypatch):
    # رگرسیون: سایه‌اندازی `key` باعث می‌شد نگاشت زیر کلید آیه ذخیره
    # شود و جست‌وجوی کش هیچ‌وقت برخورد نکند؛ هر فراخوانی کل ساخت
    # نگاشت (DP روی ۶٬۲۳۶ آیه، حدود ۱۲۴ ثانیه روی Railway) را از صفر
    # تکرار می‌کرد و نشست زنده همان‌قدر فریز می‌شد. فراخوانی دوم روی
    # همان پوشه باید همان شیء اول را برگرداند.
    words112 = _tanzil_ayah(112, 1).split()[4:]
    words11 = _tanzil_ayah(1, 1).split()
    words255 = _tanzil_ayah(2, 255).split()
    adjusted255 = [w for w in words255 if not (len(w) == 1 and w in "ۖۗۘۙۚۛۜ")]
    entries = {
        "1:1": _entry(words11),
        "112:1": _entry(words112),
        "2:255": _entry(adjusted255),
    }
    d = _write_fixture(tmp_path, entries)
    monkeypatch.setenv("QURAN_PHONEME_MAP_DIR", str(d))
    first = load_phoneme_mapping()
    second = load_phoneme_mapping()
    assert second is first


def test_load_missing_dir_raises_pending(tmp_path, monkeypatch):
    monkeypatch.setenv("QURAN_PHONEME_MAP_DIR", str(tmp_path / "no-such-dir"))
    with pytest.raises(MappingPendingError) as exc:
        load_phoneme_mapping()
    assert exc.value.code == "hifz_word_alignment_pending"


def test_load_bad_json_raises_pending(tmp_path, monkeypatch):
    d = tmp_path / "phoneme"
    d.mkdir()
    (d / "tokens.txt").write_text("ا 0\n<blank> 1\n", encoding="utf-8")
    (d / "ordered_quran_phonemes.json").write_text("{not json", encoding="utf-8")
    monkeypatch.setenv("QURAN_PHONEME_MAP_DIR", str(d))
    with pytest.raises(MappingPendingError):
        load_phoneme_mapping()


# ---------------------------------------------------------------------------
# دادهٔ واقعی (فقط با متغیر محیطی)
# ---------------------------------------------------------------------------

_REAL_DIR = os.environ.get("QURAN_PHONEME_MAP_DIR")


@pytest.mark.skipif(not _REAL_DIR, reason="real mapping dir not configured")
def test_real_mapping_coverage_and_sample_segments():
    mapping = load_phoneme_mapping()
    accepted = 0
    tanzil = _tanzil_dict()
    total = sum(len(v) for v in tanzil.values())
    for surah, ayahs in tanzil.items():
        for ayah in ayahs:
            if mapping.segments_for(surah, ayah) is not None:
                accepted += 1
    assert total == 6236
    # آستانهٔ پذیرش بارگذار: کف ۱۰ یا ۱٫۵ برابر قطعه.
    assert accepted >= 6150, f"accepted {accepted}/6236, below 6150"
    # ۹:۱: ادغام «بَرَآءَةٌ + مِّنَ» در قطعهٔ اول.
    segs91 = mapping.segments_for(9, 1)
    assert segs91 is not None
    assert segs91[0].word_indices == (0, 1)
    # ۱۱۲:۱: بسمله (۰ تا ۳) + ۴ کلمه (۴ تا ۷).
    segs112 = mapping.segments_for(112, 1)
    assert segs112 is not None
    assert len(segs112) == 8
    assert [s.word_indices for s in segs112] == [
        (0,), (1,), (2,), (3,), (4,), (5,), (6,), (7,),
    ]
    # ۲:۱: بسمله + یک قطعهٔ شکافته‌شده برای الٓمٓ.
    segs21 = mapping.segments_for(2, 1)
    assert segs21 is not None
    assert [s.word_indices for s in segs21[:4]] == [(0,), (1,), (2,), (3,)]
    assert segs21[4].word_indices == (4,)
    # ۲:۲۵۵: دست‌کم یک ادغام و دست‌کم یک رد خودکار وقف.
    segs255 = mapping.segments_for(2, 255)
    assert segs255 is not None
    assert any(len(s.word_indices) > 1 for s in segs255)
    assert any(s.phoneme is None for s in segs255)


@pytest.mark.skipif(not _REAL_DIR, reason="real mapping dir not configured")
@pytest.mark.asyncio
async def test_real_mapping_live_alignment_end_to_end():
    """رشته‌های واجی واقعی از نگاشت، از feed_phonemes می‌گذرند و همهٔ
    کلمه‌های ۱۱۲:۱ را «درست» می‌کنند (اثبات سرتاسری رنگ/نمره)."""
    from app.modules.quran.hifz_stream import LiveSession

    mapping = load_phoneme_mapping()
    segs = mapping.segments_for(112, 1)
    assert segs is not None
    events: list = []
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=112,
        start_ayah=1,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=mapping,
    )
    session._ayah = 1
    session._words = _tanzil_ayah(112, 1).split()
    session._index = 0
    session._touch(1)
    phoneme_text = "".join(s.phoneme for s in segs if s.phoneme is not None)
    # توکن‌های تک‌حرفیِ شبیه‌ساز بازشناس؛ نشست آن‌ها را به هم می‌چسباند.
    await session.feed_phonemes(list(phoneme_text))
    words = [e for e in events if e["type"] == "word"]
    assert len(words) == 8
    assert all(w["status"] == "correct" for w in words)
    assert [w["expected"] for w in words] == session._words
