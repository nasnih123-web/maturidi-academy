#!/usr/bin/env python3
"""مولد زمان‌بندی کلمه‌ای قاری‌ها با تراز واجی اجباری (گام ۱۰ برابری).

تا این گام، زمان‌بندی کلمه‌ای فقط برای قاری‌هایی بود که Quran.com
سگمنت آماده دارد؛ بقیهٔ قاری‌های محصول در حالت گوش‌دادن زمان‌بندی
درون‌یابی‌شده می‌گرفتند (ایراد ۱۰). این اسکریپت برای هر edition
عربیِ محصول، صوت آیه‌به‌آیهٔ EveryAyah (همان تلاوت‌ها) را می‌گیرد
و با همان خط لولهٔ واجی گام ۹ (دیکد زمان‌دار Zipformer +
`align_phonemes` + نگاشت بازه→زمان) زمان واقعی هر کلمه را تولید
می‌کند — نه درون‌یابی.

خروجی (داخل ریپو، کنار داده‌های باندل‌شده):
  app/modules/quran/data/timings/<edition>/<surah>.json
      {"edition", "surah", "source": "phoneme_alignment",
       "ayahs": [{"ayah", "audio_url", "duration_ms",
                  "words": [{"word", "start_ms", "end_ms"}],
                  "counts": {...}}]}
  app/modules/quran/data/timings/manifest.json
      مانیفست پیشرفت: به‌ازای هر edition پوشهٔ منبع، سوره‌های تمام،
      شمار آیه‌های تمام و خطاهای ثبت‌شده؛ ویرایش‌های ‎-2‎ همان
      تلاوت قاری پایه‌اند (mirror/نرخ دیگر) و زمان‌بندی پایه را
      شریک می‌شوند؛ editionهای غیرعربی (ترجمهٔ گفتاری) صریحاً
      کنار گذاشته شده‌اند — تراز واجی عربی روی نریشن فارسی/انگلیسی
      معنا ندارد.

قابل ازسرگیری: آیهٔ تمام‌شده (موجود در فایل سوره‌اش) دوباره
پردازش نمی‌شود؛ خطاها در مانیفست می‌مانند و اجرای بعدی دوباره
تلاششان می‌کند. صوت خام و WAV در کش بیرون ریپو می‌مانند
(پیش‌فرض: ~/workspace/maturidi-reaudit/timings-cache).

اجرا:
  python3 scripts/generate_reciter_timings.py --edition ar.husary --surah 67
  python3 scripts/generate_reciter_timings.py --edition ar.husary
  python3 scripts/generate_reciter_timings.py --all
محیط: HIFZ_ZIPFORMER_MODEL_DIR و QURAN_PHONEME_MAP_DIR (اگر ست
نشده باشند، مسیر هارنس گام ۳ همین VM به‌عنوان پیش‌فرض گرفته
می‌شود؛ روی ماشین دیگر باید صریح ست شوند).
"""

from __future__ import annotations

import argparse
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
import wave
from datetime import UTC, datetime
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = API_ROOT / "app" / "modules" / "quran" / "data"
TIMINGS_DIR = DATA_DIR / "timings"
TANZIL_PATH = DATA_DIR / "tanzil_uthmani.txt"

sys.path.insert(0, str(API_ROOT))
_HARNESS = Path.home() / "workspace" / "maturidi-reaudit" / "harness-step3"
os.environ.setdefault("HIFZ_ZIPFORMER_MODEL_DIR", str(_HARNESS / "model"))
os.environ.setdefault("QURAN_PHONEME_MAP_DIR", str(_HARNESS / "phoneme"))
_DEFAULT_CACHE = Path.home() / "workspace" / "maturidi-reaudit" / "timings-cache"

EVERYAYAH = "https://everyayah.com/data/{folder}/{key}.mp3"

# edition محصول → پوشهٔ EveryAyah همان قاری. همهٔ پوشه‌ها
# ۲۰۲۶-۱۱-۱۲ با درخواست واقعی فایل‌های 001001 و 114006 راستی‌آزمایی
# شدند (هر دو ۲۰۰).
EDITION_FOLDERS: dict[str, str] = {
    "ar.alafasy": "Alafasy_128kbps",
    "ar.abdulbasitmurattal": "Abdul_Basit_Murattal_192kbps",
    "ar.abdullahbasfar": "Abdullah_Basfar_192kbps",
    "ar.abdurrahmaansudais": "Abdurrahmaan_As-Sudais_192kbps",
    "ar.abdulsamad": "AbdulSamad_64kbps_QuranExplorer.Com",
    "ar.shaatree": "Abu_Bakr_Ash-Shaatree_128kbps",
    "ar.ahmedajamy": "Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net",
    "ar.hanirifai": "Hani_Rifai_192kbps",
    "ar.husary": "Husary_128kbps",
    "ar.husarymujawwad": "Husary_Mujawwad_64kbps",
    "ar.hudhaify": "Hudhaify_128kbps",
    "ar.ibrahimakhbar": "Ibrahim_Akhdar_32kbps",
    "ar.mahermuaiqly": "Maher_AlMuaiqly_64kbps",
    "ar.minshawi": "Minshawy_Murattal_128kbps",
    "ar.minshawimujawwad": "Minshawy_Mujawwad_64kbps",
    "ar.muhammadayyoub": "Muhammad_Ayyoub_128kbps",
    "ar.muhammadjibreel": "Muhammad_Jibreel_128kbps",
    "ar.saoodshuraym": "Saood_ash-Shuraym_128kbps",
    "ar.parhizgar": "Parhizgar_48kbps",
    "ar.aymanswoaid": "Ayman_Sowaid_64kbps",
}

