#!/usr/bin/env python3
"""چک‌لیست سلامت واقعی بعد از bootstrap (FIX2-06 — ADR-0048).

«موفقیت» بوت‌استرپ فقط وقتی اعلام می‌شود که هر سه چک واقعی روی
سرویس بالاآمده پاس شود؛ هر شکست = خروج غیرصفر و چاپ دقیق علت:

  ۱) GET  /health                          → 200 و status=ok
  ۲) POST /api/v1/auth/register + login    → کاربر تازه ساخته و وارد شود
     (در env محلی با CAPTCHA_ENABLED=false باید بدون کپچا کار کند)
  ۳) POST /api/v1/voice/transcribe         → آپلود WAV کوچک از مسیر
     واقعیِ محافظت‌شده با اسکن آنتی‌ویروس (C-01): پاس یعنی یا 200
     (STT پیکربندی شده) یا 503 با کد stt_unavailable — یعنی اسکن و
     اعتبارسنجی صدا رد شده و فقط ارائه‌دهندهٔ اختیاری STT تنظیم
     نیست. antivirus_unavailable یا file_infected یعنی شکست چک.

فقط کتابخانهٔ استاندارد پایتون — با هر python3 اجرا می‌شود.
"""
from __future__ import annotations

import argparse
import io
import json
import secrets
import sys
import urllib.error
import urllib.request
import wave


def _request(base: str, method: str, path: str, *, body: bytes | None = None,
             headers: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        base.rstrip("/") + path, data=body, method=method,
        headers=headers or {},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return exc.code, {"raw": raw[:200]}


def _tiny_wav() -> bytes:
    """WAV معتبر مینیمال (۰٫۱ ثانیه سکوت، ۸kHz مونو) با stdlib."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(8000)
        wf.writeframes(b"\x00\x00" * 800)
    return buf.getvalue()


def _multipart(field: str, filename: str, data: bytes, mime: str) -> tuple[bytes, str]:
    boundary = "----bootstrap-check-" + secrets.token_hex(8)
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def run_checks(base: str) -> int:
    results: list[tuple[str, bool, str]] = []

    # ۱) سلامت
    status, payload = _request(base, "GET", "/health")
    ok = status == 200 and payload.get("status") == "ok"
    results.append(("health: GET /health → ok", ok, f"HTTP {status} {payload}"))

    # ۲) ثبت‌نام + ورود کاربر تازه
    suffix = secrets.token_hex(5)
    email = f"bootstrap-check-{suffix}@example.com"
    credential = "Check-" + secrets.token_hex(6) + "9x"
    status, payload = _request(
        base, "POST", "/api/v1/auth/register",
        body=json.dumps({
            "full_name": "Bootstrap Check",
            "email": email,
            "password": credential,
            "accept_terms": True,
            "locale": "fa",
        }).encode(),
        headers={"Content-Type": "application/json"},
    )
    reg_ok = status == 201
    results.append((f"register: ساخت کاربر تازه ({email})", reg_ok,
                    f"HTTP {status} {payload if not reg_ok else ''}"))
    token = ""
    if reg_ok:
        status, payload = _request(
            base, "POST", "/api/v1/auth/login",
            body=json.dumps({"identifier": email, "password": credential}).encode(),
            headers={"Content-Type": "application/json"},
        )
        token = str(payload.get("access_token") or "")
        results.append(("login: ورود با همان کاربر", status == 200 and bool(token),
                        f"HTTP {status}"))

    # ۳) آپلود + اسکن آنتی‌ویروس از مسیر واقعی
    if token:
        body, ctype = _multipart("file", "check.wav", _tiny_wav(), "audio/wav")
        status, payload = _request(
            base, "POST", "/api/v1/voice/transcribe",
            body=body,
            headers={"Content-Type": ctype, "Authorization": f"Bearer {token}"},
        )
        code = str((payload.get("error") or {}).get("code") or "")
        if status == 200:
            results.append(("upload+scan: آپلود WAV اسکن و پذیرفته شد", True,
                            "HTTP 200"))
        elif status == 503 and code == "stt_unavailable":
            results.append((
                "upload+scan: اسکن آنتی‌ویروس پاس شد (STT اختیاری پیکربندی نیست)",
                True, "HTTP 503 stt_unavailable — بعد از اسکن موفق",
            ))
        else:
            results.append(("upload+scan: آپلود WAV از مسیر C-01", False,
                            f"HTTP {status} code={code} {payload}"))
    else:
        results.append(("upload+scan: آپلود WAV از مسیر C-01", False,
                        "توکن ورود نیست — چک قبل شکست خورد"))

    print("\nچک‌لیست سلامت بوت‌استرپ:")
    all_ok = True
    for name, ok, detail in results:
        all_ok = all_ok and ok
        mark = "✓" if ok else "✗"
        print(f"  [{mark}] {name}" + ("" if ok else f" — {detail}"))
    if all_ok:
        print("همهٔ چک‌های سلامت پاس شدند ✓")
        return 0
    print("یک یا چند چک سلامت شکست خورد — نصب کامل نیست.")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap health checklist")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    return run_checks(args.base_url)


if __name__ == "__main__":
    sys.exit(main())
