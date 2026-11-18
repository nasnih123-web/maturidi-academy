"""قالب‌های ایمیل برنددار احراز هویت + انتخاب زبان بر اساس کشور.

ایمیل‌های تأیید ایمیل و بازنشانی رمز از این ماژول ساخته می‌شوند: یک
پوستهٔ HTML امنِ ایمیل (جدول + CSS درون‌خطی) با هویت بصری آکادمی
(سبز عمیق ‎#07231c‎ و طلایی ‎#d4af37‎ — همان پالت وب) + نسخهٔ متن ساده.

زبان ایمیل از کشور کاربر می‌آید، نه از حدس: ایران → فارسی، کشورهای
عربی → عربی، بقیه → انگلیسی. کشور از شمارهٔ تلفن (با
`country_iso_from_phone`) خوانده می‌شود؛ اگر شماره‌ای نباشد، زبانِ
ذخیره‌شدهٔ ثبت‌نام (وقتی fa/ar/en باشد) و وگرنه انگلیسی.

انیمیشن فقط بهبود پیش‌رونده است (Apple Mail/iOS): پوسته بدون هیچ
انیمیشنی هم کامل و شکیل است؛ هیچ جاوااسکریپت و CSS خارجی‌ای نیست.
"""
from __future__ import annotations

import html as html_mod
from dataclasses import dataclass

from app.core.countries import country_iso_from_phone

EMAIL_LOCALES: tuple[str, ...] = ("fa", "ar", "en")

# کشورهای عربی‌زبان (ISO 3166-1 alpha-2) — ایمیل عربی می‌گیرند.
ARAB_COUNTRIES: frozenset[str] = frozenset(
    {
        "SA", "AE", "QA", "KW", "OM", "BH", "IQ", "EG", "JO", "LB",
        "SY", "PS", "YE", "MA", "DZ", "TN", "LY", "SD", "MR", "DJ",
        "SO", "KM",
    }
)

_RTL_LOCALES = frozenset({"fa", "ar"})
_FONT_STACK = "'Segoe UI', Tahoma, Arial, sans-serif"

# پالت برند آکادمی — آینهٔ apps/web (globals.css: ‎--q-brand-deep‎،
# ‎--q-gold‎ و دکمهٔ ‎.auth-btn-solid‎ با گرادیان ‎#b8912c → #d4af37‎).
_DEEP_GREEN = "#07231c"
_DEEP_GREEN_2 = "#0d3b2c"
_GOLD = "#d4af37"
_GOLD_DEEP = "#b8912c"
_GOLD_SOFT = "#e5c07b"
_IVORY = "#ede6d6"
_ON_GOLD = "#06120e"
_PAGE_BG = "#f4efe3"
_CARD_BORDER = "#e9e1cb"
_INK = "#454037"
_MUTED = "#7c7666"


def resolve_email_locale(phone: str | None, stored_locale: str | None) -> str:
    """زبان ایمیل کاربر بر اساس کشورش: IR→fa، عربی→ar، بقیه→en.

    اول کشورِ شمارهٔ تلفن؛ بدون شماره، زبان ذخیره‌شدهٔ ثبت‌نام وقتی
    یکی از fa/ar/en باشد؛ در غیر این صورت انگلیسی.
    """
    iso = country_iso_from_phone(phone)
    if iso is not None:
        if iso == "IR":
            return "fa"
        if iso in ARAB_COUNTRIES:
            return "ar"
        return "en"
    loc = (stored_locale or "").strip().lower()
    return loc if loc in EMAIL_LOCALES else "en"


@dataclass(frozen=True)
class RenderedEmail:
    """خروجی رندر یک ایمیل: موضوع + متن ساده + HTML."""

    subject: str
    text: str
    html: str


@dataclass(frozen=True)
class _Copy:
    subject: str
    academy: str
    title: str
    greeting: str
    greeting_named: str
    body: str
    cta: str
    expiry: str
    fallback: str
    ignore: str


_VERIFY_COPY: dict[str, _Copy] = {
    "fa": _Copy(
        subject="تأیید ایمیل — آکادمی ماتریدی",
        academy="آکادمی ماتریدی",
        title="تأیید ایمیل",
        greeting="سلام،",
        greeting_named="سلام {name}،",
        body=(
            "برای تکمیل ثبت‌نام‌تان در آکادمی ماتریدی و فعال‌شدن حسابتان، "
            "لطفاً ایمیل‌تان را تأیید کنید."
        ),
        cta="تأیید ایمیل",
        expiry="این لینک ۲۴ ساعت اعتبار دارد.",
        fallback="اگر دکمه کار نکرد، این لینک را کپی کنید و در مرورگر باز کنید:",
        ignore="اگر این درخواست را شما نداده‌اید، این ایمیل را نادیده بگیرید.",
    ),
    "ar": _Copy(
        subject="تأكيد البريد الإلكتروني — أكاديمية ماتريدي",
        academy="أكاديمية ماتريدي",
        title="تأكيد البريد الإلكتروني",
        greeting="مرحباً،",
        greeting_named="مرحباً {name}،",
        body=(
            "لإكمال تسجيلك في أكاديمية ماتريدي وتفعيل حسابك، يُرجى تأكيد "
            "بريدك الإلكتروني بالضغط على الزر أدناه."
        ),
        cta="تأكيد البريد الإلكتروني",
        expiry="هذا الرابط صالح لمدة 24 ساعة.",
        fallback="إذا لم يعمل الزر، انسخ هذا الرابط وافتحه في متصفحك:",
        ignore="إذا لم تطلب هذا، يمكنك تجاهل هذه الرسالة بأمان.",
    ),
    "en": _Copy(
        subject="Verify your email — Maturidi Academy",
        academy="Maturidi Academy",
        title="Verify your email",
        greeting="Hello,",
        greeting_named="Hello {name},",
        body=(
            "To finish creating your Maturidi Academy account and activate "
            "it, please verify your email address by clicking the button below."
        ),
        cta="Verify email",
        expiry="This link is valid for 24 hours.",
        fallback="If the button doesn't work, copy this link and open it in your browser:",
        ignore="If you didn't request this, you can safely ignore this email.",
    ),
}

