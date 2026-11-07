// Maturidi Academy — Tauri 2 desktop shell (Phase 13, extended Phase 9).
//
// Responsibilities of the native shell (and ONLY these):
// - host the web frontend (dev: http://localhost:3000, prod: bundled static
//   shell in `shell/` that navigates to the configured production web URL,
//   ADR-0023)
// - system-tray icon with menu: Open / Hifz Studio / Sync now / Quit
// - OS notifications via the Tauri notification plugin
// - Hifz Studio docks (Phase 9): separate practice / history windows tiled
//   around the main mushaf window — an Academy-specific layout, NOT a
//   Tarteel feature
// - microphone permission: auto-granted ONLY for pages whose host matches
//   the configured academy origin (the hifz live-reading flow needs it;
//   any other origin is denied)
// - close/quit guard: refusing to close the main window (or quit) while a
//   live reading / recording session is active
//
// All product logic lives in the web app (ADR-001: presentation is
// replaceable; business logic stays behind stable API contracts).
//
// Shared contract with the web app (web side is NOT part of this phase —
// see docs/quran/hifz-phase9-notes.md):
// - The web app must call `hifz_set_recording_active(true/false)` around
//   live/recording sessions (TauriBridge) for the close guard to work.
// - Studio docks load `?tab=hifz&studio=practice|history`; the web app
//   does not render dock-specific content for `studio` yet.
// - These commands/events only reach the web app once packaging adds the
//   remote capability for the real production origin
//   (`capabilities/remote-web.json.template`). Without it, a remote page
//   gets no Tauri IPC at all (Tauri 2 capabilities; verified in the
//   phase-9 audit) — including the pre-existing `sync-now` tray event.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod studio;

use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
};

use serde_json;
use studio::{
    DockKind, Rect, WindowGeometry, HISTORY_DOCK_LABEL, MAIN_WINDOW_LABEL, PRACTICE_DOCK_LABEL,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, State,
    WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri_plugin_notification::NotificationExt;

/// Test-only CLI flag: start with the recording flag already set, so the
/// close guard can be exercised end-to-end without a web session
/// (`scripts/smoke-test-linux.sh`). Never set by the app itself.
const SMOKE_RECORDING_FLAG: &str = "--hifz-smoke-recording";

/// Shared mutable desktop state. Only the recording flag and the studio
/// open/closed flag live here; no product state.
#[derive(Default)]
struct DesktopState {
    /// True while a live reading / recording session is active (set by the
    /// web app via `hifz_set_recording_active`).
    recording: Mutex<bool>,
    /// True while at least one studio dock window exists.
    studio_open: Mutex<bool>,
}

impl DesktopState {
    fn recording_active(&self) -> bool {
        *self.recording.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn set_recording(&self, active: bool) {
        if let Ok(mut g) = self.recording.lock() {
            *g = active;
        }
    }
    fn set_studio_open(&self, open: bool) {
        if let Ok(mut g) = self.studio_open.lock() {
            *g = open;
        }
    }
    fn studio_open(&self) -> bool {
        *self.studio_open.lock().unwrap_or_else(|e| e.into_inner())
    }
}

// ---------------------------------------------------------------------------
// Small helpers (Tauri plumbing; pure decisions live in `studio.rs`)
// ---------------------------------------------------------------------------

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

/// Resolve the web origin, reading `shell/config.js` from disk on a
/// best-effort basis (works for `tauri dev` / unpacked layouts; in a
/// packaged bundle the file is embedded, so the env var is the reliable
/// override — see `studio::resolve_web_base_url`).
fn resolve_base_url() -> Option<String> {
    let env_url = std::env::var("MATURIDI_WEB_URL").ok();
    let config = read_shell_config_contents();
    studio::resolve_web_base_url(env_url.as_deref(), config.as_deref(), cfg!(debug_assertions))
}

fn read_shell_config_contents() -> Option<String> {
    let mut candidates: Vec<PathBuf> = vec![PathBuf::from("shell/config.js")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("shell/config.js"));
            candidates.push(dir.join("../shell/config.js"));
            // macOS bundle layout: <App>.app/Contents/MacOS/<bin>
            candidates.push(dir.join("../Resources/shell/config.js"));
        }
    }
    candidates
        .into_iter()
        .find_map(|p| fs::read_to_string(p).ok())
}

/// Logical size of the monitor the main window is currently on.
fn current_monitor_area(app: &AppHandle) -> Option<(u32, u32)> {
    let win = app.get_webview_window(MAIN_WINDOW_LABEL)?;
    let monitor = win.current_monitor().ok()??;
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<u32>(scale);
    Some((size.width, size.height))
}

