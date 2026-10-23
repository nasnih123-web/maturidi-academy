"""نگهبان استاتیک کانفیگ Tauri 2 — FIX3-01.

باگ (اثبات زنده: ران Desktop builds #5 مالک، 2026-10-24): پروژه
Tauri 2 است (@tauri-apps/cli ^2.2.0) ولی در tauri.conf.json یک بلوک
top-level به نام `updater` با کلیدهای سبک v1 (active/dialog/…) نشسته
بود؛ اسکیمای v2 کل فایل را رد می‌کند («Additional properties are not
allowed ('updater' was unexpected)») و بیلد هر سه سیستم‌عامل در چند
ثانیه می‌مرد — پیش از هر کامپایلی.

این تست‌ها همان قرارداد را قفل می‌کنند تا رگرسیون بی‌صدا برنگردد:
- فایل parse می‌شود (JSONC — کامنت‌های // با احترام به رشته‌ها).
- هیچ کلید top-level خارج از مجموعهٔ مجاز Tauri 2 نیست (به‌ویژه
  `updater` و بخش `tauri` سبک v1).
- plugins فقط پلاگین‌های واقعی v2؛ و اگر plugins.updater روزی اضافه
  شد، فقط کلیدهای v2 (endpoints/pubkey/windows) — active/dialog
  سبک v1 ممنوع.

اجرای واقعی بیلد سه‌سیستم‌عامل روی رانرهای گیت‌هاب است (job
verify-unsigned در desktop.yml روی PRهای apps/desktop/**)؛ این‌جا
فقط گارد استاتیک است و ادعای بیلد نمی‌کند.
"""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CONF = REPO / "apps" / "desktop" / "src-tauri" / "tauri.conf.json"

# کلیدهای top-level مجاز در اسکیمای Tauri 2 (schema.tauri.app/config/2)
TAURI2_TOP_LEVEL_KEYS = {
    "$schema",
    "productName",
    "version",
    "identifier",
    "build",
    "app",
    "bundle",
    "plugins",
}

# نام پلاگین‌های رسمی Tauri 2 که زیر plugins پیکربندی می‌شوند
TAURI2_PLUGIN_KEYS = {
    "app",
    "autostart",
    "barcode-scanner",
    "biometric",
    "cli",
    "clipboard-manager",
    "deep-link",
    "dialog",
    "fs",
    "geolocation",
    "global-shortcut",
    "haptics",
    "http",
    "log",
    "nfc",
    "notification",
    "opener",
    "os",
    "persisted-scope",
    "positioner",
    "process",
    "shell",
    "single-instance",
    "sql",
    "store",
    "stronghold",
    "updater",
    "upload",
    "websocket",
    "window-state",
}

# کلیدهای plugins.updater در Tauri 2 — active/dialog سبک v1‌اند
TAURI2_UPDATER_KEYS = {"endpoints", "pubkey", "windows"}
V1_ONLY_UPDATER_KEYS = {"active", "dialog"}


def _strip_jsonc_comments(text: str) -> str:
    """حذف کامنت‌های // و /* */ با احترام به رشته‌ها و escapeها.

    رشته‌های کانفیگ (مثل CSP و devUrl) خودشان // دارند؛ حذف سادهٔ
    متنی آن‌ها را خراب می‌کند، پس ماشین حالت لازم است.
    """
    out: list[str] = []
    i, n = 0, len(text)
    in_str = False
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _load_conf() -> dict:
    return json.loads(_strip_jsonc_comments(CONF.read_text(encoding="utf-8")))


def test_tauri_conf_parses_as_jsonc() -> None:
    cfg = _load_conf()
    assert isinstance(cfg, dict) and cfg


def test_tauri_conf_declares_v2_schema() -> None:
    cfg = _load_conf()
    assert str(cfg.get("$schema", "")).rstrip("/").endswith("/config/2")