_RESET_COPY: dict[str, _Copy] = {
    "fa": _Copy(
        subject="بازنشانی رمز عبور — آکادمی ماتریدی",
        academy="آکادمی ماتریدی",
        title="بازنشانی رمز عبور",
        greeting="سلام،",
        greeting_named="سلام {name}،",
        body=(
            "برای حساب شما در آکادمی ماتریدی درخواست بازنشانی رمز عبور ثبت "
            "شده است. برای انتخاب رمز تازه، روی دکمه زیر کلیک کنید."
        ),
        cta="بازنشانی رمز عبور",
        expiry="این لینک یک ساعت اعتبار دارد.",
        fallback="اگر دکمه کار نکرد، این لینک را کپی کنید و در مرورگر باز کنید:",
        ignore=(
            "اگر این درخواست را شما نداده‌اید، این ایمیل را نادیده بگیرید؛ "
            "رمز عبورتان بدون تغییر می‌ماند."
        ),
    ),
    "ar": _Copy(
        subject="إعادة تعيين كلمة المرور — أكاديمية ماتريدي",
        academy="أكاديمية ماتريدي",
        title="إعادة تعيين كلمة المرور",
        greeting="مرحباً،",
        greeting_named="مرحباً {name}،",
        body=(
            "تم استلام طلب لإعادة تعيين كلمة مرور حسابك في أكاديمية "
            "ماتريدي. لاختيار كلمة مرور جديدة، انقر الزر أدناه."
        ),
        cta="إعادة تعيين كلمة المرور",
        expiry="هذا الرابط صالح لمدة ساعة واحدة.",
        fallback="إذا لم يعمل الزر، انسخ هذا الرابط وافتحه في متصفحك:",
        ignore="إذا لم تطلب هذا، تجاهل هذه الرسالة وستبقى كلمة مرورك دون تغيير.",
    ),
    "en": _Copy(
        subject="Reset your password — Maturidi Academy",
        academy="Maturidi Academy",
        title="Reset password",
        greeting="Hello,",
        greeting_named="Hello {name},",
        body=(
            "We received a request to reset the password for your Maturidi "
            "Academy account. Click the button below to choose a new password."
        ),
        cta="Reset password",
        expiry="This link is valid for 1 hour.",
        fallback="If the button doesn't work, copy this link and open it in your browser:",
        ignore="If you didn't request this, ignore this email — your password will stay unchanged.",
    ),
}


def _clean_name(name: str | None) -> str:
    """نام نمایشی را برای سلامِ ایمیل تک‌خطی و کوتاه می‌کند."""
    if not name:
        return ""
    return " ".join(name.split())[:80]


def _greeting(copy: _Copy, name: str | None) -> str:
    clean = _clean_name(name)
    if not clean:
        return copy.greeting
    return copy.greeting_named.format(name=clean)


_STYLE_BLOCK = """
<style>
  @keyframes ma-rise {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .ma-card { animation: ma-rise 0.6s ease-out; }
  .ma-btn-link:hover { filter: brightness(1.08); }
  @media (prefers-reduced-motion: reduce) {
    .ma-card { animation: none; }
  }
  @media only screen and (max-width: 620px) {
    .ma-wrap { width: 100% !important; }
    .ma-pad { padding: 26px 20px !important; }
    .ma-title { font-size: 20px !important; }
  }
</style>
"""


