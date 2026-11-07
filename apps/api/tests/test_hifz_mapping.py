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
    _norm,
    _norm_relaxed,
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
# نرمال‌ساز بهبودیافتهٔ گذر دوم (V1 تا V5 + بسمله) — بدون دادهٔ واقعی
# ---------------------------------------------------------------------------


def test_norm_relaxed_dagger_alef_and_small_yeh():
    # V1: ٰ → ا و ۧ → ي پیش از حذف حرکات؛ سمت واجی الف کامل می‌نویسد.
    assert _norm_relaxed("إِبْرَٰهِـۧمَ") == _norm_relaxed("ءِبڇرَااهِۦۦمَ") == "ابراهيم"
    # «صلوة»: واوِ املایی در برابر الفِ تلفظی می‌ماند (هزینهٔ ۱ باقی) —
    # الف خنجری فقط ٰ را برمی‌گرداند، نه واو را (گزارش Wave 1، §۳٫۱).
    assert _norm_relaxed("ٱلصَّلَوٰةَ") == "صلوات"
    assert _norm_relaxed("صصَلَااتَ") == "صلات"


def test_norm_relaxed_pronunciation_symbols():
    # V2: ں → ن، ۾ → م، حذف ڇ (قلقله).
    assert _norm_relaxed("ءِںںں") == _norm_relaxed("إِن") == "ان"
    assert _norm_relaxed("خَلَقڇنَ") == _norm_relaxed("خَلَقْنَ") == "خلقن"
    assert _norm_relaxed("كُ۾۾۾") == _norm_relaxed("كُم") == "كم"


def test_norm_relaxed_waslah_al():
    # V3: الِ شمسی کامل، الِ قمری فقط الف (لام می‌ماند).
    assert _norm_relaxed("ٱلصَّبْرِ") == _norm_relaxed("صصَبْرِ") == "صبر"
    assert _norm_relaxed("ٱلْقَـٰنِتِينَ") == "لقانتين"
    # پس از پیشوند تک‌حرفی هم الفِ وصله ساکت است.
    assert _norm_relaxed("وَٱلصَّبْرِ") == _norm_relaxed("وَصصَبْرِ") == "وصبر"
    assert _norm_relaxed("بِٱلصَّبْرِ") == _norm_relaxed("بِصصَبْرِ") == "بصبر"
    # منفی (§۳٫۷ گزارش Wave 1): إِلَى الفِ همزه‌دار دارد، نه وصله؛
    # ٱقْرَأْ الفِ وصله دارد ولی «ال» نیست — هیچ‌کدام «ال»شان را
    # از دست نمی‌دهند.
    assert _norm_relaxed("إِلَى").startswith("ال")
    assert _norm_relaxed("ٱقْرَأْ") == "اقرا"


def test_norm_relaxed_final_waw_and_seat_hamza():
    # V4: واو پایانیِ جمع؛ V5: همزهٔ روی کرسی → ا.
    assert _norm_relaxed("وَقَالُوا۟") == _norm_relaxed("وَقَاالُ") == "وقال"
    assert _norm_relaxed("مُؤْمِنِينَ") == _norm_relaxed("مُءمِنِينَ") == "مامنين"


def test_norm_unchanged_for_pass_one():
    # گذر اول دقیقاً با _norm پیشین کار می‌کند (نامتغیریِ دوطبقه)؛
    # اگر این‌ها عوض شوند، ۶٬۱۸۵ آیهٔ گذر اول هم عوض می‌شوند.
    assert _norm("ٱلصَّلَوٰةَ") == "الصلوت"
    assert _norm("إِبْرَٰهِـۧمَ") == "ابرهم"
    assert _norm("خَلَقڇنَ") == "خلقڇن"
    assert _norm("وَقَالُوا۟") == "وقالوا"