fn geometry_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("window-state.json"))
}

fn save_main_geometry(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Some(path) = geometry_file(app) else {
        return;
    };
    let Ok(scale) = win.scale_factor() else {
        return;
    };
    let (Ok(pos), Ok(size)) = (win.inner_position(), win.inner_size()) else {
        return;
    };
    let pos = pos.to_logical::<i32>(scale);
    let size = size.to_logical::<u32>(scale);
    let geom = WindowGeometry { x: pos.x, y: pos.y, width: size.width, height: size.height };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(&geom) {
        let _ = fs::write(&path, json);
    }
}

fn restore_main_geometry(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Some(path) = geometry_file(app) else {
        return;
    };
    let Ok(json) = fs::read_to_string(&path) else {
        return; // First run: keep the configured default size.
    };
    let Ok(geom) = serde_json::from_str::<WindowGeometry>(&json) else {
        return; // Corrupt state file: keep defaults, never crash startup.
    };
    let Some((area_w, area_h)) = current_monitor_area(app) else {
        return;
    };
    let geom = geom.clamp_to_area(area_w, area_h);
    let _ = win.set_position(Position::Logical(LogicalPosition::new(geom.x as f64, geom.y as f64)));
    let _ = win.set_size(Size::Logical(LogicalSize::new(geom.width as f64, geom.height as f64)));
}

/// Open (or focus, if it already exists) one studio dock window.
fn open_or_focus_dock(
    app: &AppHandle,
    dock: DockKind,
    url: &str,
    rect: Rect,
) -> Result<(), String> {
    let label = dock.label();
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.set_position(Position::Logical(LogicalPosition::new(rect.x as f64, rect.y as f64)));
        let _ = win.set_size(Size::Logical(LogicalSize::new(rect.width as f64, rect.height as f64)));
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let parsed_url: tauri::Url = url
        .parse()
        .map_err(|e| format!("invalid dock url {url}: {e}"))?;
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed_url))
        .title(dock.title())
        .inner_size(rect.width as f64, rect.height as f64)
        .position(rect.x as f64, rect.y as f64)
        .resizable(true)
        .min_inner_size(320.0, 500.0)
        .build()
        .map_err(|e| format!("failed to create dock window {label}: {e}"))?;
    Ok(())
}

fn close_studio_windows(app: &AppHandle) {
    for label in [PRACTICE_DOCK_LABEL, HISTORY_DOCK_LABEL] {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.close();
        }
    }
    app.state::<DesktopState>().set_studio_open(false);
}

/// Open Hifz Studio for `surah` (1..=114): tile main + two docks on the
/// current monitor. Shared by the `hifz_studio_open` command and the tray
/// menu. Returns an error string (Persian, user-facing) on failure.
fn open_hifz_studio(app: &AppHandle, surah: u32) -> Result<String, String> {
    if !(1..=114).contains(&surah) {
        return Err("شمارهٔ سوره باید بین ۱ تا ۱۱۴ باشد.".to_string());
    }
    let Some(base) = resolve_base_url() else {
        return Err(
            "نشانی وب‌اپ تنظیم نشده است؛ استودیو بدون وب‌اپ باز نمی‌شود.".to_string(),
        );
    };
    let Some((area_w, area_h)) = current_monitor_area(app) else {
        return Err("نمایشگر فعلی پیدا نشد؛ استودیو باز نشد.".to_string());
    };
    let Some((main_rect, practice_rect, history_rect)) =
        studio::tile_studio_layout(area_w, area_h)
    else {
        return Err(format!(
            "نمایشگر {area_w}×{area_h} برای چیدمان سه‌ستونه باریک است (حداقل {}×{} لازم است).",
            studio::STUDIO_MIN_WIDTH,
            studio::STUDIO_MIN_HEIGHT
        ));
    };
    let practice_url = studio::studio_dock_url(&base, "fa", surah, DockKind::Practice)
        .ok_or_else(|| "ساختن نشانی dock تمرین ناموفق بود.".to_string())?;
    let history_url = studio::studio_dock_url(&base, "fa", surah, DockKind::History)
        .ok_or_else(|| "ساختن نشانی dock تاریخچه ناموفق بود.".to_string())?;
    open_or_focus_dock(app, DockKind::Practice, &practice_url, practice_rect)?;
    open_or_focus_dock(app, DockKind::History, &history_url, history_rect)?;
    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = main.set_position(Position::Logical(LogicalPosition::new(
            main_rect.x as f64, main_rect.y as f64,
        )));
        let _ = main.set_size(Size::Logical(LogicalSize::new(
            main_rect.width as f64, main_rect.height as f64,
        )));
        let _ = main.show();
        let _ = main.set_focus();
    }
    app.state::<DesktopState>().set_studio_open(true);
    Ok(format!("استودیوی حفاظ برای سورهٔ {surah} باز شد."))
}