# ویرایش‌های ‎-2‎: همان تلاوت قاری پایه با mirror/نرخ دیگر در
# AlQuran Cloud؛ زمان‌بندی تولیدشدهٔ پایه برایشان معتبر است.
SHARED_EDITIONS: dict[str, str] = {
    "ar.alafasy-2": "ar.alafasy",
    "ar.husary-2": "ar.husary",
    "ar.mahermuaiqly-2": "ar.mahermuaiqly",
    "ar.hudhaify-2": "ar.hudhaify",
    "ar.husarymujawwad-2": "ar.husarymujawwad",
    "ar.minshawi-2": "ar.minshawi",
    "ar.muhammadayyoub-2": "ar.muhammadayyoub",
    "ar.muhammadjibreel-2": "ar.muhammadjibreel",
}

# ترجمه‌های گفتاری (نریشن) — تلاوت عربی نیستند و تراز واجی عربی
# رویشان معنا ندارد؛ صریحاً بیرون از این تولید می‌مانند.
EXCLUDED_EDITIONS: dict[str, str] = {
    ed: "spoken translation narration — not Arabic recitation"
    for ed in (
        "en.walk",
        "fa.hedayatfarfooladvand",
        "ur.khan",
        "zh.chinese",
        "fr.leclerc",
        "ru.kuliev-audio",
        "ru.kuliev-audio-2",
        "kk.khalifahaltai-audio",
        "uz.sodik-audio",
        "tr.vakfi-audio",
    )
}

GREEN, AMBER = 0.8, 0.5


def _tanzil() -> dict[tuple[int, int], list[str]]:
    words: dict[tuple[int, int], list[str]] = {}
    counts: dict[int, int] = {}
    for line in TANZIL_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            s, a = int(parts[0]), int(parts[1])
            words[(s, a)] = parts[2].split()
            counts[s] = a
    assert len(words) == 6236 and len(counts) == 114
    return words


def _download(url: str, dest: Path) -> None:
    last: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "maturidi-timings-generator"}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310
                data = resp.read()
            if len(data) < 1024:
                raise ValueError(f"suspiciously small file: {len(data)} bytes")
            dest.write_bytes(data)
            return
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"download failed: {url}: {last}")


def _to_wav(mp3: Path, wav: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(mp3),
            "-ar", "16000", "-ac", "1", str(wav),
        ],
        check=True,
    )


def _load_manifest() -> dict:
    path = TIMINGS_DIR / "manifest.json"
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"version": 1, "editions": {}}


def _save_manifest(manifest: dict) -> None:
    TIMINGS_DIR.mkdir(parents=True, exist_ok=True)
    manifest["updated_at"] = datetime.now(UTC).isoformat()
    manifest["shared"] = SHARED_EDITIONS
    manifest["excluded"] = EXCLUDED_EDITIONS
    tmp = TIMINGS_DIR / "manifest.json.tmp"
    tmp.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True),
        encoding="utf-8",
    )
    tmp.replace(TIMINGS_DIR / "manifest.json")


def _surah_path(edition: str, surah: int) -> Path:
    return TIMINGS_DIR / edition / f"{surah:03d}.json"