def test_split_adjusted_relaxed_basmalah_shaddah():
    tanzil = _tanzil_dict()
    # تنزیل در ۹۵:۱ و ۹۷:۱ «بِّسْمِ» با شده می‌نویسد؛ مقایسهٔ دقیق
    # بسمله را جدا نمی‌کند (باگ)، مقایسهٔ نرمال‌شده جدا می‌کند.
    full95, adjusted95, _ = _split_adjusted(tanzil, 95, 1)
    assert len(adjusted95) == len(full95)
    full95r, adjusted95r, index95r = _split_adjusted(
        tanzil, 95, 1, relaxed_basmalah=True
    )
    assert full95r == full95
    assert adjusted95r == full95[4:]
    assert index95r == {0: 4, 1: 5}
    full97, adjusted97, _ = _split_adjusted(tanzil, 97, 1)
    assert len(adjusted97) == len(full97)
    _, adjusted97r, _ = _split_adjusted(tanzil, 97, 1, relaxed_basmalah=True)
    assert adjusted97r == full97[4:]
    # بسملهٔ معمولی با هر دو مقایسه جدا می‌شود؛ ۱:۱ و ۹:۱ دست نمی‌خورند.
    _, adjusted21, _ = _split_adjusted(tanzil, 2, 1, relaxed_basmalah=True)
    assert len(adjusted21) == 1
    full11, adjusted11, _ = _split_adjusted(tanzil, 1, 1, relaxed_basmalah=True)
    assert full11 == adjusted11
    _, adjusted91, _ = _split_adjusted(tanzil, 9, 1, relaxed_basmalah=True)
    assert adjusted91[0] == "بَرَآءَةٌ"


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


def test_load_synthetic_dir_basmalah_shaddah_second_pass(tmp_path, monkeypatch):
    # مدخل ۹۵:۱ با بسملهٔ شده‌دار (مثل تنزیل واقعی): گذر اول با
    # مقایسهٔ دقیق، بسمله را جدا نمی‌کند و آیه رد می‌شود؛ گذر دوم با
    # مقایسهٔ نرمال‌شده می‌پذیرد و بسمله را پیش‌چسب می‌کند.
    words95 = _tanzil_ayah(95, 1).split()[4:]
    words11 = _tanzil_ayah(1, 1).split()
    entries = {
        "1:1": _entry(words11),
        "95:1": _entry(words95),
    }
    d = _write_fixture(tmp_path, entries)
    monkeypatch.setenv("QURAN_PHONEME_MAP_DIR", str(d))
    mapping = load_phoneme_mapping()
    segs = mapping.segments_for(95, 1)
    assert segs is not None
    assert [s.word_indices for s in segs[:4]] == [(0,), (1,), (2,), (3,)]
    assert [s.word_indices for s in segs[4:]] == [(4,), (5,)]
    assert all(s.phoneme is not None for s in segs)


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
    # پس از اصلاح دوطبقه (۲۰۲۶-۱۱-۰۷): هر ۶٬۲۳۶ آیه پذیرفته شده‌اند
    # و هیچ آیهٔ ردشده‌ای نیست (پیش‌تر ۶٬۱۸۵ پذیرفته و ۵۱ آیه رد شده
    # بودند؛ ریشه در نرمال‌ساز هزینهٔ DP بود — گزارش Wave 1، بخش ۳).
    # این عدد ویژگیِ داده + نرمال‌ساز است؛ اگر داده عوض شد و عدد عوض
    # شد، همین assertion را با عددِ تازه و فهرستِ ردشده‌ها به‌روز کن
    # — نه اینکه آستانه را شل کنی.
    assert accepted == 6236, (
        f"accepted {accepted}/6236, expected 6236; "
        f"rejected: {mapping.report.rejected}"
    )
    assert mapping.report.rejected == []
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


# ---------------------------------------------------------------------------
# ۵۱ آیهٔ پیش‌تر بی‌نگاشت (بارگذار دوطبقه، ۲۰۲۶-۱۱-۰۷)
# ---------------------------------------------------------------------------

