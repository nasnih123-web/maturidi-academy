"""تست‌های Track 3 — remediation pass 2 (§۱۸/§۲۳): شکاف‌های export حریم خصوصی + IDOR.

- export باید شامل نشست‌های فتوا/پیام‌ها، یادداشت‌های قرآن و اهداهای خودِ
  کاربر باشد (شکاف‌های GAP-P17-GDPR-1/2/3) — با اسکوپ مالک.
- تست‌های منفی cross-user: کاربر B نباید به دادهٔ A برسد (export، یادداشت
  قرآن، رسید اهدا، ثبت آزمون).
- استاندارد تست (§۲۱): بدون موک — دادهٔ واقعی در DB، مسیر واقعی export.
"""
from __future__ import annotations

import uuid

BASE = "/api/v1"


async def _reset_limits() -> None:
    # Track 3 (pass 2): احراز هویت از rate_limiter قدیمی (app.core.security)
    # به DistributedRateLimiter (app.core.rate_limit — فایل Track 1، §۷) منتقل
    # شده؛ هر دو ریست می‌شوند تا تست‌ها زیر سقف ۱۰ ثبت/ساعت نمانند.
    from app.core.rate_limit import get_rate_limiter
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")
    rl = get_rate_limiter()
    await rl.reset("register:127.0.0.1")
    await rl.reset("login:127.0.0.1")


async def _register(client, email: str, full_name: str = "کاربر ترک۳") -> dict:
    await _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": full_name,
            "email": email,
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, email: str) -> str:
    await _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "TestPass123"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _new_user(tc, tag: str):
    client = tc["client"]
    suffix = uuid.uuid4().hex[:8]
    email = f"t3-{tag}-{suffix}@example.com"
    me = await _register(client, email)
    token = await _login(client, email)
    return me, {"Authorization": f"Bearer {token}"}


async def _seed_fatwa_question(tc, headers, text: str) -> None:
    from app.modules.fatwa.service import reset_ai_limits

    reset_ai_limits()
    r = await tc["client"].post(
        f"{BASE}/fatwa/ask",
        json={"question": text, "locale": "fa", "top_k": 3},
        headers=headers,
    )
    assert r.status_code == 200, r.text


