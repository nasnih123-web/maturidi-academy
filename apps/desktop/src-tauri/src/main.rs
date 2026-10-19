// Maturidi Academy — Tauri 2 desktop shell (Phase 13).
//
// Responsibilities of the native shell (and ONLY these):
// - host the web frontend (dev: http://localhost:3000, prod: bundled static export)
// - system-tray icon with menu: Open / Sync now / Quit
// - OS notifications via the Tauri notification plugin
//
// All product logic lives in the web app (ADR-001: presentation is
// replaceable; business logic stays behind stable API contracts). The
// "Sync now" tray item emits a `sync-now` event that the web frontend's
// TauriBridge component turns into a sync-runner round.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::NotificationExt::init())
        .setup(|app| {
            let open =
                MenuItem::with_id(app, "tray-open", "Open Maturidi Academy", true, None::<&str>)?;
            let sync = MenuItem::with_id(app, "tray-sync", "Sync now", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &sync, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray-open" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "tray-sync" => {
                        // Handled by the web frontend (components/TauriBridge.tsx).
                        app.emit("sync-now", ()).ok();
                    }
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