#: ۵۱ آیه‌ای که در گذر اول رد می‌شدند و گذر دوم می‌پذیرند
#: (گزارش Wave 1، بخش ۳ — `ayahs-51.json`).
_UNMAPPED_51 = frozenset({
    "2:43", "2:116", "2:125", "2:153", "2:155", "2:238", "2:268",
    "2:278", "3:15", "3:17", "3:130", "3:136", "3:190", "4:103",
    "5:9", "5:57", "5:88", "5:93", "6:98", "7:52", "7:133",
    "9:11", "9:112", "9:119", "11:11", "13:15", "13:22", "19:76",
    "19:93", "20:75", "23:14", "24:56", "25:14", "29:9", "33:35",
    "33:58", "33:70", "33:73", "34:4", "35:7", "38:29", "39:17",
    "42:26", "62:10", "65:11", "66:5", "76:2", "89:23", "95:1",
    "97:1", "103:3",
})

#: ۴ آیه‌ای که در آن‌ها یک قطعهٔ ادغامی روی نشانهٔ وقف می‌افتد
#: (2:125 قطعهٔ [10,12] روی وقفِ 11؛ 2:268 قطعهٔ [10,12] روی
#: وقفِ 11؛ 5:88 قطعهٔ [4,5,7] روی وقفِ 6؛ 65:11 قطعهٔ [29,31]
#: روی وقفِ 30) — تا پیش از رفعِ stream، رویدادِ ردشدهٔ وقف پس از
#: کلمهٔ بعدش می‌آمد؛ اکنون `_emit_unit` وقفِ درونِ بازه را پیش از
#: کلمهٔ بعدش صادر می‌کند و ترتیب درست است (آزمونِ زیر). 2:255
#: (گذر اول، قطعهٔ [12,14] روی وقفِ 13) همان ساختارِ
#: ازپیش‌پذیرفته‌شده است و در آزمونِ ترتیب هم قفل شده است.
_SPAN_PAUSE_FIXED = {(2, 125), (2, 268), (5, 88), (65, 11), (2, 255)}


#: ۱۵ آیه‌ای که پس از اصلاح دست‌کم یک قطعه با هزینهٔ ۳ یا بیشتر
#: دارند و مرز قطعه‌شان نیازمند بازبینی است (گزارش Wave 1، §۷٫۳) —
#: آزمون تراز زندهٔ زیر، مرزها را از راه رفتار زنده می‌سنجد.
_REVIEW_15 = [
    (2, 125), (2, 153), (2, 238), (2, 268), (4, 103), (5, 57),
    (5, 88), (5, 93), (7, 133), (13, 15), (25, 14), (33, 35),
    (33, 58), (65, 11), (66, 5),
]

_PAUSE_MARKS = set("ۖۗۘۙۚۛۜ")

_BASELINE_SEGMENTS = os.environ.get("HIFZ_BASELINE_SEGMENTS_JSON")


def _assert_full_word_coverage(mapping, surah: int, ayah: int):
    """هر کلمهٔ آیه دقیقاً یک بار پوشیده شده باشد (با بسمله و وقف)."""
    segs = mapping.segments_for(surah, ayah)
    assert segs is not None, f"{surah}:{ayah} has no segments"
    words = _tanzil_ayah(surah, ayah).split()
    flat = [w for s in segs for w in s.word_indices]
    assert sorted(flat) == list(range(len(words))), (
        f"{surah}:{ayah} word coverage incomplete: {flat} vs {len(words)} words"
    )
    assert len(flat) == len(words)
    return segs


@pytest.mark.skipif(not _REAL_DIR, reason="real mapping dir not configured")
def test_real_mapping_all_51_previously_unmapped_now_accepted():
    mapping = load_phoneme_mapping()
    for key in sorted(_UNMAPPED_51):
        surah, ayah = (int(x) for x in key.split(":"))
        _assert_full_word_coverage(mapping, surah, ayah)