// ---------------------------------------------------------------------------
// Tauri commands (invoked by the web app / local shell page)
// ---------------------------------------------------------------------------

/// The web app calls this around live / recording sessions so the shell
/// can refuse close/quit mid-session. See the phase-9 notes for the
/// TauriBridge contract.
#[tauri::command]
fn hifz_set_recording_active(state: State<'_, DesktopState>, active: bool) {
    state.set_recording(active);
}

#[tauri::command]
fn hifz_is_recording_active(state: State<'_, DesktopState>) -> bool {
    state.recording_active()
}

/// Diagnostics: which web origin the shell resolves (None = unconfigured).
#[tauri::command]
fn hifz_web_base_url() -> Option<String> {
    resolve_base_url()
}

#[tauri::command]
fn hifz_studio_open(app: AppHandle, surah: u32) -> Result<String, String> {
    open_hifz_studio(&app, surah)
}

#[tauri::command]
fn hifz_studio_close(app: AppHandle) {
    close_studio_windows(&app);
}

#[tauri::command]
fn hifz_studio_is_open(state: State<'_, DesktopState>) -> bool {
    state.studio_open()
}

/// Re-tile the main window + open docks on the current monitor (e.g. after
/// moving the app to another display).
#[tauri::command]
fn hifz_studio_layout(app: AppHandle) -> Result<String, String> {
    if !app.state::<DesktopState>().studio_open() {
        return Err("استودیو باز نیست.".to_string());
    }
    let Some((area_w, area_h)) = current_monitor_area(&app) else {
        return Err("نمایشگر فعلی پیدا نشد.".to_string());
    };
    let Some((main_rect, practice_rect, history_rect)) =
        studio::tile_studio_layout(area_w, area_h)
    else {
        return Err("نمایشگر فعلی برای چیدمان سه‌ستونه باریک است.".to_string());
    };
    for (label, rect) in [
        (MAIN_WINDOW_LABEL, main_rect),
        (PRACTICE_DOCK_LABEL, practice_rect),
        (HISTORY_DOCK_LABEL, history_rect),
    ] {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.set_position(Position::Logical(LogicalPosition::new(rect.x as f64, rect.y as f64)));
            let _ = win.set_size(Size::Logical(LogicalSize::new(rect.width as f64, rect.height as f64)));
        }
    }
    Ok("چیدمان استودیو به‌روز شد.".to_string())
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

