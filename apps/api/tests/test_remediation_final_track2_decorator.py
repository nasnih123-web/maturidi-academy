"""final remediation — Track 2 / Finding 9: ریشهٔ باگ 422 در دکوراتور rate_limit.

ریشهٔ علت (تأییدشده با پروب واقعی): اگر `typing.get_type_hints(fn)` روی
endpoint شکست بخورد، دکوراتورِ قبلی بی‌صدا به annotationهای رشته‌ایِ
حل‌نشده برمی‌گشت؛ FastAPI آن رشته‌ها را در `__globals__` ماژولِ دکوراتور
(`app.core.rate_limit`) resolve می‌کند — نه در ماژولِ endpoint — و چون
`try_eval_type` سهل‌گیر است، ForwardRef حل‌نشده باقی می‌ماند: پارامترِ body
به query-param بد دسته‌بندی می‌شود و هر درخواست 422 می‌گیرد، بی‌آنکه مسیر
429 دیده شود. اصلاح: fail-fast با RuntimeError صریح در لحظهٔ دکوراسیون؛
قرارداد API برای endpointهای سالم هیچ تغییری نمی‌کند.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel

from app.core import rate_limit as rl_mod
from app.core.errors import register_error_handlers
from app.core.rate_limit import rate_limit


class _ItemIn(BaseModel):
    name: str


def _define_broken_endpoint():
    """تعریف endpoint با annotationِ حل‌ناشدنی در namespace ایزوله."""
    ns: dict = {"__name__": "probe_mod"}
    exec(
        "from __future__ import annotations\n"
        "async def broken_ep(data: NonExistentModel, request):\n"
        "    return {'ok': True}\n",
        ns,
    )
    return ns["broken_ep"]


def test_decorator_fails_fast_on_unresolvable_hints():
    """به‌جای 422ِ خاموش در runtime: خطای صریح در لحظهٔ دکوراسیون."""
    from app.core.rate_limit import rate_limit

    broken = _define_broken_endpoint()
    with pytest.raises(RuntimeError, match="cannot resolve annotation"):
        rate_limit(lambda req: "probe-422", limit=1, window_s=60)(broken)


def test_decorator_preserves_api_contract():
    """قرارداد API دست‌نخورده: body معتبر → 200، body نامعتبر → 422،
    پس از سقف → 429 (نه 422)."""
    rl_mod.reset_rate_limiter_for_tests()
    app = FastAPI()
    register_error_handlers(app)

    @app.post("/items")
    @rate_limit(lambda req: "probe-contract", limit=10, window_s=60)
    async def create_item(data: _ItemIn, request: Request):
        return {"name": data.name}

    async def _run():
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.post("/items", json={"name": "x"})
            assert r.status_code == 200, r.text
            assert r.json() == {"name": "x"}
            # قرارداد اعتبارسنجی: ورودی نامعتبر همچنان 422 می‌گیرد
            r = await c.post("/items", json={"name": 123})
            assert r.status_code == 422, r.text

    asyncio.run(_run())
    rl_mod.reset_rate_limiter_for_tests()


async def test_decorator_rate_limited_returns_429_not_422():
    """پس از سقف، درخواستِ معتبر 429 می‌گیرد — نه 422."""
    rl_mod.reset_rate_limiter_for_tests()
    app = FastAPI()
    register_error_handlers(app)

    @app.post("/limited")
    @rate_limit(lambda req: "probe-429", limit=1, window_s=60)
    async def limited(data: _ItemIn, request: Request):
        return {"name": data.name}

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        assert (await c.post("/limited", json={"name": "a"})).status_code == 200
        r = await c.post("/limited", json={"name": "b"})
        assert r.status_code == 429, r.text
        assert r.json()["error"]["code"] == "rate_limited"
    rl_mod.reset_rate_limiter_for_tests()
