# MFA راهنما — احراز دوعاملی (TOTP)

> **خلاصهٔ فارسی:** احراز دوعاملی برای نقش‌های ممتاز (مدیر و مدیر ارشد)
> اجباری است. از CRM به **تنظیمات → امنیت و 2FA** (`settings/security`)
> بروید، کد QR را با اپ احراز هویت (Google Authenticator،‏ Microsoft
> Authenticator یا هر اپ TOTP) اسکن کنید، کد ۶رقمی را وارد کنید تا فعال
> شود. **کدهای بازیابی فقط یک بار نمایش داده می‌شوند** — همان لحظه آن‌ها
> را کپی/دانلود و در جای امن نگه دارید؛ هر کد فقط یک بار مصرف است.
> غیرفعال‌سازی و صدور مجدد کدها از همان صفحه و فقط با رمز عبور فعلی +
> یک عامل دوم انجام می‌شود. اگر هنوز فعال نکرده‌اید، ورودتان «محدود» است
> و به‌جز همین صفحهٔ امنیت هیچ بخشی از CRM/API برایتان باز نمی‌شود.
> راهنمای کامل انگلیسی در ادامه آمده است.

---

# MFA Guide — Two-Factor Authentication (TOTP)

Two-factor authentication is **mandatory for privileged roles** (admin /
super_admin) per the engineering contract §2. It is optional-but-available
for other accounts. Everything below describes the shipped v1.1.0
behavior (`apps/api/app/modules/auth/`, CRM page `settings/security`).

## 1. Enrollment (first-time setup)

1. Sign in to the CRM with your password. If your role requires 2FA and
   you have not enrolled, the login returns a **restricted session** and
   the CRM immediately routes you to **Settings → Security & 2FA**
   (`/settings/security`). No other page will load until enrollment is
   complete — this is by design, not an error.
2. On the Security page, choose **Start setup**. The server generates a
   TOTP secret **for display only** (it is not stored yet) and returns a
   provisioning URI.
3. Add it to your authenticator app, either way:
   - **Scan the QR code** shown on the page, or
   - **Type the secret manually** (shown next to the QR, with a copy
     button) into the app's "enter a setup key" option. Account name:
     your email; issuer: Maturidi Academy.
   - Any standard TOTP app works: Google Authenticator, Microsoft
     Authenticator, Authy, 1Password, Bitwarden Authenticator, etc.
     The codes are 6 digits and rotate every 30 seconds.
4. Enter the current 6-digit code from the app and confirm. The server
   verifies the code, stores the secret, and marks you enrolled.
5. **Recovery codes are shown now — once.** The page displays 10
   one-time recovery codes with **Copy all** and **Download (.txt)**
   buttons, and requires you to tick "I saved them" before you can
   finish. Store them somewhere safe and offline (password manager or
   printed copy). They are your only self-service way back in if you
   lose the authenticator app.
6. Finish — the CRM exchanges the restricted session for a full session
   and you can use the whole console.

From now on, every login asks for password **and** a current 6-digit
code (or a recovery code at the recovery path — §4).

## 2. Recovery codes — handling rules

- **10 codes**, shown in plain text exactly once (at enrollment and at
  each regeneration). The server stores **only hashes** — nobody,
  including an admin, can display your codes again.
- **Each code works exactly once.** Using a code consumes it; replays
  are rejected.
- Treat the list like a password: never share it, never store it in the
  same place as your password.
- The Security page always shows how many unused codes you have left
  (**Recovery codes remaining**). If the count gets low, regenerate (§3).
- Losing both the authenticator app **and** the recovery list means the
  self-service path is gone — see §5.

## 3. Disable and regenerate (signed-in, re-authentication required)

On **Settings → Security & 2FA**:

- **Regenerate recovery codes** — invalidates the entire old set
  atomically and issues a fresh set of 10 (shown once, same as
  enrollment). Use this if you may have exposed the list or the count is
  low.
- **Disable 2FA** — turns TOTP off for your account. If your role
  mandates 2FA, you will be put back into the restricted/enrollment flow
  on the spot; disabling is effectively "start over".

Both actions open a **re-authentication modal** and require:

1. your **current password**, *and*
2. a **second factor**: a current TOTP code **or** one unused recovery
   code.

Consequences you should know:

- Disabling revokes your **other sessions** (you stay signed in on the
  current one).
- These actions are rate-limited (§6) and written to the audit log.

## 4. Signing in, and the restricted session

- **Enrolled users:** password first, then the login asks for the
  6-digit code (`requires_2fa` challenge).
- **Not-yet-enrolled privileged users:** you receive a restricted
  `2fa_setup`-scope token. It can call **only** the enrollment endpoints
  (`/2fa/setup`, `/2fa/enable`, `/2fa/status`) and logout. Every other
  API route — profile, notifications, admin, even the WebSocket ticket —
  returns **403** until enrollment completes. The CRM mirrors this by
  routing you to the Security page and blocking all other routes.
- The server also re-checks enrollment against the *current* database
  state on privileged requests: if your role is promoted, or 2FA is
  disabled, an old full-scope token does not keep privileged access.

## 5. Admin recovery path (lost authenticator)

1. **With a recovery code:** on the login screen use the recovery
   option ("lost my authenticator") — `POST /auth/2fa/recover` with
   your email + one unused recovery code. This **disables 2FA
   entirely** and **revokes all of your sessions/tokens**; sign in
   again with your password and re-enroll immediately (§1) so a fresh
   code set is issued.
2. **Without any recovery code:** there is no self-service or
   in-product admin reset — by design, another admin cannot switch off
   your 2FA from the CRM. Recovery then requires a server operator with
   database access to clear the account's TOTP fields, after identity
   verification out-of-band. Treat this as a last resort and re-enroll
   immediately afterwards.

## 6. Rate limits (server-enforced, fail-closed)

| Action | Limit |
|---|---|
| Enable 2FA (code attempts) | 20 per 600 s, per user |
| Disable 2FA | 10 per 600 s, per user |
| Regenerate recovery codes | 10 per 600 s, per user |
| Recovery (`/2fa/recover`) | 10 per 3600 s, per IP |

Exceeding a limit returns **429 `rate_limited`**; wait for the window to
pass instead of retrying in a loop.

## 7. Status check

`GET /auth/2fa/status` (and the Security page header) shows whether 2FA
is enabled, when it was enrolled, and how many recovery codes remain.
