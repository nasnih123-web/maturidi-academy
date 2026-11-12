"""تست‌های دانلود استارتاپ فایل‌های حفاظ (بدون شبکهٔ واقعی)."""

from __future__ import annotations

from pathlib import Path
from typing import Self

import pytest

from app.core import hifz_assets


class _FakeResponse:
    def __init__(self, data: bytes):
        self._data = data
        self._pos = 0

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            chunk, self._pos = self._data[self._pos :], len(self._data)
            return chunk
        chunk = self._data[self._pos : self._pos + size]
        self._pos += len(chunk)
        return chunk

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        return None


@pytest.fixture
def asset_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    model_dir = tmp_path / "model"
    map_dir = tmp_path / "phoneme"
    monkeypatch.setenv("HIFZ_ZIPFORMER_MODEL_DIR", str(model_dir))
    monkeypatch.setenv("QURAN_PHONEME_MAP_DIR", str(map_dir))
    for var in (
        "HIFZ_MODEL_URL",
        "HIFZ_TOKENS_URL",
        "HIFZ_MAP_ORDERED_URL",
        "HIFZ_MAP_TEXT2PHONEME_URL",
    ):
        monkeypatch.setenv(var, f"https://example.invalid/{var}")
    return tmp_path


def test_download_all_writes_all_files(asset_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def fake_urlopen(request: object, timeout: int = 0) -> _FakeResponse:
        url = request.full_url if hasattr(request, "full_url") else str(request)
        calls.append(url)
        if "TOKENS" in url:
            return _FakeResponse(b"<blank> 250\n")
        return _FakeResponse(b"x" * 100)

    monkeypatch.setattr(hifz_assets.urllib.request, "urlopen", fake_urlopen)
    results = hifz_assets.download_all()
    assert all(v.startswith("ok") for v in results.values()), results
    assert (asset_env / "model" / "model.int8.onnx").stat().st_size == 100
    assert (asset_env / "model" / "tokens.txt").read_bytes() == b"<blank> 250\n"
    assert (asset_env / "phoneme" / "tokens.txt").read_bytes() == b"<blank> 250\n"
    assert (asset_env / "phoneme" / "ordered_quran_phonemes.json").stat().st_size == 100
    assert (asset_env / "phoneme" / "quran_text2phoneme.json").stat().st_size == 100
    assert len(calls) == 5


def test_download_skips_existing_and_never_raises(
    asset_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model_dir = asset_env / "model"
    model_dir.mkdir(parents=True)
    (model_dir / "model.int8.onnx").write_bytes(b"already here")

    def failing_urlopen(request: object, timeout: int = 0) -> _FakeResponse:
        raise ConnectionError("network down")

    monkeypatch.setattr(hifz_assets.urllib.request, "urlopen", failing_urlopen)
    results = hifz_assets.download_all()
    assert results["model/model.int8.onnx"].startswith("ok")
    assert "failed" in results["phoneme/ordered_quran_phonemes.json"]
    assert not (asset_env / "phoneme" / "ordered_quran_phonemes.json").exists()


def test_download_all_without_env_is_all_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in (
        "HIFZ_MODEL_URL",
        "HIFZ_TOKENS_URL",
        "HIFZ_MAP_ORDERED_URL",
        "HIFZ_MAP_TEXT2PHONEME_URL",
        "HIFZ_ZIPFORMER_MODEL_DIR",
        "QURAN_PHONEME_MAP_DIR",
    ):
        monkeypatch.delenv(var, raising=False)
    results = hifz_assets.download_all()
    assert all(v.startswith("skipped") for v in results.values())


def test_empty_download_is_failure_and_leaves_no_file(
    asset_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        hifz_assets.urllib.request, "urlopen", lambda *a, **k: _FakeResponse(b"")
    )
    results = hifz_assets.download_all()
    assert all("failed" in v for v in results.values())
    assert not list(asset_env.rglob("*.onnx"))
    assert not list(asset_env.rglob("*.json"))
