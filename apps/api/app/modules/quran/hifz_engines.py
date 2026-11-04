"""ASR engine registry for hifz grading — both engines, one default.

User decision 2026-11-04 (§14): Zipformer (Quran-Lab) is the DEFAULT,
Whisper-quran (tarteel-ai/whisper-base-ar-quran) is CRM-selectable via
``quran.asr_engine``. Resolution is server-side from the stored setting.

Honesty rules (non-negotiable):
- Engines lazy-load ONLY when selected and configured: importing this
  module, booting the API, or reading settings never loads a model.
- A selected engine that cannot load or transcribe returns an honest
  EngineError (surfaced as HTTP 503). It NEVER silently switches to
  the other engine and NEVER returns fake scores.
- Model files are local directories configured by environment
  (HIFZ_ZIPFORMER_MODEL_DIR / HIFZ_WHISPER_MODEL_DIR). No model is
  downloaded at runtime, and no third-party API is called.
- The exact artifact layout / license / runtime for each engine is
  verified from its real source before the adapter is trusted; an
  unverified adapter stays in the "not configured" state with the
  exact reason, never in a faked working state.

Verified 2026-11-04 (page-text verification only; no download executed):
- ZIPFORMER (Quran-Lab, repo Quran-Lab/zipformer_p-arabic-v3, pin v3.1
  until v3.2's file presence is confirmed on the HF card): a STREAMING
  CTC model, NOT a transducer — sherpa-onnx needs exactly ONE .onnx
  file + tokens.txt (no encoder/decoder/joiner files). 65.5M params,
  NO language model by design. Input: 16 kHz mono, 80-dim Kaldi fbank
  (sherpa defaults match; a slaney-mel front end roughly doubles the
  error). Output: a 251-symbol PHONEME stream (tajweed distinctions
  included) with per-phoneme timestamps via sherpa-onnx — NOT words.
  Word-level grading from phonemes uses the repo's shipped
  ordered_quran_phonemes.json mapping (validated + segment-aligned
  by hifz_mapping.py; the ayah-text-keyed quran_text2phoneme.json is
  a cross-check only), so this adapter is honest about its output
  level (see below) and the word-grading path aligns phonemes via
  segments rather than faking word scores. License: Quran-Lab
  No-Profit License v1.2 — free use,
  but charging for the model, access to it, or any feature it powers
  is forbidden (share-alike per downstream notices; read LICENSE
  before shipping). Download may require HF license agreement.
- WHISPER-QURAN (tarteel-ai/whisper-base-ar-quran, repo id verified;
  trainer-reported WER 5.7544 on an UNNAMED eval set): faster-whisper
  needs a CTranslate2 directory — use the third-party conversion
  hkhan0327/faster-whisper-base-ar-quran (pinned source commit
  5c3c53f...) or convert locally; the transformers repo itself is
  not directly loadable by faster-whisper. Word timestamps via
  faster-whisper are DTW estimates, not phoneme-accurate alignment.
  License Apache-2.0 is corroborated by secondary pages only — the
  official card shows no license field, so confirm it on the live HF
  page before commercial use. Output is Arabic TEXT (not phonemes).
"""

from __future__ import annotations

import glob
import importlib.util
import os
import tempfile
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "ENGINE_IDS",
    "EngineError",
    "HeardWord",
    "Transcription",
    "get_engine",
    "resolve_engine_id",
]


ENGINE_IDS = ("zipformer", "whisper_quran")

_ZIPFORMER_ENV = "HIFZ_ZIPFORMER_MODEL_DIR"
_WHISPER_ENV = "HIFZ_WHISPER_MODEL_DIR"


