"""Positional alignment for hifz grading — own code, no app data copied.

Contract (design doc §4, user amendment 2026-11-04):
- Input: expected words (the academy's own Quran text, split on
  whitespace) and heard words (ASR transcription, same order as spoken).
- Output: one result per expected word plus a list of extra heard words.
- CONTINUE-AFTER-SKIP: alignment never stops at a skipped word or ayah.
  difflib aligns the rest of the sequence, so words after a skip are
  still graded (correct/close/wrong) instead of being dropped.
- Status is driven by probability through CRM thresholds:
  prob >= green -> correct, prob >= amber -> close, else wrong.
  Skipped words are always status "skipped" (prob 0.0).
- prob source: the ASR word probability when the engine provides one,
  otherwise a derived value from the match kind (exact 0.95, near 0.65,
  wrong 0.30). An exactly-matching word whose ASR probability is below
  amber is "close" (uncertain, needs improvement), never "wrong": the
  letters match, only the engine is unsure.
- mistake_type: wrong_word | wrong_tashkeel | skipped | None.
  "close" words carry no mistake row (they need improvement, they are
  not recorded as mistakes); "wrong" and "skipped" do.
- Tashkeel check: words equal after full normalization but different
  in raw form are compared again with diacritics stripped only: if
  they match then, the mistake is wrong_tashkeel; if they still
  differ (hamza/yeh letter-form variants), it is a wrong_word close.

Normalization: strip Arabic diacritics and Quranic annotation marks,
fold alef variants to bare alef, yeh variants to yeh, teh marbuta to
heh, and keep only Arabic letters. This is matching normalization
only — the stored expected_text keeps the original Uthmanic form.
"""

from __future__ import annotations

import difflib
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

__all__ = [
    "AlignedWord",
    "align_words",
    "levenshtein",
    "normalize_arabic_word",
    "strip_diacritics",
]

# احتمال‌های مشتق‌شده از نوعِ تطابق (فاز ۶): مقدارهای ثابتِ
# قراردادی‌اند، نه confidence کالیبره‌شده — هرگز نباید به‌صورت
# درصدِ قابل‌فهم نمایش داده شوند. فاصلهٔ بیشینهٔ «نزدیک» هم نقطهٔ
# شروعِ آزمایش است، نه عددِ کالیبره‌شده؛ «نزدیک» در مرزِ آن، پرچمِ
# needs_review می‌خورد.
PROB_CORRECT = 0.95
PROB_CLOSE = 0.65
PROB_WRONG = 0.30
NEAR_MISS_MAX_DISTANCE = 2

# Arabic diacritics + Quranic annotation marks stripped for matching.
_STRIP_RANGES = (
    (0x064B, 0x0652),  # fathatan .. sukun
    (0x0653, 0x0655),  # maddah, hamza above/below
    (0x0670, 0x0670),  # superscript alef
    (0x0610, 0x061A),  # Arabic signs
    (0x06D6, 0x06ED),  # Quranic annotation signs (incl. sajdah mark)
)

_ALEF_FOLD = {
    "\u0622": "\u0627",  # alef with madda
    "\u0623": "\u0627",  # alef with hamza above
    "\u0625": "\u0627",  # alef with hamza below
    "\u0671": "\u0627",  # alef wasla
}
_YEH_FOLD = {
    "\u0649": "\u064A",  # alef maksura -> yeh
    "\u0626": "\u064A",  # yeh with hamza -> yeh
}
_OTHER_FOLD = {
    "\u0624": "\u0648",  # waw with hamza -> waw
    "\u0629": "\u0647",  # teh marbuta -> heh
}


def _is_stripped(ch: str) -> bool:
    code = ord(ch)
    if ch == "\u0640":  # tatweel
        return True
    return any(lo <= code <= hi for lo, hi in _STRIP_RANGES)


def strip_diacritics(word: str) -> str:
    """Remove diacritics/annotation marks, keep letters as written."""
    return "".join(ch for ch in word if not _is_stripped(ch))


def normalize_arabic_word(word: str) -> str:
    """Matching form: stripped, folded, Arabic letters only."""
    out: list[str] = []
    for ch in strip_diacritics(word):
        ch = _ALEF_FOLD.get(ch, ch)
        ch = _YEH_FOLD.get(ch, ch)
        ch = _OTHER_FOLD.get(ch, ch)
        # Keep Arabic letters only (category Lo in Arabic blocks);
        # drops punctuation, ornaments, digits.
        if unicodedata.category(ch) == "Lo" and (
            "\u0600" <= ch <= "\u06FF"
            or "\u0750" <= ch <= "\u077F"
            or "\u08A0" <= ch <= "\u08FF"
        ):
            out.append(ch)
    return "".join(out)


