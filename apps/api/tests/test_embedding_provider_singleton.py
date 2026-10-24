"""FIX2-04 — provider/model embedding باید singleton تنبلِ پردازه باشد.

پیش از fix، get_embedding_provider در هر فراخوانی نمونهٔ تازه می‌ساخت
و LocalModelEmbeddingProvider در هر درخواست SentenceTransformer را از
نو لود می‌کرد. قرارداد جدید:

- local_model و hash: نمونهٔ کش‌شدهٔ یکسان در فراخوانی‌های مکرر
  (ساخت مدل دقیقاً یک بار — با SentenceTransformer stub شمارنده).
- external_api: عمداً کش نمی‌شود چون به AsyncSession همان درخواست
  گره خورده است؛ دو فراخوانی دو نمونهٔ جدا می‌دهند.
"""
from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from app.modules.fatwa import embeddings as emb


class _CountingSentenceTransformer:
    """stub سبک sentence_transformers — تعداد ساخت‌ها را می‌شمارد."""

    constructions = 0

    def __init__(self, model_name: str) -> None:
        type(self).constructions += 1
        self.model_name = model_name

    def encode(self, texts, normalize_embeddings: bool = True):
        # بردار ۳۸۴بعدی ثابت (بُعد بومی MiniLM) — fit_dim آن را به ۲۵۶ می‌رساند
        return [[0.25] * 384 for _ in texts]


@pytest.fixture(autouse=True)
def _stub_sentence_transformers(monkeypatch):
    _CountingSentenceTransformer.constructions = 0
    fake_module = SimpleNamespace(SentenceTransformer=_CountingSentenceTransformer)
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_module)
    emb.reset_embedding_provider_cache()
    yield
    emb.reset_embedding_provider_cache()


async def test_local_model_provider_is_singleton(tc):
    async with tc["maker"]() as db:
        first = await emb.get_embedding_provider(db, "local_model")
        second = await emb.get_embedding_provider(db, "local_model")

    assert first is second
    assert _CountingSentenceTransformer.constructions == 1
    # embed همچنان کار می‌کند و خروجی EMBEDDING_DIMبعدی است
    vectors = await first.embed(["حکم نماز مسافر چیست"])
    assert len(vectors) == 1
    assert len(vectors[0]) == emb.EMBEDDING_DIM


async def test_hash_provider_is_singleton(tc):
    async with tc["maker"]() as db:
        first = await emb.get_embedding_provider(db, "hash")
        second = await emb.get_embedding_provider(db, "hash")
    assert first is second
    assert isinstance(first, emb.HashEmbeddingProvider)


async def test_external_provider_is_not_cached(tc):
    """external به نشستِ درخواست گره خورده — کش‌کردنش نشت نشست است."""
    async with tc["maker"]() as db:
        first = await emb.get_embedding_provider(db, "external_api")
        second = await emb.get_embedding_provider(db, "external_api")
    assert first is not second
    assert isinstance(first, emb.ExternalAPIEmbeddingProvider)