async def _seed_quran_note(tc, headers, text: str) -> str:
    r = await tc["client"].post(
        f"{BASE}/quran/notes",
        json={"surah": 2, "ayah": 152, "note_text": text, "is_private": True},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _seed_donation(tc, user_id: uuid.UUID, donor_name: str = "اهداکننده ترک۳") -> str:
    """اهدای واقعی در DB (نیت + اهدا) — مسیر export واقعی تست می‌شود."""
    from app.models.models import Donation, PaymentIntent

    async with tc["maker"]() as db:
        intent = PaymentIntent(
            idempotency_key=f"t3-{uuid.uuid4().hex}",
            amount=500_000,
            currency="IRR",
            donor_id=user_id,
            donor_name=donor_name,
            status="succeeded",
            gateway="zarinpal",
            authority=f"AUTH-T3-{uuid.uuid4().hex[:8]}",
        )
        db.add(intent)
        await db.flush()
        donation = Donation(
            donor_id=user_id,
            payment_intent_id=intent.id,
            gateway="zarinpal",
            gateway_reference=f"REF-T3-{uuid.uuid4().hex[:8]}",
            status="succeeded",
            amount=500_000,
            currency="IRR",
            donor_name=donor_name,
        )
        db.add(donation)
        await db.commit()
        return str(donation.id)


# --- §۱۸: export شامل سه ماژول جاافتاده ----------------------------------------


async def test_export_includes_fatwa_sessions_and_messages(tc):
    me, headers = await _new_user(tc, "fatwa")
    q = f"پرسش فتوای ترک۳ {uuid.uuid4().hex[:6]}"
    await _seed_fatwa_question(tc, headers, q)

    r = await tc["client"].post(f"{BASE}/users/me/export", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()

    assert "fatwa_sessions" in data and len(data["fatwa_sessions"]) >= 1
    texts = [
        (m.get("content") or "")
        for s in data["fatwa_sessions"]
        for m in s.get("messages", [])
    ]
    assert any(q in t for t in texts)


async def test_export_includes_quran_notes(tc):
    me, headers = await _new_user(tc, "quran")
    note_text = f"یادداشت قرآنی ترک۳ {uuid.uuid4().hex[:6]}"
    await _seed_quran_note(tc, headers, note_text)

    r = await tc["client"].post(f"{BASE}/users/me/export", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()

    assert "quran_notes" in data
    assert any(note_text in (n.get("note_text") or "") for n in data["quran_notes"])


async def test_export_includes_donations(tc):
    me, headers = await _new_user(tc, "donate")
    donation_id = await _seed_donation(tc, uuid.UUID(me["id"]))

    r = await tc["client"].post(f"{BASE}/users/me/export", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()

    assert "donations" in data
    mine = [d for d in data["donations"] if d["id"] == donation_id]
    assert len(mine) == 1
    assert mine[0]["amount"] == 500_000
    assert mine[0]["status"] == "succeeded"


# --- §۲۳: اسکوپ مالک در export (IDOR) ------------------------------------------


async def test_export_does_not_leak_other_users_data(tc):
    me_a, h_a = await _new_user(tc, "ownerA")
    me_b, h_b = await _new_user(tc, "ownerB")

    q_a = f"پرسش محرمانه A {uuid.uuid4().hex[:6]}"
    note_a = f"یادداشت محرمانه A {uuid.uuid4().hex[:6]}"
    await _seed_fatwa_question(tc, h_a, q_a)
    await _seed_quran_note(tc, h_a, note_a)
    donation_a = await _seed_donation(tc, uuid.UUID(me_a["id"]), donor_name="محرمانه A")

    r = await tc["client"].post(f"{BASE}/users/me/export", headers=h_b)
    assert r.status_code == 200, r.text
    blob = r.text

    assert q_a not in blob
    assert note_a not in blob
    assert donation_a not in blob
    assert "محرمانه A" not in blob


async def test_export_unauthenticated_is_401(tc):
    r = await tc["client"].post(f"{BASE}/users/me/export")
    assert r.status_code == 401, r.text


# --- §۲۳: IDOR روی endpointهای تک‌شی -------------------------------------------


async def test_quran_note_cross_user_update_delete_404(tc):
    me_a, h_a = await _new_user(tc, "noteA")
    _, h_b = await _new_user(tc, "noteB")
    note_id = await _seed_quran_note(tc, h_a, f"یادداشت A {uuid.uuid4().hex[:6]}")

    client = tc["client"]
    r = await client.put(
        f"{BASE}/quran/notes/{note_id}",
        json={"note_text": "دست‌کاری B"},
        headers=h_b,
    )
    assert r.status_code == 404, r.text
    r = await client.delete(f"{BASE}/quran/notes/{note_id}", headers=h_b)
    assert r.status_code == 404, r.text
    # خودِ مالک هنوز می‌تواند بخواند/حذف کند
    r = await client.delete(f"{BASE}/quran/notes/{note_id}", headers=h_a)
    assert r.status_code == 204, r.text


async def test_receipt_cross_user_forbidden(tc):
    me_a, h_a = await _new_user(tc, "rcptA")
    _, h_b = await _new_user(tc, "rcptB")
    donation_id = await _seed_donation(tc, uuid.UUID(me_a["id"]))

    client = tc["client"]
    r = await client.get(f"{BASE}/finance/receipts/{donation_id}", headers=h_b)
    assert r.status_code == 403, r.text
    r = await client.get(f"{BASE}/finance/receipts/{donation_id}")
    assert r.status_code == 401, r.text
    # مالک می‌تواند رسیدش را بگیرد
    r = await client.get(f"{BASE}/finance/receipts/{donation_id}", headers=h_a)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"


async def test_quiz_submit_cross_user_attempt_403(tc):
    from app.models.models import QuizAttempt

    me_a, h_a = await _new_user(tc, "quizA")
    _, h_b = await _new_user(tc, "quizB")

    async with tc["maker"]() as db:
        attempt = QuizAttempt(
            user_id=uuid.UUID(me_a["id"]),
            question_ids=[],
            answers={},
        )
        db.add(attempt)
        await db.commit()
        attempt_id = str(attempt.id)

    client = tc["client"]
    r = await client.post(
        f"{BASE}/fatwa/quiz/submit",
        json={"attempt_id": attempt_id, "answers": {}},
        headers=h_b,
    )
    assert r.status_code == 403, r.text