def _render_html(
    copy: _Copy,
    *,
    locale: str,
    greeting: str,
    action_url: str,
    logo_url: str | None,
) -> str:
    rtl = locale in _RTL_LOCALES
    direction = "rtl" if rtl else "ltr"
    align = "right" if rtl else "left"
    url_esc = html_mod.escape(action_url, quote=True)
    logo_html = ""
    if logo_url:
        logo_html = (
            f'<img src="{html_mod.escape(logo_url, quote=True)}" '
            f'alt="{html_mod.escape(copy.academy, quote=True)}" height="54" '
            'style="display:block;margin:0 auto 10px;border:0;height:54px;width:auto;">'
        )
    return f"""<!DOCTYPE html>
<html lang="{locale}" dir="{direction}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>{html_mod.escape(copy.title)}</title>
{_STYLE_BLOCK}</head>
<body style="margin:0;padding:0;background-color:{_PAGE_BG};font-family:{_FONT_STACK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{html_mod.escape(copy.body)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{_PAGE_BG};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="ma-wrap ma-card" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
<tr><td align="center" bgcolor="{_DEEP_GREEN}" style="background-color:{_DEEP_GREEN};background:linear-gradient(135deg,{_DEEP_GREEN},{_DEEP_GREEN_2});border-radius:14px 14px 0 0;border-bottom:3px solid {_GOLD};padding:26px 32px;">
{logo_html}
<div style="font-size:22px;font-weight:800;color:{_GOLD_SOFT};font-family:{_FONT_STACK};">{html_mod.escape(copy.academy)}</div>
</td></tr>
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid {_CARD_BORDER};border-top:none;border-radius:0 0 14px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td class="ma-pad" align="{align}" style="padding:34px 38px;text-align:{align};">
<h1 class="ma-title" style="margin:0 0 14px;font-size:23px;line-height:1.5;color:{_DEEP_GREEN};font-family:{_FONT_STACK};">{html_mod.escape(copy.title)}</h1>
<p style="margin:0 0 10px;font-size:15px;line-height:1.9;color:{_INK};font-family:{_FONT_STACK};">{html_mod.escape(greeting)}</p>
<p style="margin:0 0 26px;font-size:15px;line-height:1.9;color:{_INK};font-family:{_FONT_STACK};">{html_mod.escape(copy.body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 24px;">
<tr><td align="center" bgcolor="{_GOLD}" style="border-radius:999px;background:linear-gradient(135deg,{_GOLD_DEEP},{_GOLD});">
<a class="ma-btn-link" href="{url_esc}" target="_blank" style="display:inline-block;padding:14px 42px;font-size:16px;font-weight:800;color:{_ON_GOLD};text-decoration:none;border-radius:999px;font-family:{_FONT_STACK};">{html_mod.escape(copy.cta)}</a>
</td></tr>
</table>
<p style="margin:0 0 22px;text-align:center;font-size:13px;line-height:1.8;color:{_MUTED};font-family:{_FONT_STACK};">{html_mod.escape(copy.expiry)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid {_CARD_BORDER};padding-top:18px;">
<p style="margin:0 0 6px;font-size:12.5px;line-height:1.8;color:{_MUTED};font-family:{_FONT_STACK};">{html_mod.escape(copy.fallback)}</p>
<p style="margin:0;font-size:12.5px;line-height:1.8;word-break:break-all;font-family:{_FONT_STACK};"><a href="{url_esc}" target="_blank" style="color:#8a6d1f;">{url_esc}</a></p>
</td></tr></table>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:20px 24px 4px;">
<p style="margin:0;font-size:12px;line-height:1.9;color:#8b8574;font-family:{_FONT_STACK};">{html_mod.escape(copy.ignore)}</p>
<p style="margin:8px 0 0;font-size:12px;color:#8b8574;font-family:{_FONT_STACK};">{html_mod.escape(copy.academy)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def _render(
    copy: _Copy,
    *,
    locale: str,
    action_url: str,
    logo_url: str | None,
    name: str | None,
    marker: str,
    token: str,
) -> RenderedEmail:
    greeting = _greeting(copy, name)
    text = "\n".join(
        [
            greeting,
            copy.body,
            action_url,
            copy.expiry,
            copy.ignore,
            f"{marker}={token}",
        ]
    )
    return RenderedEmail(
        subject=copy.subject,
        text=text,
        html=_render_html(
            copy,
            locale=locale,
            greeting=greeting,
            action_url=action_url,
            logo_url=logo_url,
        ),
    )


def render_verification_email(
    *,
    locale: str,
    action_url: str,
    token: str,
    logo_url: str | None = None,
    name: str | None = None,
) -> RenderedEmail:
    """ایمیل تأیید ایمیل — لینک ۲۴ ساعته (EMAIL_VERIFY_EXPIRE_HOURS)."""
    copy = _VERIFY_COPY.get(locale) or _VERIFY_COPY["en"]
    return _render(
        copy,
        locale=locale if locale in _VERIFY_COPY else "en",
        action_url=action_url,
        logo_url=logo_url,
        name=name,
        marker="verify_token",
        token=token,
    )


def render_password_reset_email(
    *,
    locale: str,
    action_url: str,
    token: str,
    logo_url: str | None = None,
    name: str | None = None,
) -> RenderedEmail:
    """ایمیل بازنشانی رمز — لینک یک‌ساعته (RESET_TOKEN_EXPIRE_HOURS)."""
    copy = _RESET_COPY.get(locale) or _RESET_COPY["en"]
    return _render(
        copy,
        locale=locale if locale in _RESET_COPY else "en",
        action_url=action_url,
        logo_url=logo_url,
        name=name,
        marker="reset_token",
        token=token,
    )