fn main() {
    // Test-only hook for the close-guard smoke test (see SMOKE_RECORDING_FLAG).
    let smoke_recording = std::env::args().any(|a| a == SMOKE_RECORDING_FLAG);
    if smoke_recording {
        eprintln!("[desktop] smoke flag: recording preset to active");
    }
    let initial_state = DesktopState {
        recording: Mutex::new(smoke_recording),
        studio_open: Mutex::new(false),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(initial_state)
        .invoke_handler(tauri::generate_handler![
            hifz_set_recording_active,
            hifz_is_recording_active,
            hifz_web_base_url,
            hifz_studio_open,
            hifz_studio_close,
            hifz_studio_is_open,
            hifz_studio_layout
        ])
        // Permission gate (best effort, platform-dependent — see below).
        // Non-microphone kinds (camera, geolocation, …) are always denied.
        // Microphone is allowed ONLY for pages served from the configured
        // academy origin; other origins and the unconfigured shell are
        // denied. The hifz live flow runs entirely inside the academy web
        // app, so this is the one origin that needs the mic; OS-level mic
        // access (PipeWire/portal) still applies underneath on Linux.
        //
        // HONEST LIMITATION (verified 2026-11-07, WebKitGTK 2.52/Linux):
        // WebKitGTK does NOT emit a `permission-request` signal for
        // `getUserMedia` at all — the media request proceeds straight to
        // device enumeration, so this handler never runs for the
        // microphone on Linux and cannot gate mic access there (verified
        // with a vendored-wry diagnostic: handler wired and working for
        // geolocation, zero signal firings for getUserMedia). The real
        // mic gate on Linux is therefore NAVIGATION: the shell only ever
        // loads the configured academy origin, so a foreign origin can
        // only reach the mic if the webview navigates to it. On macOS /
        // Windows the permission handler may gate media (unverified —
        // BLOCKED, no runners here), so the origin check is kept as a
        // correct defense-in-depth for those platforms.
        .on_permission_request(|webview, kind| {
            // Diagnostic: log every permission request (stderr only).
            eprintln!(
                "[desktop] permission-request kind={kind:?} url={}",
                webview.url().map(|u| u.to_string()).unwrap_or_default()
            );
            if kind != PermissionKind::Microphone {
                return PermissionResponse::Deny;
            }
            let page_url = webview
                .url()
                .map(|u| u.to_string())
                .unwrap_or_default();
            let base = resolve_base_url();
            let allowed = match &base {
                Some(base) => studio::url_host_matches_base(&page_url, base),
                None => false,
            };
            eprintln!(
                "[desktop] permission-request kind=Microphone page={page_url} base={base:?} -> {}",
                if allowed { "Allow" } else { "Deny" }
            );
            if allowed {
                PermissionResponse::Allow
            } else {
                PermissionResponse::Deny
            }
        })
        // Close guard + geometry persistence + studio teardown.
        .on_window_event(|window, event| {
            // Diagnostic: log every window event (stderr only).
            if !matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_)) {
                eprintln!("[desktop] window-event label={} event={event:?}", window.label());
            }
            match event {
            WindowEvent::CloseRequested { api, .. } => {
                let app = window.app_handle();
                eprintln!(
                    "[desktop] close-requested label={} recording={}",
                    window.label(),
                    app.state::<DesktopState>().recording_active()
                );
                if window.label() == MAIN_WINDOW_LABEL {
                    if studio::should_block_close(app.state::<DesktopState>().recording_active())
                    {
                        api.prevent_close();
                        let _ = window.emit("hifz-close-blocked", ());
                        notify(
                            app,
                            "ضبط در جریان است",
                            "پیش از بستن پنجره، ضبط یا خواندن زنده را متوقف کنید.",
                        );
                        let _ = window.show();
                        let _ = window.set_focus();
                    } else {
                        save_main_geometry(app);
                        close_studio_windows(app);
                    }
                }
            }
            WindowEvent::Destroyed => {
                // A dock closed by the user: if no dock remains, the studio
                // is closed. (Main-window destroy needs no handling: the
                // app exits with the tray only when no windows remain, and
                // CloseRequested already tore the studio down.)
                if DockKind::is_dock_label(window.label()) {
                    let app = window.app_handle();
                    let any_dock_left = [PRACTICE_DOCK_LABEL, HISTORY_DOCK_LABEL]
                        .iter()
                        .any(|l| app.get_webview_window(l).is_some());
                    if !any_dock_left {
                        app.state::<DesktopState>().set_studio_open(false);
                    }
                }
            }
            _ => {}
            }
        })
        .setup(|app| {
            let open =
                MenuItem::with_id(app, "tray-open", "Open Maturidi Academy", true, None::<&str>)?;
            let studio_open = MenuItem::with_id(
                app,
                "tray-studio-open",
                "Open Hifz Studio",
                true,
                None::<&str>,
            )?;
            let studio_close = MenuItem::with_id(
                app,
                "tray-studio-close",
                "Close Hifz Studio",
                true,
                None::<&str>,
            )?;
            let sync = MenuItem::with_id(app, "tray-sync", "Sync now", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &open,
                    &PredefinedMenuItem::separator(app)?,
                    &studio_open,
                    &studio_close,
                    &PredefinedMenuItem::separator(app)?,
                    &sync,
                    &quit,
                ],
            )?;

            // Best-effort: the tray is an accessory — if there is no system
            // tray host (minimal window managers, headless Xvfb), the app
            // must still start instead of failing setup outright.
            match TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray-open" => {
                        if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "tray-studio-open" => match open_hifz_studio(app, 1) {
                        Ok(msg) => {
                            eprintln!("[desktop] {msg}");
                        }
                        Err(msg) => {
                            notify(app, "استودیوی حفاظ باز نشد", &msg);
                        }
                    },
                    "tray-studio-close" => close_studio_windows(app),
                    "tray-sync" => {
                        // Handled by the web frontend (components/TauriBridge.tsx).
                        app.emit("sync-now", ()).ok();
                    }
                    "tray-quit" => {
                        // Same guard as window close: never quit mid-recording.
                        if studio::should_block_close(
                            app.state::<DesktopState>().recording_active(),
                        ) {
                            notify(
                                app,
                                "ضبط در جریان است",
                                "پیش از خروج، ضبط یا خواندن زنده را متوقف کنید.",
                            );
                            if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        } else {
                            save_main_geometry(app);
                            app.exit(0);
                        }
                    }
                    _ => {}
                })
                .build(app)
            {
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[desktop] warning: tray icon unavailable ({e}); continuing without it");
                }
            }

            restore_main_geometry(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
