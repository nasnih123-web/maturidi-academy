#!/usr/bin/env python3
"""دود (smoke) استقرار compose تولید — C-04.

داخل کانتینر api اجرا می‌شود (docker compose exec) چون سرویس api در
compose تولید پورت هاست ندارد (فقط expose داخلی). چهار بررسی واقعی:
health، چرخهٔ auth (register→login با کپچای خاموشِ صریح در env دود)،
بخش‌های صفحهٔ خانه، و handshake وب‌سوکت با بلیط یک‌بارمصرف.
خروج غیرصفر = شکست دود. فقط stdlib + httpx + websockets (هر دو در
ایمیج api هستند: httpx وابستگی مستقیم، websockets از uvicorn[standard]).
"""
from __future__ import annotations

import asyncio
import sys
import time
import urllib.request

import httpx

BASE = "http://127.0.0.1:8000"
EMAIL = "smoke@example.com"
PASSWORD = "SmokePass123!"


def wait_health(deadline_s: int = 300) -> None:
    start = time.time()
    while time.time() - start < deadline_s:
        try:
            with urllib.request.urlopen(f"{BASE}/health", timeout=4) as resp:
                if resp.status == 200:
                    print("smoke: /health 200")
                    return
        except Exception:
            time.sleep(3)
    raise SystemExit("smoke FAILED: api did not become healthy in time")


async def main() -> None:
    wait_health()
    async with httpx.AsyncClient(base_url=BASE, timeout=15.0) as client:
        r = await client.get("/api/v1/health")
        assert r.status_code == 200, f"health_v1: {r.status_code}"
        body = r.json()
        assert body["media_tools"]["ready"], f"media tools not ready: {body['media_tools']}"
        print("smoke: /api/v1/health 200, media_tools ready")

        r = await client.post(
            "/api/v1/auth/register",
            json={
                "full_name": "Smoke User",
                "email": EMAIL,
                "password": PASSWORD,
                "locale": "fa",
                "accept_terms": True,
            },
        )
        assert r.status_code in (201, 400), f"register: {r.status_code} {r.text[:200]}"
        # 400 قابل‌قبول فقط اگر کاربر از اجرای قبلیِ دود مانده باشد
        # (حجم compose در CI تازه است؛ این شاخه برای اجرای دستیِ تکراری است).

        r = await client.post(
            "/api/v1/auth/login", json={"identifier": EMAIL, "password": PASSWORD}
        )
        assert r.status_code == 200, f"login: {r.status_code} {r.text[:200]}"
        token = r.json()["access_token"]
        print("smoke: register/login OK")

        r = await client.get("/api/v1/home/sections")
        assert r.status_code == 200, f"home sections: {r.status_code}"
        print("smoke: /api/v1/home/sections 200")

        r = await client.post(
            "/api/v1/auth/ws-ticket", headers={"Authorization": "Bearer " + token}
        )
        assert r.status_code == 200, f"ws-ticket: {r.status_code} {r.text[:200]}"
        ticket = r.json()["ticket"]

    import websockets

    async with websockets.connect(f"ws://127.0.0.1:8000/ws/events?ticket={ticket}") as ws:
        await ws.send('{"type": "ping"}')
        msg = await asyncio.wait_for(ws.recv(), timeout=10)
        print(f"smoke: websocket connected, first frame: {str(msg)[:80]}")

    print("smoke: ALL CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
    sys.exit(0)
