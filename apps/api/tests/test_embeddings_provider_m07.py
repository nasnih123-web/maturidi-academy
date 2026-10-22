"""تست‌های M-07 (ADR-0038): provider واقعی embedding پیش‌فرض production.

- resolve: بدون setting ← dev = hash، production = local_model.
- status: hash در هر محیطی «semantic search disabled» است؛ external
  بدون endpoint هم disabled؛ local با پکیج نصب = enabled.
- fit_dim: خروجی همهٔ providerها EMBEDDING_DIMبعدی و نرمال‌شده.
- تست زندهٔ مدل واقعی (اگر sentence-transformers نصب باشد): شباهت
  معنایی جملهٔ هم‌معنا > جملهٔ نامرتبط — skip شفاف در نبود پکیج.
"""
from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.platform_settings import stage_setting
from app.models.models import PlatformSetting
from app.modules.fatwa.embeddings import (
    EMBEDDING_DIM,
    HashEmbeddingProvider,
    cosine_similarity,
    fit_dim,
    get_embedding_provider,
    resolve_provider_name,
    semantic_search_status,
)


@pytest.fixture()
def app_env():
    s = get_settings()
    saved = s.app_env
    yield s
    s.app_env = saved


async def _clear_provider_setting(db_session) -> None:
    row = await db_session.get(PlatformSetting, "ai.embedding_provider")
    if row is not None:
        await db_session.delete(row)
        await db_session.commit()
    from app.core.platform_settings import reset_settings_cache

    reset_settings_cache()


async def test_default_provider_dev_is_hash(db_session, app_env):
    await _clear_provider_setting(db_session)
    app_env.app_env = "dev"
    assert await resolve_provider_name(db_session) == "hash"
    provider = await get_embedding_provider(db_session)
    assert isinstance(provider, HashEmbeddingProvider)


async def test_default_provider_production_is_local_model(db_session, app_env):
    await _clear_provider_setting(db_session)
    app_env.app_env = "production"
    assert await resolve_provider_name(db_session) == "local_model"


async def test_status_hash_is_disabled_with_reason(db_session, app_env):
    await _clear_provider_setting(db_session)
    app_env.app_env = "production"
    await stage_setting(db_session, "ai.embedding_provider", '"hash"')
    await db_session.commit()
    from app.core.platform_settings import reset_settings_cache

    reset_settings_cache()
    status = await semantic_search_status(db_session)
    assert status["provider"] == "hash"
    assert status["semantic_enabled"] is False
    assert "semantic search disabled" in status["reason"]
    # پاکسازی برای تست‌های بعدی همین session
    await _clear_provider_setting(db_session)


async def test_status_external_without_endpoint_is_disabled(db_session):
    await stage_setting(db_session, "ai.embedding_provider", '"external_api"')
    await db_session.commit()
    from app.core.platform_settings import reset_settings_cache

    reset_settings_cache()
    status = await semantic_search_status(db_session)
    assert status["provider"] == "external_api"
    assert status["semantic_enabled"] is False
    assert "embedding_endpoint" in status["reason"]
    await _clear_provider_setting(db_session)


def test_fit_dim_projects_and_normalizes():
    long_vec = [float(i + 1) for i in range(384)]
    out = fit_dim(long_vec)
    assert len(out) == EMBEDDING_DIM
    assert abs(sum(x * x for x in out) - 1.0) < 1e-6
    short = fit_dim([3.0, 4.0])
    assert len(short) == EMBEDDING_DIM
    assert abs(short[0] - 0.6) < 1e-9 and abs(short[1] - 0.8) < 1e-9


async def test_connections_status_includes_embeddings(tc, db_session):
    from app.modules.admin.connections_service import get_status

    out = await get_status(db_session)
    assert "embeddings" in out
    assert set(out["embeddings"]) >= {"provider", "semantic_enabled", "reason"}


try:
    import sentence_transformers as _st  # noqa: F401

    _HAS_ST = True
except ImportError:
    _HAS_ST = False


@pytest.mark.skipif(not _HAS_ST, reason="sentence-transformers نصب نیست")
async def test_local_model_live_semantic_ordering():
    """مدل واقعی: جملهٔ هم‌معنا باید از نامرتبط نزدیک‌تر باشد."""
    from app.modules.fatwa.embeddings import LocalModelEmbeddingProvider

    provider = LocalModelEmbeddingProvider()
    query, paraphrase, unrelated = await provider.embed(
        [
            "حکم نماز جمعه برای مسافر چیست",
            "آیا مسافر باید در نماز جمعه شرکت کند",
            "طرز تهیهٔ خورشت قیمه با گوشت و لپه",
        ]
    )
    assert len(query) == EMBEDDING_DIM
    sim_para = cosine_similarity(query, paraphrase)
    sim_unrel = cosine_similarity(query, unrelated)
    assert sim_para > sim_unrel, (sim_para, sim_unrel)
