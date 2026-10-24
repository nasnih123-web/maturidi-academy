#!/usr/bin/env python3
"""دود (smoke) استقرار compose تولید — C-04 + FIX2-10.

دامنهٔ این دود (صریح): فقط سرویس api و closure وابستگی‌اش در
docker-compose.prod.yml بالا می‌آید (postgres, redis, minio, clamav,
migrate) — web/crm/workerها/monitoring در این job ساخته یا بررسی
نمی‌شوند و سبزشدن آن ادعای سلامت آن‌ها نیست.

داخل کانتینر api اجرا می‌شود (docker compose exec) چون سرویس api در
compose تولید پورت هاست ندارد (فقط expose داخلی). بررسی‌ها:
health، چرخهٔ auth (register→login با کپچای خاموشِ صریح در env دود)،
بخش‌های صفحهٔ خانه، handshake وب‌سوکت با بلیط یک‌بارمصرف، و از
FIX2-10: آپلود زندهٔ EICAR از مسیر واقعی آپلودِ محافظت‌شده با C-01
علیه ClamAV واقعی استک (باید با file_infected رد شود) + آپلود فایل
تمیز (باید از گیت اسکن رد شود).
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

    await _eicar_checks(token)

    print("smoke: ALL CHECKS PASSED")


# رشتهٔ استاندارد EICAR — فایل تست رسمی ضدویروس (بی‌ضرر؛ همهٔ
# اسکنرها آن را به‌عنوان امضای تست شناسایی می‌کنند).
EICAR = (
    r"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
)


def _tiny_wav() -> bytes:
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(8000)
        wf.writeframes(b"\x00\x00" * 800)
    return buf.getvalue()


async def _eicar_checks(token: str) -> None:
    """FIX2-10: اثبات زندهٔ C-01 علیه ClamAV واقعی استک.

    مسیر آپلود voice/transcribe اول فایل را اسکن می‌کند بعد هر
    پردازش دیگری (خود service.transcribe با scan شروع می‌شود)، پس:
    - EICAR باید دقیقاً با 422/file_infected رد شود؛ هر نتیجهٔ
      دیگری (از جمله قبول‌شدن یا antivirus_unavailable) یعنی اسکن
      واقعی در کار نیست و دود قرمز می‌شود.
    - فایل تمیز باید از گیت اسکن رد شود: پاسخ بعدی (موفقیت STT یا
      خطای پیکربندی STT) مهم نیست، فقط نباید ردِّ آنتی‌ویروسی باشد.
    """
    headers = {"Authorization": "Bearer " + token}
    async with httpx.AsyncClient(base_url=BASE, timeout=30.0) as client:
        r = await client.post(
            "/api/v1/voice/transcribe",
            headers=headers,
            files={"file": ("eicar-test.txt", EICAR.encode(), "text/plain")},
        )
        code = ((r.json().get("error") or {}).get("code")) if r.headers.get(
            "content-type", ""
        ).startswith("application/json") else None
        assert r.status_code == 422 and code == "file_infected", (
            f"eicar upload must be rejected as infected: "
            f"{r.status_code} {r.text[:200]}"
        )
        print("smoke: EICAR upload rejected by real ClamAV (422 file_infected)")

        r = await client.post(
            "/api/v1/voice/transcribe",
            headers=headers,
            files={"file": ("clean.wav", _tiny_wav(), "audio/wav")},
        )
        code = None
        if r.headers.get("content-type", "").startswith("application/json"):
            code = (r.json().get("error") or {}).get("code")
        assert code not in ("file_infected", "antivirus_unavailable"), (
            f"clean upload must pass the antivirus gate: "
            f"{r.status_code} {r.text[:200]}"
        )
        print(
            f"smoke: clean upload passed the antivirus gate "
            f"(downstream status {r.status_code}, code={code})"
        )


if __name__ == "__main__":
    asyncio.run(main())
    sys.exit(0)
