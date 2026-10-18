# Desktop — Tauri

اسکلت فاز ۲. تکمیل در فاز ۱۳.

## پیش‌نیاز
- Rust toolchain (`rust-toolchain.toml` در ریشه — پین‌شده طبق فاز ۱)
- Node.js (`.nvmrc`)

```bash
npm create tauri-app@latest -- --template react-ts  # اسکفلد رسمی، یک‌بار
npm run tauri dev
```

## نکات
- بیلد روی runner مخصوص هر OS انجام می‌شود (`.github/workflows/desktop.yml`)
- به‌روزرسانی خودکار از updater داخلی Tauri (کلید pubkey را در `tauri.conf.json` بگذارید)
- امضای کد ویندوز/مک را شما تهیه می‌کنید (فاز ۲)