@pytest.mark.skipif(not _REAL_DIR, reason="real mapping dir not configured")
def test_real_mapping_second_pass_sample_segments():
    mapping = load_phoneme_mapping()
    # گروه D (بسملهٔ شده‌دار): بسمله (۰ تا ۳) + کلمات آیه.
    segs95 = mapping.segments_for(95, 1)
    assert segs95 is not None
    assert len(segs95) == 6
    assert [s.word_indices for s in segs95] == [
        (0,), (1,), (2,), (3,), (4,), (5,),
    ]
    segs97 = mapping.segments_for(97, 1)
    assert segs97 is not None
    assert len(segs97) == 9
    assert [s.word_indices for s in segs97] == [
        (0,), (1,), (2,), (3,), (4,), (5,), (6,), (7,), (8,),
    ]
    # ۹۷:۱ پس از اصلاح هزینهٔ ۰ می‌گیرد (تراز کامل) — بازمحاسبه
    # با نرمال‌ساز بهبودیافته روی دادهٔ واقعی.
    ordered = json.loads(
        (Path(_REAL_DIR) / "ordered_quran_phonemes.json").read_text(
            encoding="utf-8"
        )
    )
    plist97 = ordered["97:1"]["aya_phonemes_list"]
    tanzil = _tanzil_dict()
    _full, adjusted97, _ = _split_adjusted(
        tanzil, 97, 1, relaxed_basmalah=True
    )
    aligned97 = _align_segments(plist97, adjusted97, norm=_norm_relaxed)
    assert aligned97 is not None
    assert aligned97[0] == 0
    # نمونه‌های بلند: شمار قطعه‌ها و پوشش کامل کلمات (گزارش Wave 1، §۴).
    # شمارها قطعه‌های نهایی‌اند (با رد خودکار وقف): ۲:۱۲۵ هفده قطعهٔ
    # تعدیل‌شده + یک رد وقف = ۱۸؛ ۳۳:۳۵ و ۶۶:۵ وقف ندارند.
    segs3335 = _assert_full_word_coverage(mapping, 33, 35)
    assert len(segs3335) == 27
    segs665 = _assert_full_word_coverage(mapping, 66, 5)
    assert len(segs665) == 8
    segs2125 = _assert_full_word_coverage(mapping, 2, 125)
    assert len(segs2125) == 18


@pytest.mark.skipif(
    not _REAL_DIR or not _BASELINE_SEGMENTS,
    reason="real mapping dir / baseline segments not configured",
)
def test_real_mapping_two_pass_byte_identity():
    """نامتغیریِ دوطبقه: دقیقاً همان ۵۱ آیه عوض شده‌اند و ۶٬۱۸۵ آیهٔ
    دیگر بایت‌به‌بایت همان قطعه‌های پیش از اصلاح را دارند.

    مبنا `segments_baseline.json` گزارش Wave 1 است (قطعه‌های بارگذار
    پیش از اصلاح) و با `HIFZ_BASELINE_SEGMENTS_JSON` داده می‌شود.
    """
    mapping = load_phoneme_mapping()
    baseline = json.loads(
        Path(_BASELINE_SEGMENTS).read_text(encoding="utf-8")
    )
    assert len(baseline) == 6236
    changed: set[str] = set()
    for key, base_segs in baseline.items():
        surah, ayah = (int(x) for x in key.split(":"))
        mine = mapping.segments_for(surah, ayah)
        assert mine is not None, f"{key} lost in two-pass load"
        got = [[list(s.word_indices), s.phoneme] for s in mine]
        if got != base_segs:
            changed.add(key)
    assert changed == _UNMAPPED_51, (
        f"changed ayahs differ from the 51: "
        f"extra={sorted(changed - _UNMAPPED_51)} "
        f"missing={sorted(_UNMAPPED_51 - changed)}"
    )


