# فاز ۹ — دسکتاپ Tauri (برابری حفاظ با ترتیل)

- **مبنا:** شاخهٔ `feature/hifz-tarteel-parity`، مرج main `47a50261` (PR #114)
- **تاریخ:** ۲۰۲۶-۱۱-۰۷
- **محدوده:** فقط `apps/desktop` تغییر کرده است؛ هیچ مرج/دیپلویی انجام نشده؛ کامیت با هماهنگ‌کننده است.
- **مرجع‌ها:** `hifz-architecture.md`، `hifz-risk-register.md` (به‌ویژه R-15)، `hifz-phase0-baseline.md`

---

## ۱. ممیزی ساختار فعلی Tauri (پیش از تغییر)

### ۱٫۱ WebView چه چیزی را باز می‌کند؟

دسکتاپ **فقط پوستهٔ وب است** (تأیید R-15) — هیچ asset وبِ کاملی bundle نمی‌شود:

| حالت | چه باز می‌شود | مرجع |
|---|---|---|
| dev (`tauri dev`) | `http://localhost:3000` | `src-tauri/tauri.conf.json` → `build.devUrl` |
| production | صفحهٔ محلی کوچک `shell/` (`frontendDist: ../shell`) که با `location.replace` به `MATURIDI_WEB_URL` می‌رود | `shell/shell.js`، `shell/config.js` |

`shell/` فقط چهار فایل دارد: `index.html`، `shell.js`، `config.js`، `icon.png`. هیچ فونت، هیچ متن قرآن، هیچ کد محصولی در باندل دسکتاپ نیست. `MATURIDI_WEB_URL` در مخزن **خالی** است (`window.MATURIDI_WEB_URL = "";`) و فقط در زمان packaging مقدار واقعی می‌گیرد؛ بدون آن، پوسته صفحهٔ صادقانهٔ «تنظیم نشده» را نشان می‌دهد و هیچ نشانی‌ای را حدس نمی‌زند. آفلاین‌بودن دسکتاپ ممکن نیست: بدون اینترنت و بدون وب‌اپ production، فقط صفحهٔ وضعیت داخلی دیده می‌شود.

### ۱٫۲ پیکربندی Tauri (`src-tauri/tauri.conf.json`)

- پنجرهٔ اصلی: `1280×800`، حداقل `960×600`، قابل‌تغییراندازه، `decorations: true`، برچسب `main`، عنوان «Maturidi Academy».
- باندل: `targets: all` (linux/macOS/windows)؛ macOS بدون signingIdentity، ویندوز بدون certificate — نصب‌کننده‌ها امضانشده‌اند (طبق CI).
- پلاگین: فقط `notification`. هیچ بلوک updaterای نیست (تصمیم ADR-0031؛ updater فقط با `plugins.updater` واقعی فعال می‌شود).
- CSP (`app.security.csp`): `connect-src 'self' http://localhost:* https://localhost:*` — **فقط روی صفحه‌های محلی (پروتکل `tauri://`) اعمال می‌شود**؛ بررسی سورس `tauri 2.12.5` (`protocol/tauri.rs`، `manager/webview.rs`) نشان داد CSP پیکربندی‌شده به ناوبری‌های remote (https) تزریق نمی‌شود. پس CSP فعلی نه جلوی fetch/WebSocket وب‌اپ production را می‌گیرد و نه نیازی به تغییر داشت — بدون تغییر رها شد.
- Tray: آیکون + منوی Open / Sync now / Quit (پیش از فاز ۹).

### ۱٫۳ اتصال به API

دسکتاپ هیچ اتصال مستقیمی به API ندارد: همهٔ فراخوانی‌های API/WebSocket را وب‌اپِ داخل WebView انجام می‌دهد (همان قراردادهای وب: REST + WebSocket با بلیط یک‌بارمصرف). پوسته فقط میزبان است.

### ۱٫۴ یافتهٔ بحرانی فاز ۹ (F-01): وبِ remote هیچ دسترسی IPC ندارد

بررسی سورس `tauri 2.12.5` (`ipc/capability_builder.rs`، `ipc/authority.rs`، `tauri-utils/.../acl/capability.rs`) + تست تجربی (بخش ۴) نشان داد:

- در Tauri 2، دسترسی یک صفحهٔ remote به کامندها/ایونت‌ها فقط از طریق capabilityای با بخش `remote: { urls: [...] }` داده می‌شود.
- `capabilities/default.json` فعلی فقط `"windows": ["main"]` دارد و هیچ `remote`ای ندارد.
- **نتیجه: وب‌اپ production (origin خارجی) هیچ Tauri IPCای ندارد** — نه کامندهای جدید `hifz_*`، نه ایونت `hifz-close-blocked`، و نه حتی ایونت قدیمی `sync-now` که `TauriBridge` (mountشده در `apps/web/app/[locale]/layout.tsx:217`) به آن گوش می‌دهد. یعنی دکمهٔ «Sync now» در دسکتاپِ production امروز بی‌صدا هیچ کاری نمی‌کند.

این باگِ «بی‌صدا کار نکردن» است، نه خطا. رفع آن در scope فاز ۹ نیست چون origin واقعی فقط در زمان packaging معلوم است (مثل `MATURIDI_WEB_URL`)؛ راه‌حلِ ثبت‌شده:

- قالب `src-tauri/capabilities/remote-web.json.template` اضافه شد: در packaging به `remote-web.json` کپی و `https://WEB-ORIGIN-HERE` با origin واقعی جایگزین می‌شود. لیست URL باید دقیقاً همان یک origin باشد، هرگز `*`.
- برای `tauri dev`، فایل `src-tauri/capabilities/local-dev.json` اضافه شد که فقط `http://localhost:*` را مجاز می‌کند (در باندل production بی‌اثر است چون origin production را پوشش نمی‌دهد).

### ۱٫۵ میکروفون — وضعیت پیش از فاز ۹

هیچ handlerای برای درخواست مجوز در کد نبود: رفتار پیش‌فرض WebKitGTK اعمال می‌شد و هیچ‌جا ثبت نشده بود که `getUserMedia` در دسکتاپ لینوکس چه می‌کند. (رفع در بخش ۲.)

### ۱٫۶ فونت و asset محلی

در `shell/` هیچ فونتی نیست؛ `index.html` فقط نام خانوادهٔ `Vazirmatn` را می‌برد (فونت سیستمی). فونت مصحف/متن پس از ناوبری از وب‌اپ production می‌آید. پس «فونت محلی دسکتاپ» وجود ندارد و رندر مصحف در دسکتاپ دقیقاً همان رندر وب است (با همان شکاف فونت هندوپاک R-13).

---

## ۲. چه تغییر کرد (فقط `apps/desktop`)

### ۲٫۱ فایل‌های تغییرکرده

| فایل | تغییر |
|---|---|
| `src-tauri/src/main.rs` (بازسازی) | مجوز میکروفون، محافظ بستن/خروج حین ضبط، Hifz Studio، ذخیره/بازیابی هندسهٔ پنجره، tray با آیتم‌های استودیو، tray به‌صورت best-effort |
| `src-tauri/src/studio.rs` (جدید) | منطق خالص و تست‌پذیر استودیو: ساخت URL dock، چیدمان سه‌ستونه، parse کردن `config.js`، تطابق host، تصمیم محافظ بستن |
| `src-tauri/Cargo.lock` (جدید) | پین وابستگی‌ها؛ حل‌شده به `tauri 2.12.5` |
| `src-tauri/capabilities/local-dev.json` (جدید) | capability فقط-localhost برای `tauri dev` |
| `src-tauri/capabilities/remote-web.json.template` (جدید) | قالب capability برای origin واقعی production در packaging |
| `tests/smoke/probe.html` (جدید) | صفحهٔ probe برای smoke test |
| `tests/smoke/probe_server.py` (جدید) | سرور probe (stdlib پایتون): HTTP + WebSocket echo روی دو origin |
| `tests/smoke/smoke-test-linux.sh` (جدید) | اسکریپت smoke test لینوکس زیر Xvfb |
| `src-tauri/Cargo.toml` | فیچر `tray-icon` برای `tauri 2` (بدون آن `tauri::tray` وجود ندارد) |
| `src-tauri/build.rs` (بازسازی) | اعلام هفت کامند `hifz_*` در `AppManifest` — بدون آن ACL هیچ ورودی ندارد و هر invoke با «Plugin not found» رد می‌شود |
| `src-tauri/permissions/autogenerated/*.toml` (تولیدشده در بیلد، ۷ فایل) + `src-tauri/permissions/.gitignore` (جدید) | permissionهای `allow-hifz-*`؛ فایل‌های autogenerated کامیت نمی‌شوند |
| `src-tauri/tauri.conf.json` | کلید `plugins: { "notification": {}}` **حذف شد** — با `tauri-plugin-notification 2.8.0` باعث panic در startup می‌شد (`PluginInitialization("notification", "Error deserializing 'plugins.notification'... invalid type: map, expected unit")`)؛ باگِ پیشینی که اولین اجرای باینری فاز ۹ آن را آشکار کرد. بقیهٔ فایل (پنجره، باندل، CSP) بدون تغییر |
| `shell/` | **بدون تغییر** — صفحهٔ وضعیت محلی دست نخورد |

### ۲٫۲ میکروفون و permission flow

- `Builder::on_permission_request` اضافه شد (Tauri 2.12، لینوکس از طریق WebKitGTK).
- **قانونِ کد:** میکروفون فقط وقتی Allow می‌شود که host صفحهٔ درخواست‌کننده دقیقاً با host origin پیکربندی‌شدهٔ وب‌اپ برابر باشد؛ بقیهٔ موارد (دوربین، موقعیت، origin دیگر، پوستهٔ پیکربندی‌نشده) Deny می‌شوند. دسترسی سطح OS (PipeWire/portal) همچنان زیر آن اعمال می‌شود.
- **محدودیت صادقانه — WebKitGTK 2.52 در لینوکس (تأییدشده ۲۰۲۶-۱۱-۰۷):** WebKitGTK برای `getUserMedia` اصلاً سیگنال `permission-request` را emit نمی‌کند؛ درخواست مستقیم به شمارش دستگاه می‌رسد. با پچ تشخیصیِ موقت روی wry (فقط در sandbox، برگردانده شد) ثابت شد handler وصل و فعال است (`permission_handler present: true`، سیگنال برای geolocation خورد و handler آن را رد کرد — «User denied Geolocation») ولی برای میکروفون هیچ سیگنالی نمی‌آید. پس **در لینوکس این handler نمی‌تواند میکروفون را گیت کند**؛ گیتِ واقعی میکروفون در لینوکس ناوبری است: پوسته فقط origin پیکربندی‌شده را باز می‌کند. بررسیِ origin در handler به‌عنوان defense-in-depth برای macOS/Windows حفظ شده (آنجا ممکن است media را گیت کند — تأییدنشده، BLOCKED). تست deny میکروفون روی origin نامطابق در لینوکس غیرقابل‌اجرا است؛ به‌جای آن smoke test ردکردنِ geolocation روی origin نامطابق را اثبات می‌کند (بخش ۴٫۳).
- دلیل: خواندن زندهٔ حفاظ بدون میکروفون ممکن نیست و وب‌اپ فقط روی origin آکادمی اجرا می‌شود؛ اعطای خودکارِ بدون قید origin امن نیست.

### ۲٫۳ محافظ بستن/خروج حین ضبط

- وب‌اپ باید دور جلسهٔ زنده/ضبط، کامند `hifz_set_recording_active(true/false)` را صدا بزند (قرارداد مشترک — بخش ۵).
- وقتی پرچم ضبط فعال است: بستن پنجرهٔ اصلی (`CloseRequested`) با `prevent_close()` رد می‌شود + ایونت `hifz-close-blocked` به وب‌اپ + اعلان سیستمی «ضبط در جریان است»؛ خروج از tray هم با همان محافظ رد می‌شود و پنجرهٔ اصلی focus می‌گیرد.
- وقتی ضبط فعال نیست: هندسهٔ پنجره ذخیره و پنجره‌های استودیو بسته می‌شوند، بعد بستن عادی انجام می‌شود.
- پرچم تست `--hifz-smoke-recording` (فقط برای smoke test) ضبط را از ابتدا فعال می‌کند تا محافظ بدون جلسهٔ وب قابل آزمایش باشد.

### ۲٫۴ Hifz Studio چندستونه — تصمیم طراحی آکادمی، نه قابلیت Tarteel

- **ثبت صریح:** چیدمان چندستونه (مصحف در مرکز، ابزار تمرین در یک dock، تاریخچه/متشابهات در dock دیگر) **مزیت محصول‌ویژهٔ آکادمی** است؛ ترتیل چنین چیزی ندارد و این قابلیت هرگز به‌عنوان «برابری با ترتیل» معرفی نمی‌شود.
- پیاده‌سازی: کامندهای `hifz_studio_open(surah)` / `hifz_studio_close` / `hifz_studio_is_open` / `hifz_studio_layout` + آیتم‌های tray «Open/Close Hifz Studio» (سورهٔ پیش‌فرض tray: ۱).
- چیدمان (RTL): dock تمرین سمت راست، مصحف در مرکز، dock تاریخچه سمت چپ؛ هر dock ۲۴٪ عرض (۳۰۰ تا ۴۲۰ پیکسل)، ارتفاع کامل. حداقل نمایشگر `1200×700` منطقی؛ باریک‌تر باشد استودیو با پیام صادقانه باز نمی‌شود (به‌جای پنجره‌های روی‌هم‌افتاده).
- اندازه‌ها با scale factor مانیتور به واحد منطقی تبدیل می‌شوند (DPI-aware) و چیدمان روی مانیتوری که پنجرهٔ اصلی در آن است انجام می‌شود.
- URL هر dock: `{base}/{locale}/quran/{surah}?tab=hifz&studio=practice|history` (مسیر وب: `/[locale]/quran/[surah]?tab=hifz`).
- **محدودیت صادقانه:** وب‌اپ پارامتر `studio` را هنوز نمی‌خواند؛ تا وقتی وب آن را پیاده نکند، dock همان صفحهٔ کامل مطالعه را نشان می‌دهد و ارزش امروز استودیو پنجره‌های جداگانه + چیدمان آماده + تغییراندازه/تمام‌صفحهٔ مستقل است (قرارداد مشترک — بخش ۵).

### ۲٫۵ هندسهٔ پنجره

- هنگام بستنِ مجاز، موقعیت/اندازهٔ پنجرهٔ اصلی در `window-state.json` داخل app-data ذخیره و در شروع بعدی بازیابی می‌شود (با clamp به مانیتور فعلی؛ فایل خراب = نادیده‌گرفتن بی‌صدا و نگه‌داشتن پیش‌فرض).
- Tray: اگر hostای برای system tray نباشد (مدیر پنجرهٔ حداقلی، Xvfb)، ساخت tray دیگر setup را fail نمی‌کند؛ هشدار در stderr ثبت و اپ بدون tray ادامه می‌دهد. این مورد در smoke test زیر Xvfb تأیید شد (بخش ۴).

### ۲٫۶ چیزهایی که عمداً اضافه نشد

- هیچ میان‌بر صفحه‌کلید دسکتاپی: کنترل‌های صفحه‌کلید/ماوس حفاظ در وب‌اپ‌اند و بدون تغییر وب نمی‌شود به آن‌ها دست زد؛ tray منو دسترسی با ماوس را می‌دهد.
- هیچ تغییر CSP، هیچ فونت/asset محلی، هیچ منطق محصولی در Rust.

---

## ۳. قراردادهای مشترک (shared) — بیرون از `apps/desktop`، پیاده نشده

این موارد برای کامل‌شدن رفتار لازم‌اند ولی در scope فاز ۹ نبودند و **دست نخورده‌اند**:

1. **وب‌اپ → `hifz_set_recording_active`:** `TauriBridge` باید دور شروع/پایان جلسهٔ زنده و ضبط (`QuranHifzStudy.tsx`) این کامند را صدا بزند و به ایونت `hifz-close-blocked` گوش دهد. تا آن موقع محافظ بستن فقط با پرچم تست قابل آزمایش است.
2. **وب‌اپ → پارامتر `studio`:** صفحهٔ `[surah]` باید `?studio=practice|history` را بخواند و محتوای dock را رندر کند (در غیر این صورت dock همان صفحهٔ کامل است).
3. **Packaging → capability از راه دور:** کپی `remote-web.json.template` به `remote-web.json` با origin واقعی (بخش ۱٫۴)؛ بدون آن، مورد ۱ و ۲ و حتی `sync-now` در production کار نمی‌کنند.
4. **وب‌اپ → `hifz_studio_open`:** دکمهٔ «استودیو» در وب (اگر خواسته شود) باید این کامند را با شمارهٔ سورهٔ جاری صدا بزند؛ فعلاً فقط tray آن را باز می‌کند (سورهٔ ۱).

---

## ۴. نتایج بیلد و smoke test لینوکس (فرمان و خروجی واقعی)

همهٔ اعداد زیر از اجراهای واقعی ۲۰۲۶-۱۱-۰۷ در sandbox لینوکس (VM، ‏~۷۴۰MB RAM آزاد، `CARGO_BUILD_JOBS=1`) هستند. macOS/Windows اجرا نشده‌اند.

### ۴٫۱ تست واحد Rust

فرمان: `cd apps/desktop/src-tauri && CARGO_BUILD_JOBS=1 cargo test`

نتیجه: **۱۱ تست پاس، ۰ فیل** (`studio::tests::*`: `valid_web_urls`، `dock_urls`، `dock_labels_and_titles`، `tile_layout_1920x1080` — dockها ۴۲۰px، مرکز ۱۰۸۰px — `tile_layout_1280x800` — dockها ۳۰۷px — `tile_layout_too_narrow_is_none`، `geometry_clamp`، `shell_config_parse`، `resolve_priority`، `host_matching`، `close_guard_decision`). `cargo check` هم exit 0.

پی‌نوشت (۲۰۲۶-۱۱-۰۷ ~۰۲:۳۰): یک اجرای `cargo test --locked` در نشستی دیگر با خطای `soup3-sys` شکست خورد — `libsoup-3.0` در آن نشستِ sandbox نبود (ناپایداریِ شناخته‌شدهٔ بسته‌های سیستمیِ خارج از `~`). اجرای مجددِ همان فرمان با وابستگی‌های حاضر: **۱۱/۱۱ پاس** — شکست موقتی و محیطی بود، نه از کد.

### ۴٫۲ بیلد لینوکس

- بیلد debug: `CARGO_BUILD_JOBS=1 cargo build` در `apps/desktop/src-tauri` — **exit 0**؛ باینری `target/debug/maturidi-academy-desktop` (~۲۳۸MB).
- بیلد release: `cd apps/desktop && CARGO_BUILD_JOBS=1 npm run tauri build` — **exit 0**. تلاش اول (شروع ~۰۱:۴۲) پس از ~۱۸ دقیقه بدون خروجی و بدون باینری از بین رفت (session اجراکننده گم شد؛ علت نامشخص، در dmesg ردّ OOM نیست)؛ تلاش دوم با nohup + لاگ ماندگار (`/tmp/tauri-release-build.log`) موفق شد: ‏`Finished release profile [optimized] target(s) in 6m 59s` (ادامهٔ incremental روی ۱٫۲GB وابستگیِ ساخته‌شده) و `TAURI_BUILD_EXIT=0`. خروجی‌ها (بدون امضا، طبق `tauri.conf.json`):
  - باینری `target/release/maturidi-academy-desktop` — ۱۹٬۲۹۰٬۹۷۶ بایت (~۱۸٫۴MB)
  - `target/release/bundle/appimage/Maturidi Academy_0.1.0_amd64.AppImage` — ۸۵٬۶۷۰٬۳۹۲ بایت (~۸۱٫۷MB)
  - `target/release/bundle/deb/Maturidi Academy_0.1.0_amd64.deb` — ۷٬۲۳۱٬۰۷۰ بایت (~۶٫۹MB)
  - `target/release/bundle/rpm/Maturidi Academy-0.1.0-1.x86_64.rpm` — ۷٬۲۳۵٬۵۳۹ بایت (~۶٫۹MB)
  - Sanity check باینری release زیر Xvfb: پنجرهٔ «Maturidi Academy» ظاهر شد و پروسس زنده ماند (بدون smoke کامل — اسکریپت smoke فقط باینری debug را پشتیبانی می‌کند).

### ۴٫۳ Smoke test (Xvfb)

فرمان: `cd apps/desktop && bash tests/smoke/smoke-test-linux.sh` — لاگ کامل آخرین اجرا: `/tmp/smoke9.log`

نتیجه: **PASS=14 FAIL=0** (اسکریپت exit 0).

| # | چک | نتیجه |
|---|---|---|
| ۱ | پنجرهٔ unconfigured ظاهر شد (۱۲۸۰×۸۰۰) | PASS |
| ۱ | پروسس زنده ماند | PASS |
| ۲ | fetch همان-origin روی remote | PASS |
| ۲ | WebSocket echo روی remote | PASS |
| ۲ | IPC روی origin remote رد شد (پیام دقیق ACL) | PASS |
| ۲ | میکروفون روی origin منطبق به شمارش دستگاه رسید (`OverconstrainedError` = WebKit-level grant، دستگاهی نیست) | PASS |
| ۲ | geolocation روی origin remote رد شد (handler فعال است) | PASS |
| ۲b | geolocation روی origin نامطابق (hop به `localhost:8932`) هم رد شد | PASS |
| ۳ | IPC روی localhost مجاز شد (`__TAURI_INTERNALS__`) | PASS |
| ۳ | round-trip پرچم recording کار کرد | PASS |
| ۴a | محافظ بستن حین ضبط با `wmctrl -c` پنجره+پروسس را نگه داشت | PASS |
| ۴b | بستن بدون ضبط عادی انجام شد | PASS |
| ۵ | maximize به ۱۹۲۰×۱۰۵۹ رسید | PASS |
| — | `shell/config.js` به حالت مخزن برگردانده شد | PASS |

نکته‌های تکمیلیِ آزمایش (در اسکریپت و probe ثبت شده‌اند):
- `shell/config.js` در زمان بیلد embed می‌شود، نه خواندن از دیسک در runtime؛ اسکریپت برای هر probe origin مقدار را می‌نویسد + rebuild می‌کند و در انتها (و در trap) آن را برمی‌گرداند + rebuild می‌کند.
- `xdotool windowclose` پنجره را **بدون** ایونت `CloseRequested` نابود می‌کند و محافظ را دور می‌زند؛ `wmctrl -c` مسیر درست است.
- تست‌های 4a/4b/5 باید با صفحهٔ unconfigured اجرا شوند (صفحهٔ probe پرچم recording را true می‌کند).
- در Xvfb بدون dbus هشدارهای `libayatana-appindicator` می‌آید ولی اپ ادامه می‌دهد (tray best-effort).

### ۴٫۴ موارد تست‌نشده / BLOCKED

- **macOS / Windows:** هیچ بیلد یا smokeای اجرا نشده (بدون runner) — BLOCKED. بیلد موفق لینوکس به معنی تست آن‌ها نیست.
- **میکروفون واقعی (صدای ضبط‌شده):** در sandbox دستگاه ضبط نیست (`OverconstrainedError`) — فقط رسیدنِ درخواست تا شمارش دستگاه تأیید شد، نه ضبط واقعی صدا.
- **multi-display / DPI واقعی:** Xvfb یک مانیتور مجازی دارد؛ چیدمان استودیو فقط با تست واحد (۱۹۲۰×۱۰۸۰ و ۱۲۸۰×۸۰۰ منطقی) تأیید شده، نه با دو مانیتور واقعی.
- **TLS/wss به API production و وب‌اپ واقعی:** probeهای محلی (HTTP/ws) جایگزین آن‌ها شدند؛ اتصال واقعی به `academy.hosseinnasanih.ir` تست نشده.
- **میکروفون روی origin نامطابق:** در لینوکس WebKitGTK غیرقابل‌تست است (بخش ۲٫۲) — به‌جای آن geolocation اثبات شد.
- **Hifz Studio با dockهای واقعی:** کامندها و چیدمان با تست واحد تأیید شدند؛ بازشدنِ dockها با وب‌اپ واقعی (نیازمند IPC از صفحهٔ وب + پارامتر `studio`) هنوز تست نشده — وابسته به قراردادهای بخش ۳.
- **ClamAV / آپلود ویدیو / آفلاین:** خارج از scope دسکتاپ فاز ۹.

---

## ۵. سطح قابلیت دسکتاپ (L0–L5)

تعریف سطح‌ها (برای دسکتاپ فاز ۹): هر سطح فقط وقتی «کامل» است که با اجرای واقعی تأیید شده باشد؛ «جزئی» یعنی کد/تست واحد هست ولی راستی‌آزماییِ زنده با وب‌اپ واقعی یا OS دیگر مانده است.

| سطح | تعریف | وضعیت | دلیل |
|---|---|---|---|
| L0 | اپ اجرا می‌شود، پنجره ظاهر می‌شود، پروسس زنده می‌ماند | **کامل** | smoke 1: پنجرهٔ ۱۲۸۰×۸۰۰ + پروسس زنده (PASS) |
| L1 | وب‌اپ داخل WebView کار می‌کند (fetch/WebSocket) | **جزئی** | روی probeهای محلی PASS؛ وب‌اپ واقعی و TLS/wss به production تست نشده (§۴٫۴) |
| L2 | پل Tauri (IPC) در dev و production کار می‌کند | **جزئی** | localhost: PASS (IPC + round-trip پرچم). production: **BLOCKED** — بدون `remote-web.json` در packaging هیچ IPCای نیست (F-01) |
| L3 | میکروفون + محافظ بستن حین ضبط | **جزئی** | محافظ بستن: PASS (با پرچم تست). میکروفون: تا شمارش دستگاه رسید؛ ضبط واقعی صدا و قرارداد وب (`hifz_set_recording_active`) پیاده نشده (§۳)؛ گیت میکروفون در لینوکس از مسیر handler عبور نمی‌کند (§۲٫۲) |
| L4 | Hifz Studio چندستونه (dockها + چیدمان + tray) | **جزئی** | کد + ۱۱ تست واحد PASS؛ بازشدنِ dock با وب‌اپ واقعی تست نشده (نیازمند IPC + پارامتر `studio` در وب، §۳) |
| L5 | برابری دسکتاپیِ کامل و آمادهٔ production (هر سه OS، وب واقعی، استودیو زنده) | **نرسیده** | macOS/Windows اجرا نشده؛ قراردادهای §۳ بازند؛ release build در §۴٫۲ ثبت می‌شود |

**جمع‌بندی:** دسکتاپ فاز ۹ روی لینوکس در سطح **L2 جزئی / L3–L4 کد-کامل ولی زنده-تأییدنشده** است. دروازهٔ اصلیِ رسیدن به L5 سه چیز است: (۱) قراردادهای وب در §۳، (۲) capability از راه دور در packaging (F-01)، (۳) بیلد/smoke واقعی macOS و Windows.