def levenshtein(a: str, b: str) -> int:
    """Small edit distance for short normalized words."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[len(b)]


@dataclass
class AlignedWord:
    """One expected word after alignment."""

    word_index: int
    expected: str
    status: str  # correct | close | wrong | skipped
    prob: float
    heard: str | None
    mistake_type: str | None  # wrong_word | wrong_tashkeel | skipped | None
    # «نزدیک» در مرزِ بیشینهٔ فاصله (یا کلمهٔ ناتمامِ انتهای ضبط):
    # تصمیم قطعی نیست و بازبینی می‌خواهد. فقط سیگنالِ خروجی است؛
    # ذخیره نمی‌شود (ستونی ندارد) و در شمارندهٔ وضعیت‌ها اثری ندارد.
    needs_review: bool = False


def _status_for_prob(prob: float, green: float, amber: float) -> str:
    if prob >= green:
        return "correct"
    if prob >= amber:
        return "close"
    return "wrong"


def align_words(
    expected: list[str],
    heard: list[str],
    heard_probs: list[float | None] | None = None,
    green: float = 0.8,
    amber: float = 0.5,
) -> tuple[list[AlignedWord], list[str]]:
    """Align heard words onto expected words, positionally.

    Returns (aligned, extra_heard_words). Alignment continues past
    skips: a deleted expected word is "skipped" and later words are
    still matched, never dropped.
    """
    norm_expected = [normalize_arabic_word(w) for w in expected]
    norm_heard = [normalize_arabic_word(w) for w in heard]
    probs = heard_probs if heard_probs is not None else [None] * len(heard)

    aligned: list[AlignedWord] = []
    extra: list[str] = []

    def prob_at(i: int) -> float | None:
        if 0 <= i < len(probs):
            p = probs[i]
            if p is None:
                return None
            return max(0.0, min(1.0, float(p)))
        return None

    def emit_pair(e_idx: int, h_idx: int) -> None:
        exp = expected[e_idx]
        hrd = heard[h_idx]
        if norm_expected[e_idx] == norm_heard[h_idx]:
            # Same letters. Raw difference decides the mistake kind.
            if strip_diacritics(exp) == strip_diacritics(hrd) and exp != hrd:
                # Only diacritics differ.
                p = PROB_CLOSE
                aligned.append(
                    AlignedWord(e_idx, exp, "close", p, hrd, "wrong_tashkeel")
                )
                return
            if exp == hrd:
                raw_p = prob_at(h_idx)
                p = PROB_CORRECT if raw_p is None else raw_p
                status = "correct" if p >= green else "close"
                aligned.append(
                    AlignedWord(
                        e_idx, exp, status, p, hrd, None,
                        needs_review=(status == "close"),
                    )
                )
                return
            # Letter-form variant only (hamza/yeh folding).
            aligned.append(
                AlignedWord(e_idx, exp, "close", PROB_CLOSE, hrd, "wrong_word")
            )
            return
        # Different letters: near miss or wrong, by edit distance.
        # Status follows the CRM thresholds on the derived probability.
        dist = levenshtein(norm_expected[e_idx], norm_heard[h_idx])
        if dist <= NEAR_MISS_MAX_DISTANCE and max(len(norm_expected[e_idx]), 1) > 3:
            aligned.append(
                AlignedWord(
                    e_idx, exp,
                    _status_for_prob(PROB_CLOSE, green, amber),
                    PROB_CLOSE, hrd, "wrong_word",
                    needs_review=(dist == NEAR_MISS_MAX_DISTANCE),
                )
            )
        else:
            aligned.append(
                AlignedWord(
                    e_idx, exp,
                    _status_for_prob(PROB_WRONG, green, amber),
                    PROB_WRONG, hrd, "wrong_word",
                )
            )

    matcher = difflib.SequenceMatcher(
        a=norm_expected, b=norm_heard, autojunk=False
    )
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                emit_pair(i1 + k, j1 + k)
        elif tag == "delete":
            for e_idx in range(i1, i2):
                aligned.append(
                    AlignedWord(e_idx, expected[e_idx], "skipped", 0.0, None, "skipped")
                )
        elif tag == "insert":
            for h_idx in range(j1, j2):
                extra.append(heard[h_idx])
        elif tag == "replace":
            n = min(i2 - i1, j2 - j1)
            for k in range(n):
                emit_pair(i1 + k, j1 + k)
            for e_idx in range(i1 + n, i2):
                aligned.append(
                    AlignedWord(e_idx, expected[e_idx], "skipped", 0.0, None, "skipped")
                )
            for h_idx in range(j1 + n, j2):
                extra.append(heard[h_idx])

    aligned.sort(key=lambda w: w.word_index)
    return aligned, extra


def align_phonemes(
    expected: list[str],
    units: Sequence[tuple[tuple[int, ...], str | None]],
    phoneme_text: str,
    green: float = 0.8,
    amber: float = 0.5,
) -> tuple[list[AlignedWord], list[str]]:
    """Align a Zipformer phoneme string onto expected words, via segments.

    `units` are (word_indices, phoneme) pairs from the validated mapping:
    one unit may cover several words (connected-recitation merge) and a
    unit with phoneme None is an auto-skip (pause mark, no phonemes
    consumed). Matching mirrors the live path (exact / near-miss /
    lookahead-skip), except a true misread is "wrong" here (the recorded
    path has the full string, so it can mark it and resync by consuming
    the unit's length — a documented heuristic, not a claim of exactness).
    A near-miss at the maximum distance carries `needs_review`. A
    trailing strict prefix (the recording ended mid-word) is "skipped"
    with `needs_review`, not "wrong": the word is incomplete, and the
    rest of the ayah is simply unheard. Leftover phoneme material is
    returned as a single extra entry: it is unparsed phoneme material,
    never presented as words.

    Returns (aligned, extra) in the same shape as `align_words`.
    """
    aligned: list[AlignedWord] = []
    extra: list[str] = []
    buf = phoneme_text
    i = 0
    while i < len(units):
        widxs, phon = units[i]
        if phon is None:
            for wi in widxs:
                exp = expected[wi] if wi < len(expected) else ""
                aligned.append(
                    AlignedWord(wi, exp, "skipped", 0.0, None, "skipped")
                )
            i += 1
            continue
        if buf.startswith(phon):
            for wi in widxs:
                exp = expected[wi] if wi < len(expected) else ""
                aligned.append(
                    AlignedWord(
                        wi, exp,
                        _status_for_prob(PROB_CORRECT, green, amber),
                        PROB_CORRECT, exp, None,
                    )
                )
            buf = buf[len(phon):]
            i += 1
            continue
        near_dist: int | None = None
        if len(buf) >= len(phon) and len(phon) > 3:
            near_dist = levenshtein(buf[: len(phon)], phon)
        if near_dist is not None and near_dist <= NEAR_MISS_MAX_DISTANCE:
            for wi in widxs:
                exp = expected[wi] if wi < len(expected) else ""
                aligned.append(
                    AlignedWord(
                        wi, exp,
                        _status_for_prob(PROB_CLOSE, green, amber),
                        PROB_CLOSE, exp, "wrong_word",
                        needs_review=(
                            near_dist == NEAR_MISS_MAX_DISTANCE
                        ),
                    )
                )
            buf = buf[len(phon):]
            i += 1
            continue
        found = None
        for j in range(i + 1, min(len(units), i + 41)):
            pj = units[j][1]
            if pj is not None and buf.startswith(pj):
                found = j
                break
        if found is not None:
            for k in range(i, found):
                for wi in units[k][0]:
                    exp = expected[wi] if wi < len(expected) else ""
                    aligned.append(
                        AlignedWord(wi, exp, "skipped", 0.0, None, "skipped")
                    )
            i = found
            continue
        if not buf:
            # چیزی شنیده نشده (یا همهٔ واج‌ها مصرف شده‌اند): بقیهٔ
            # واحدها جاافتاده‌اند، نه غلط.
            for wi in widxs:
                exp = expected[wi] if wi < len(expected) else ""
                aligned.append(
                    AlignedWord(wi, exp, "skipped", 0.0, None, "skipped")
                )
            i += 1
            continue
        if phon.startswith(buf):
            # ضبط وسطِ کلمه تمام شده: بافرِ مانده پیشوندِ این واحد
            # است — کلمه ناتمام است، نه غلط. این واحد «جاافتاده» با
            # پرچمِ بازبینی می‌خورد و بقیهٔ واحدها هم جاافتاده‌اند
            # (دیگر چیزی نشنیده‌ایم)؛ بافرِ مانده مادهٔ واجیِ
            # تجزیه‌نشده است و پایین به extra می‌رود.
            for wi in widxs:
                exp = expected[wi] if wi < len(expected) else ""
                aligned.append(
                    AlignedWord(
                        wi, exp, "skipped", 0.0, None, "skipped",
                        needs_review=True,
                    )
                )
            i += 1
            while i < len(units):
                for wi in units[i][0]:
                    exp = expected[wi] if wi < len(expected) else ""
                    aligned.append(
                        AlignedWord(wi, exp, "skipped", 0.0, None, "skipped")
                    )
                i += 1
            break
        chunk = buf[: len(phon)]
        for wi in widxs:
            exp = expected[wi] if wi < len(expected) else ""
            aligned.append(
                AlignedWord(
                    wi, exp,
                    _status_for_prob(PROB_WRONG, green, amber),
                    PROB_WRONG, chunk or None, "wrong_word",
                )
            )
        buf = buf[len(phon):]
        i += 1
    if buf:
        extra.append(buf)
    aligned.sort(key=lambda w: w.word_index)
    return aligned, extra