def test_tauri_conf_no_top_level_updater() -> None:
    cfg = _load_conf()
    assert "updater" not in cfg, (
        "بلوک top-level «updater» سبک Tauri v1 است؛ اسکیمای v2 کل "
        "کانفیگ را رد می‌کند (FIX3-01). آپدیتر فقط زیر plugins.updater "
        "و با endpoint/pubkey واقعی مجاز است (ADR-0031)."
    )


def test_tauri_conf_top_level_keys_are_v2_only() -> None:
    cfg = _load_conf()
    extra = set(cfg) - TAURI2_TOP_LEVEL_KEYS
    assert not extra, f"کلیدهای top-level غیرمجاز در Tauri 2: {sorted(extra)}"
    # تله‌های مشخص سبک v1: بخش top-level «tauri» و نام‌های قدیمی
    assert "tauri" not in cfg
    assert "systemTray" not in (cfg.get("app") or {})
    build = cfg.get("build") or {}
    assert "devPath" not in build and "distDir" not in build


def test_tauri_conf_plugins_are_real_v2_plugins() -> None:
    cfg = _load_conf()
    plugins = cfg.get("plugins") or {}
    assert isinstance(plugins, dict)
    unknown = set(plugins) - TAURI2_PLUGIN_KEYS
    assert not unknown, f"پلاگین ناشناخته در Tauri 2: {sorted(unknown)}"


def test_tauri_conf_tray_icon_uses_v2_key() -> None:
    """رگرسیون FIX3-01b: در Tauri 2 فیلد app.trayIcon «iconPath» است نه
    «icon» (TrayIconConfig: required iconPath, additionalProperties
    false). همین خطای اسکیما سه جاب verify-unsigned ران #8 را در گام
    build در کمتر از ۱ ثانیه قرمز کرد — پس از حذف updater، دومین
    تلهٔ v1 بود که گارد ساختاری (فقط top-level) از دست داد.
    """
    tray = (_load_conf().get("app") or {}).get("trayIcon")
    if tray is None:
        return
    assert isinstance(tray, dict)
    assert "icon" not in tray, "در Tauri 2 کلید app.trayIcon باید iconPath باشد نه icon"
    assert tray.get("iconPath"), "app.trayIcon.iconPath الزامی است (Tauri 2)"


def test_tauri_conf_validates_against_official_v2_schema() -> None:
    """قفل نهایی FIX3-01: اعتبارسنجی کامل کانفیگ با اسکیمای رسمی Tauri 2.

    اسکیما در apps/api/tests/fixtures/tauri-config-schema-v2.json
    پین شده (منبع: https://schema.tauri.app/config/2 ، نسخهٔ $id همان
    فایل) تا هر نقض آیندهٔ اسکیما — نه فقط top-levelها — در CI گرفته
    شود، نه روی رانر.
    """
    import jsonschema

    cfg = _load_conf()
    schema = json.loads(
        (Path(__file__).resolve().parent / "fixtures" / "tauri-config-schema-v2.json")
        .read_text(encoding="utf-8")
    )
    errors = sorted(
        jsonschema.Draft7Validator(schema).iter_errors(cfg),
        key=lambda e: list(e.path),
    )
    assert not errors, "\n".join(
        f"{'/'.join(map(str, e.path))}: {e.message[:160]}" for e in errors[:6]
    )


def test_tauri_conf_updater_plugin_if_present_uses_v2_keys() -> None:
    cfg = _load_conf()
    updater = (cfg.get("plugins") or {}).get("updater")
    if updater is None:
        return  # وضعیت فعلیِ درست: آپدیتر غایب = غیرفعال (ADR-0031)
    assert isinstance(updater, dict)
    keys = set(updater)
    assert not (keys & V1_ONLY_UPDATER_KEYS), (
        "active/dialog کلیدهای سبک v1 هستند؛ در plugins.updater Tauri 2 "
        "مجاز نیستند"
    )
    extra = keys - TAURI2_UPDATER_KEYS
    assert not extra, f"کلید ناشناخته در plugins.updater: {sorted(extra)}"
