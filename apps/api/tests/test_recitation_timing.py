"""تست زمان‌بندی کلمه‌ایِ تلاوت — نرمال‌سازیِ پاسخِ واقعیِ Quran.com v4.

دادهٔ نمونه، پاسخِ زندهٔ
GET /api/v4/chapter_recitations/7/1?segments=true
(عفاسی، فاتحه، ۲۰۲۶-۱۱-۰۶) است — سگمنت‌ها نسبت به ابتدای فایل
سوره‌اند و این‌جا به نسبتِ ابتدای آیه تبدیل می‌شوند.
"""
import pytest

from app.modules.quran.recitation_timing import (
    RECITER_LABELS,
    RECITERS,
    RecitationTimingError,
    _normalize,
    get_recitation_timing,
)

_AUDIO_URL = "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/1.mp3"

# سه آیهٔ اولِ فاتحه از پاسخِ زندهٔ Quran.com (عفاسی، سورهٔ ۱).
_TIMESTAMPS = [
    {
        "verse_key": "1:1", "timestamp_from": 0, "timestamp_to": 6090,
        "duration": 6090,
        "segments": [[1, 0, 580], [2, 580, 1409], [3, 1409, 2502], [4, 2502, 5840]],
    },
    {
        "verse_key": "1:2", "timestamp_from": 6090, "timestamp_to": 11680,
        "duration": 5590,
        "segments": [[1, 6025, 7025], [2, 7025, 7885], [3, 7885, 8515], [4, 8515, 11550]],
    },
    {
        "verse_key": "1:3", "timestamp_from": 11680, "timestamp_to": 16300,
        "duration": 4620,
        "segments": [[1, 11615, 12855], [1], [2, 12855, 16180], [2], [1]],
    },
]


def test_normalize_ayah_relative_segments():
    out = _normalize("alafasy", 1, _AUDIO_URL, _TIMESTAMPS)
    assert out["reciter"] == "alafasy"
    assert out["surah"] == 1
    assert out["audio_url"] == _AUDIO_URL
    assert out["source"] == "quran_com_v4"
    assert [a["ayah"] for a in out["ayahs"]] == [1, 2, 3]

    a1 = out["ayahs"][0]
    assert (a1["from_ms"], a1["to_ms"], a1["duration_ms"]) == (0, 6090, 6090)
    assert a1["words"] == [
        {"word": 1, "start_ms": 0, "end_ms": 580},
        {"word": 2, "start_ms": 580, "end_ms": 1409},
        {"word": 3, "start_ms": 1409, "end_ms": 2502},
        {"word": 4, "start_ms": 2502, "end_ms": 5840},
    ]

    # آیهٔ ۲: شروعِ کلمهٔ اول (۶۰۲۵) کمی پیش از from (۶۰۹۰) است → صفر.
    a2 = out["ayahs"][1]
    assert (a2["from_ms"], a2["to_ms"], a2["duration_ms"]) == (6090, 11680, 5590)
    assert a2["words"] == [
        {"word": 1, "start_ms": 0, "end_ms": 935},
        {"word": 2, "start_ms": 935, "end_ms": 1795},
        {"word": 3, "start_ms": 1795, "end_ms": 2425},
        {"word": 4, "start_ms": 2425, "end_ms": 5460},
    ]


def test_normalize_drops_single_element_segments():
    # آیهٔ ۳ سگمنت‌های تک‌عضوی [1] و [2] دارد — ناقص‌اند و حذف می‌شوند.
    out = _normalize("alafasy", 1, _AUDIO_URL, _TIMESTAMPS)
    a3 = out["ayahs"][2]
    assert a3["words"] == [
        {"word": 1, "start_ms": 0, "end_ms": 1175},
        {"word": 2, "start_ms": 1175, "end_ms": 4500},
    ]


def test_normalize_accepts_float_segments():
    # عبدالباسط: زمان‌های سگمنت float می‌آیند (0.0، 1040.0) و duration
    # منفی است — هر دو باید درست نرمال شوند.
    out = _normalize(
        "abdul_basit",
        1,
        "https://download.quranicaudio.com/qdc/abdul_baset/murattal/1.mp3",
        [
            {
                "verse_key": "1:1", "timestamp_from": 0, "timestamp_to": 4370,
                "duration": -4370,
                "segments": [[1, 0.0, 1040.0], [2, 1040.0, 1660.0], [3, 1660.0, 2610.0], [4, 2610.0, 4325.0]],
            },
            {
                "verse_key": "1:2", "timestamp_from": 4370, "timestamp_to": 9680,
                "duration": -5310,
                "segments": [[1, 4370.0, 6090.0], [2, 6090.0, 6940.0], [3, 6940.0, 7400.0], [4, 7400.0, 9055.0]],
            },
        ],
    )
    a1 = out["ayahs"][0]
    assert (a1["from_ms"], a1["to_ms"], a1["duration_ms"]) == (0, 4370, 4370)
    assert a1["words"] == [
        {"word": 1, "start_ms": 0, "end_ms": 1040},
        {"word": 2, "start_ms": 1040, "end_ms": 1660},
        {"word": 3, "start_ms": 1660, "end_ms": 2610},
        {"word": 4, "start_ms": 2610, "end_ms": 4325},
    ]
    a2 = out["ayahs"][1]
    assert a2["words"][0] == {"word": 1, "start_ms": 0, "end_ms": 1720}


def test_reciters_cover_the_three_required():
    assert set(RECITERS) == {"alafasy", "abdul_basit", "husary"}
    assert RECITERS == {"alafasy": 7, "abdul_basit": 2, "husary": 6}
    assert set(RECITER_LABELS) == set(RECITERS)


@pytest.mark.asyncio
async def test_get_recitation_timing_rejects_unknown_reciter():
    with pytest.raises(RecitationTimingError):
        await get_recitation_timing("unknown_reciter", 1)


@pytest.mark.asyncio
async def test_get_recitation_timing_rejects_invalid_surah():
    with pytest.raises(RecitationTimingError):
        await get_recitation_timing("alafasy", 0)
    with pytest.raises(RecitationTimingError):
        await get_recitation_timing("alafasy", 115)