@pytest.mark.skipif(not _REAL_DIR, reason="real mapping dir not configured")
@pytest.mark.asyncio
@pytest.mark.parametrize("surah,ayah", _REVIEW_15)
async def test_real_mapping_live_alignment_review_ayahs(surah, ayah):
    """تراز زندهٔ ۱۵ آیهٔ نیازمند بازبینی: رشتهٔ واجیِ به‌هم‌پیوستهٔ
    آیه از feed_phonemes می‌گذرد؛ هر کلمهٔ غیرِوقف «درست» و هر
    نشانهٔ وقف «ردشده» می‌شود، و کلمه‌های درست به‌ترتیبِ ارائه
    می‌آیند. این آزمون مرز قطعه‌ها را از راه رفتار زنده می‌سنجد،
    نه از راه هزینهٔ DP — بازبینیِ انسانیِ مرزها همچنان باز است و
    این آزمون جای آن را نمی‌گیرد.
    """
    from app.modules.quran.hifz_stream import LiveSession

    mapping = load_phoneme_mapping()
    segs = mapping.segments_for(surah, ayah)
    assert segs is not None
    events: list = []
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=surah,
        start_ayah=ayah,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=mapping,
    )
    session._ayah = ayah
    session._words = _tanzil_ayah(surah, ayah).split()
    session._index = 0
    session._touch(ayah)
    phoneme_text = "".join(s.phoneme for s in segs if s.phoneme is not None)
    await session.feed_phonemes(list(phoneme_text))
    words = [e for e in events if e["type"] == "word"]
    by_index: dict[int, str] = {}
    for w in words:
        assert w["word_index"] not in by_index, (
            f"{surah}:{ayah} duplicate word event for index {w['word_index']}"
        )
        by_index[w["word_index"]] = w["status"]
    assert sorted(by_index) == list(range(len(session._words))), (
        f"{surah}:{ayah} word coverage mismatch"
    )
    for i, expected in enumerate(session._words):
        if len(expected) == 1 and expected in _PAUSE_MARKS:
            assert by_index[i] == "skipped", (
                f"{surah}:{ayah} pause word {i} not skipped"
            )
        else:
            assert by_index[i] == "correct", (
                f"{surah}:{ayah} word {i} ({expected}) is "
                f"{by_index[i]}, not correct"
            )
    correct_seq = [w["expected"] for w in words if w["status"] == "correct"]
    assert correct_seq == [
        w
        for w in session._words
        if not (len(w) == 1 and w in _PAUSE_MARKS)
    ], f"{surah}:{ayah} correct words out of order"


@pytest.mark.skipif(not _REAL_DIR, reason="real mapping dir not configured")
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "surah,ayah",
    [(s, a) for s, a in _REVIEW_15] + sorted(_SPAN_PAUSE_FIXED - set(_REVIEW_15)),
)
async def test_real_mapping_live_alignment_review_ayahs_emission_order(
    surah, ayah
):
    """ترتیبِ سخت‌گیرانهٔ ارائهٔ رویدادهای کلمه (شامل ردشده‌های وقف).

    ۱۵ آیهٔ بازبینی + 2:255 (همان ساختارِ ادغامِ روی وقف، از
    گذر اول): وقفِ درونِ بازهٔ قطعهٔ ادغامی پیش از کلمهٔ بعدش
    صادر می‌شود (`_emit_spanned_pauses_before` در hifz_stream.py).
    """
    from app.modules.quran.hifz_stream import LiveSession

    mapping = load_phoneme_mapping()
    segs = mapping.segments_for(surah, ayah)
    assert segs is not None
    events: list = []
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=surah,
        start_ayah=ayah,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=mapping,
    )
    session._ayah = ayah
    session._words = _tanzil_ayah(surah, ayah).split()
    session._index = 0
    session._touch(ayah)
    phoneme_text = "".join(s.phoneme for s in segs if s.phoneme is not None)
    await session.feed_phonemes(list(phoneme_text))
    words = [e for e in events if e["type"] == "word"]
    assert [w["expected"] for w in words] == session._words, (
        f"{surah}:{ayah} word order mismatch"
    )