def _existing_ayahs(edition: str, surah: int) -> dict[int, dict]:
    path = _surah_path(edition, surah)
    if not path.is_file():
        return {}
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return {}
    return {int(a["ayah"]): a for a in body.get("ayahs", [])}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--edition", action="append", default=[])
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--surah", action="append", type=int, default=[])
    parser.add_argument("--cache-dir", type=Path, default=_DEFAULT_CACHE)
    args = parser.parse_args(argv)

    editions = list(EDITION_FOLDERS) if args.all else list(args.edition)
    unknown = [e for e in editions if e not in EDITION_FOLDERS]
    if unknown or not editions:
        parser.error(f"unknown or empty editions: {unknown or editions}")

    from app.core.errors import APIError
    from app.modules.quran import alignment, hifz_engines, hifz_service

    words = _tanzil()
    surah_counts: dict[int, int] = {}
    for (s, a) in words:
        surah_counts[s] = max(surah_counts.get(s, 0), a)

    engine = hifz_engines.ZipformerEngine()
    ok, reason = engine.is_configured()
    if not ok:
        print(f"zipformer not configured: {reason}", file=sys.stderr)
        return 2

    manifest = _load_manifest()
    grand = {"ayahs": 0, "timed_words": 0, "words": 0, "seconds": 0.0}

    for edition in editions:
        folder = EDITION_FOLDERS[edition]
        entry = manifest["editions"].setdefault(
            edition,
            {"folder": folder, "surahs_done": [], "ayahs_done": 0,
             "surah_ayah_counts": {}, "ayahs_failed": {}},
        )
        entry["folder"] = folder
        entry.setdefault("surah_ayah_counts", {})
        surahs = args.surah or list(range(1, 115))
        for surah in surahs:
            done = _existing_ayahs(edition, surah)
            todo = [
                a for a in range(1, surah_counts[surah] + 1) if a not in done
            ]
            if not todo:
                if surah not in entry["surahs_done"]:
                    entry["surahs_done"].append(surah)
                    entry["surahs_done"].sort()
                continue
            t0 = time.time()
            stats = {"timed": 0, "words": 0}

            def _flush() -> None:
                """نوشتن فایل سوره + مانیفست با پیشرفت فعلی (ازسرگیری
                در سطح آیه، نه فقط سوره — برای سوره‌های بلند)."""
                out = {
                    "edition": edition,
                    "surah": surah,
                    "source": "phoneme_alignment",
                    "folder": folder,
                    "ayahs": [done[a] for a in sorted(done)],
                }
                path = _surah_path(edition, surah)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    json.dumps(out, ensure_ascii=False), encoding="utf-8"
                )
                if len(done) == surah_counts[surah] and (
                    surah not in entry["surahs_done"]
                ):
                    entry["surahs_done"].append(surah)
                    entry["surahs_done"].sort()
                entry["surah_ayah_counts"][str(surah)] = len(done)
                entry["ayahs_done"] = sum(
                    entry["surah_ayah_counts"].values()
                )
                _save_manifest(manifest)

            for ayah in todo:
                key = f"{surah:03d}{ayah:03d}"
                mp3 = args.cache_dir / folder / f"{key}.mp3"
                wav = args.cache_dir / folder / f"{key}.wav"
                try:
                    if not mp3.is_file():
                        mp3.parent.mkdir(parents=True, exist_ok=True)
                        _download(
                            EVERYAYAH.format(folder=folder, key=key), mp3
                        )
                    _to_wav(mp3, wav)
                    wav_bytes = wav.read_bytes()
                    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
                        duration_ms = w.getnframes() * 1000 // w.getframerate()
                    timed = engine.transcribe_timed_phonemes(wav_bytes)
                    expected = words[(surah, ayah)]
                    units = hifz_service._phoneme_units(surah, ayah)
                    prep_units, heard, char_token = (
                        hifz_service._prepare_phoneme_alignment(units, timed)
                    )
                    aligned, _extra = alignment.align_phonemes(
                        expected, prep_units, heard, GREEN, AMBER
                    )
                    spans = hifz_service._spans_to_timings(
                        aligned, timed, char_token
                    )
                    counts: dict[str, int] = {}
                    for w in aligned:
                        counts[w.status] = counts.get(w.status, 0) + 1
                    seg_words = [
                        {
                            "word": wi + 1,
                            "start_ms": int(round(sp[0] * 1000)),
                            "end_ms": int(round(sp[1] * 1000)),
                        }
                        for wi, sp in sorted(spans.items())
                    ]
                    done[ayah] = {
                        "ayah": ayah,
                        "audio_url": EVERYAYAH.format(folder=folder, key=key),
                        "duration_ms": duration_ms,
                        "words": seg_words,
                        "counts": counts,
                    }
                    entry["ayahs_failed"].pop(f"{surah}:{ayah}", None)
                    stats["timed"] += len(seg_words)
                    stats["words"] += len(expected)
                    grand["ayahs"] += 1
                    grand["timed_words"] += len(seg_words)
                    grand["words"] += len(expected)
                except Exception as exc:  # noqa: BLE001 (یک آیهٔ بد نباید بچ را بکشد)
                    entry["ayahs_failed"][f"{surah}:{ayah}"] = (
                        f"{type(exc).__name__}: {exc}"[:200]
                    )
                    print(
                        f"  FAIL {edition} {surah}:{ayah}: {exc}",
                        file=sys.stderr,
                    )
                finally:
                    if wav.is_file():
                        wav.unlink()
                if ayah % 10 == 0:
                    _flush()
            _flush()
            complete = len(done) == surah_counts[surah]
            dt = time.time() - t0
            grand["seconds"] += dt
            print(
                f"{edition} surah {surah}: {len(done)}/{surah_counts[surah]} "
                f"ayahs, timed {stats['timed']}/{stats['words']} words, "
                f"{dt:.1f}s{' (complete)' if complete else ''}",
                flush=True,
            )
    print(
        f"TOTAL this run: {grand['ayahs']} ayahs, "
        f"{grand['timed_words']}/{grand['words']} words timed, "
        f"{grand['seconds']:.1f}s"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