class EngineError(Exception):
    """Honest engine failure. code: engine_not_configured |
    engine_load_failed | engine_transcription_failed."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class HeardWord:
    text: str
    prob: float | None = None


@dataclass
class Transcription:
    text: str
    words: list[HeardWord] = field(default_factory=list)


def _find_spec(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _model_dir(env_name: str) -> tuple[str | None, str]:
    """Return (dir, reason). reason is "" when the dir is usable."""
    d = os.environ.get(env_name, "").strip()
    if not d:
        return None, f"{env_name} is not set"
    if not os.path.isdir(d):
        return None, f"{env_name} does not point to a directory: {d}"
    return d, ""


class BaseEngine:
    engine_id: str = ""
    display_name: str = ""
    env_var: str = ""
    runtime_module: str = ""
    # Output granularity of transcribe(): "word" feeds the word-grading
    # contract directly; "phoneme" (Zipformer) does NOT — the service
    # refuses to word-grade phoneme output rather than fake word scores.
    output_level: str = "word"

    def is_configured(self) -> tuple[bool, str]:
        """Cheap probe: env dir + runtime importable. Never loads a model."""
        d, reason = _model_dir(self.env_var)
        if d is None:
            return False, reason
        if not _find_spec(self.runtime_module):
            return False, f"runtime package '{self.runtime_module}' is not installed"
        return True, ""

    def transcribe(self, wav_bytes: bytes) -> Transcription:
        raise NotImplementedError


def _temp_wav_path(wav_bytes: bytes) -> str:
    fd, path = tempfile.mkstemp(suffix=".wav", prefix="hifz-grade-")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(wav_bytes)
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise
    return path


class ZipformerEngine(BaseEngine):
    """Quran-Lab Zipformer via sherpa-onnx streaming CTC (no LM).

    VERIFIED artifact layout (repo Quran-Lab/zipformer_p-arabic-v3,
    pin v3.1): exactly ONE .onnx file (prefer the int8 export,
    e.g. zipformer_p_arabic_v3.1.int8.onnx) + tokens.txt. There are
    NO encoder/decoder/joiner files — this is a CTC model, and an
    adapter looking for transducer parts would never configure.
    Load: sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc
    (tokens=..., model=...); sherpa's feature defaults (16 kHz,
    80-dim fbank) match the model's requirement. Transcription is a
    251-symbol PHONEME stream with per-phoneme timestamps — the
    Transcription.words here are phonemes, and the word-grading path
    aligns them via the validated segment mapping (output_level =
    "phoneme"; see hifz_mapping.py). License: NPL-1.2 — never charge
    for a feature it powers.
    """

    engine_id = "zipformer"
    display_name = "Zipformer (Quran-Lab)"
    env_var = _ZIPFORMER_ENV
    runtime_module = "sherpa_onnx"
    output_level = "phoneme"

    _recognizer: Any | None = None

    def is_configured(self) -> tuple[bool, str]:
        ok, reason = super().is_configured()
        if not ok:
            return False, reason
        d, _ = _model_dir(self.env_var)
        assert d is not None
        missing = self._missing_files(d)
        if missing:
            return False, f"model dir {d} is missing: {', '.join(missing)}"
        return True, ""

    @staticmethod
    def _missing_files(d: str) -> list[str]:
        missing = []
        if not glob.glob(os.path.join(d, "*.onnx")):
            missing.append("*.onnx (single CTC export, e.g. *int8.onnx)")
        if not os.path.isfile(os.path.join(d, "tokens.txt")):
            missing.append("tokens.txt")
        return missing

    @staticmethod
    def _onnx_path(d: str) -> str:
        int8 = glob.glob(os.path.join(d, "*int8*.onnx"))
        if int8:
            return min(int8)
        return min(glob.glob(os.path.join(d, "*.onnx")))

    def _load(self) -> Any:
        if self._recognizer is not None:
            return self._recognizer
        d, _ = _model_dir(self.env_var)
        assert d is not None
        try:
            import sherpa_onnx
        except ImportError as exc:
            raise EngineError(
                "engine_not_configured", f"sherpa_onnx is not installed: {exc}"
            ) from exc
        try:
            recognizer = sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc(
                tokens=os.path.join(d, "tokens.txt"),
                model=self._onnx_path(d),
            )
        except Exception as exc:
            raise EngineError(
                "engine_load_failed", f"zipformer model failed to load: {exc}"
            ) from exc
        self._recognizer = recognizer
        return recognizer

    def transcribe(self, wav_bytes: bytes) -> Transcription:
        """Phoneme transcription (NOT words — see output_level)."""
        ok, reason = self.is_configured()
        if not ok:
            raise EngineError("engine_not_configured", reason)
        try:
            recognizer = self._load()
            import sherpa_onnx

            path = _temp_wav_path(wav_bytes)
            try:
                samples, sr = sherpa_onnx.read_wave(path)
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            # Single-shot decode through the stream object is sherpa's
            # file pattern; the stream carries the CTC cache state.
            # (Live-mic chunked feeding is a later feature, not Phase 3.)
            stream = recognizer.create_stream()
            stream.accept_waveform(sr, samples)
            recognizer.decode_stream(stream)
            result = stream.result
            tokens = [str(t) for t in (result.tokens or []) if str(t)]
            text = " ".join(tokens)
        except EngineError:
            raise
        except Exception as exc:
            raise EngineError(
                "engine_transcription_failed", f"zipformer transcription failed: {exc}"
            ) from exc
        # Phoneme tokens, deliberately NOT words: per-phoneme confidence
        # is not in the sherpa result (it lives in the repo's separate
        # decode_with_confidence.py), so prob stays None.
        words = [HeardWord(t) for t in tokens]
        return Transcription(text=text, words=words)


class WhisperQuranEngine(BaseEngine):
    """tarteel-ai/whisper-base-ar-quran via faster-whisper.

    Model dir: a local faster-whisper (CTranslate2) directory — the
    transformers repo itself is NOT directly loadable by faster-whisper;
    use the third-party conversion hkhan0327/faster-whisper-base-ar-quran
    (pinned source commit 5c3c53f...) or convert locally. No download
    at runtime: an unset or missing dir is an honest
    engine_not_configured, never a silent fetch. Output is Arabic TEXT
    with DTW-estimated word timestamps (not phoneme-accurate alignment).
    License note: Apache-2.0 is corroborated by secondary pages only —
    the official card shows no license field; confirm on the live HF
    page before commercial use.
    """

    engine_id = "whisper_quran"
    display_name = "Whisper-quran (tarteel-ai)"
    env_var = _WHISPER_ENV
    runtime_module = "faster_whisper"

    _model: Any | None = None

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        d, _ = _model_dir(self.env_var)
        assert d is not None
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise EngineError(
                "engine_not_configured", f"faster_whisper is not installed: {exc}"
            ) from exc
        try:
            model = WhisperModel(d, device="cpu", compute_type="int8")
        except Exception as exc:
            raise EngineError(
                "engine_load_failed", f"whisper model failed to load: {exc}"
            ) from exc
        self._model = model
        return model

    def transcribe(self, wav_bytes: bytes) -> Transcription:
        ok, reason = self.is_configured()
        if not ok:
            raise EngineError("engine_not_configured", reason)
        try:
            model = self._load()
            path = _temp_wav_path(wav_bytes)
            try:
                segments, _info = model.transcribe(
                    path, language="ar", word_timestamps=True
                )
                words: list[HeardWord] = []
                texts: list[str] = []
                for seg in segments:
                    texts.append(seg.text or "")
                    for w in seg.words or []:
                        word = (w.word or "").strip()
                        if word:
                            words.append(HeardWord(word, w.probability))
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass
        except EngineError:
            raise
        except Exception as exc:
            raise EngineError(
                "engine_transcription_failed", f"whisper transcription failed: {exc}"
            ) from exc
        text = " ".join(t.strip() for t in texts if t.strip())
        if not words and text:
            words = [HeardWord(t) for t in text.split() if t]
        return Transcription(text=text, words=words)


_ADAPTERS: dict[str, type[BaseEngine]] = {
    "zipformer": ZipformerEngine,
    "whisper_quran": WhisperQuranEngine,
}


def get_engine(engine_id: str) -> BaseEngine:
    """Adapter instance for a known engine id (no model loaded yet)."""
    cls = _ADAPTERS.get(engine_id)
    if cls is None:
        raise EngineError(
            "engine_not_configured", f"unknown asr engine: {engine_id!r}"
        )
    return cls()


async def resolve_engine_id(db) -> str:
    """Selected engine from the stored CRM setting (server-side).

    Falls back to the default only when no value is stored; a stored
    unknown value is an honest error, never a silent default.
    """
    from app.core.platform_settings import get_typed_setting

    raw = await get_typed_setting(db, "quran.asr_engine", "zipformer")
    if not isinstance(raw, str) or raw not in ENGINE_IDS:
        raise EngineError(
            "engine_not_configured", f"stored asr engine is not valid: {raw!r}"
        )
    return raw
