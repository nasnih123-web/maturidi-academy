// Maturidi Academy — Hifz Studio (desktop-only, Phase 9).
//
// Hifz Studio is the desktop multi-column layout for the hifz study page:
// the mushaf stays in the main window, the practice tools live in one dock
// window and history / mutashabihat in another. This is an
// **Academy-specific product decision, NOT a Tarteel feature** — Tarteel has
// no such studio; do not present it as parity with Tarteel.
//
// This module holds ONLY pure, unit-testable logic (URL building, layout
// math, config parsing). All Tauri calls live in `main.rs`.
//
// Contract with the web app (shared, web side NOT in this phase):
// - Dock windows load `{base}/{locale}/quran/{surah}?tab=hifz&studio={kind}`
//   where `kind` is `practice` or `history`. The web app does not read the
//   `studio` query parameter yet, so until the web side implements it a dock
//   shows the same study page as the main window; the desktop value today
//   is separate windows + tiled layout + independent resize/fullscreen.
// - The web app must call the `hifz_set_recording_active` Tauri command
//   (see `main.rs` + `TauriBridge` contract in the phase-9 notes) so the
//   shell can refuse to close/quit mid-recording. That call only works
//   once packaging adds the remote capability for the production origin
//   (see `capabilities/remote-web.json.template`).

use serde::{Deserialize, Serialize};

/// Label of the main window (from `tauri.conf.json`).
pub const MAIN_WINDOW_LABEL: &str = "main";
/// Label of the practice-tools dock window.
pub const PRACTICE_DOCK_LABEL: &str = "hifz-practice";
/// Label of the history / mutashabihat dock window.
pub const HISTORY_DOCK_LABEL: &str = "hifz-history";

/// A Hifz Studio dock window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DockKind {
    /// Practice tools dock (drills, peek, grading summary).
    Practice,
    /// History / mutashabihat dock.
    History,
}

impl DockKind {
    /// Tauri window label for this dock.
    pub fn label(self) -> &'static str {
        match self {
            DockKind::Practice => PRACTICE_DOCK_LABEL,
            DockKind::History => HISTORY_DOCK_LABEL,
        }
    }

    /// Value of the `studio` query parameter for this dock.
    pub fn studio_param(self) -> &'static str {
        match self {
            DockKind::Practice => "practice",
            DockKind::History => "history",
        }
    }

    /// Persian window title for this dock.
    pub fn title(self) -> &'static str {
        match self {
            DockKind::Practice => "تمرین حفاظ — آکادمی ماتریدی",
            DockKind::History => "تاریخچه و متشابهات — آکادمی ماتریدی",
        }
    }

    /// True when `label` is one of the studio dock labels.
    pub fn is_dock_label(label: &str) -> bool {
        label == PRACTICE_DOCK_LABEL || label == HISTORY_DOCK_LABEL
    }
}

/// A rectangle in logical pixels (DPI-independent; the caller converts the
/// physical monitor size with the monitor scale factor first).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Persisted main-window geometry (logical pixels).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WindowGeometry {
    /// Clamp the geometry so the window stays (mostly) inside an area of
    /// `area_width` x `area_height` logical pixels and keeps a usable size.
    pub fn clamp_to_area(self, area_width: u32, area_height: u32) -> Self {
        let width = self.width.clamp(320, area_width.max(320));
        let height = self.height.clamp(200, area_height.max(200));
        let max_x = area_width.saturating_sub(width / 2) as i32;
        let max_y = area_height.saturating_sub(height / 2) as i32;
        let x = self.x.clamp(0, max_x.max(0));
        let y = self.y.clamp(0, max_y.max(0));
        WindowGeometry { x, y, width, height }
    }
}

/// Strict-enough check for a web origin: `http(s)://` + non-empty host,
/// no whitespace. Same rule as `shell/shell.js` (`/^https?:\/\/[^\s]+$/`).
pub fn is_valid_web_url(url: &str) -> bool {
    let rest = match url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) {
        Some(rest) => rest,
        None => return false,
    };
    if rest.is_empty() || url.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    // Host part: up to the first '/'; must be non-empty.
    let host = rest.split('/').next().unwrap_or("");
    !host.is_empty()
}

/// Host part of a URL (lower-cased, without port), or `None` if unparsable.
pub fn url_host(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let hostport = rest.split('/').next()?;
    let host = hostport.split('@').next_back().unwrap_or(hostport);
    let host = host.split(':').next().unwrap_or(host);
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

/// True when the page at `page_url` belongs to the same host as the
/// configured web origin `base_url` — the only case in which the shell
/// auto-grants microphone permission (see `main.rs`).
pub fn url_host_matches_base(page_url: &str, base_url: &str) -> bool {
    match (url_host(page_url), url_host(base_url)) {
        (Some(page), Some(base)) => page == base,
        _ => false,
    }
}

/// Build the URL a studio dock loads:
/// `{base}/{locale}/quran/{surah}?tab=hifz&studio={kind}`.
///
/// Returns `None` for an invalid base URL, a non-2-letter locale, or a
/// surah outside 1..=114. The web app's hifz route is
/// `/[locale]/quran/[surah]?tab=hifz` (section-only reader).
pub fn studio_dock_url(base_url: &str, locale: &str, surah: u32, dock: DockKind) -> Option<String> {
    if !is_valid_web_url(base_url) {
        return None;
    }
    if locale.len() != 2 || !locale.bytes().all(|b| b.is_ascii_lowercase()) {
        return None;
    }
    if !(1..=114).contains(&surah) {
        return None;
    }
    let base = base_url.trim_end_matches('/');
    Some(format!(
        "{base}/{locale}/quran/{surah}?tab=hifz&studio={}",
        dock.studio_param()
    ))
}

/// Minimum logical size for the three-column studio layout.
pub const STUDIO_MIN_WIDTH: u32 = 1200;
pub const STUDIO_MIN_HEIGHT: u32 = 700;

/// Tile the studio on a monitor work area of `area_width` x `area_height`
/// logical pixels. Returns `(main, practice, history)`.
///
/// RTL layout: the practice dock sits on the right, the mushaf (main) in
/// the centre, the history dock on the left. Each dock is 24% of the width
/// (clamped to 300..420px); the centre takes the rest. Full height.
///
/// Returns `None` when the area is too narrow/short for three columns —
/// the caller must then refuse the studio with an honest message instead
/// of opening overlapping windows.
pub fn tile_studio_layout(area_width: u32, area_height: u32) -> Option<(Rect, Rect, Rect)> {
    if area_width < STUDIO_MIN_WIDTH || area_height < STUDIO_MIN_HEIGHT {
        return None;
    }
    let dock_w = ((area_width as f64) * 0.24).round() as u32;
    let dock_w = dock_w.clamp(300, 420);
    let main_w = area_width - 2 * dock_w;
    let main = Rect { x: dock_w as i32, y: 0, width: main_w, height: area_height };
    // RTL: practice dock on the right, history dock on the left.
    let practice = Rect { x: (area_width - dock_w) as i32, y: 0, width: dock_w, height: area_height };
    let history = Rect { x: 0, y: 0, width: dock_w, height: area_height };
    Some((main, practice, history))
}

/// Extract `window.MATURIDI_WEB_URL = "..."` from `shell/config.js`.
/// Returns `None` when absent, empty, or not a valid http(s) URL.
pub fn parse_shell_config_url(contents: &str) -> Option<String> {
    let key = "MATURIDI_WEB_URL";
    let at = contents.find(key)?;
    let after = &contents[at + key.len()..];
    let eq = after.find('=')?;
    let after_eq = after[eq + 1..].trim_start();
    let quote = after_eq.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &after_eq[1..];
    let end = rest.find(quote)?;
    let url = rest[..end].trim();
    if url.is_empty() || !is_valid_web_url(url) {
        return None;
    }
    Some(url.to_string())
}

/// Resolve the web origin the shell (and the studio docks) load.
///
/// Priority: `MATURIDI_WEB_URL` env var → `shell/config.js` contents →
/// debug builds fall back to `http://localhost:3000` → `None`
/// (shell shows its honest "not configured" page; studio refuses to open).
///
/// Note: in a packaged production bundle `config.js` is embedded in the
/// binary, not a file on disk, so the `shell_config_contents` argument is
/// best-effort only (dev runs / unpacked layouts). The env var is the
/// reliable override for packaged runs.
pub fn resolve_web_base_url(
    env_url: Option<&str>,
    shell_config_contents: Option<&str>,
    is_debug: bool,
) -> Option<String> {
    if let Some(url) = env_url {
        let url = url.trim();
        if is_valid_web_url(url) {
            return Some(url.to_string());
        }
    }
    if let Some(contents) = shell_config_contents {
        if let Some(url) = parse_shell_config_url(contents) {
            return Some(url);
        }
    }
    if is_debug {
        return Some("http://localhost:3000".to_string());
    }
    None
}

/// Close-guard decision: the main window (and quit) must be refused while
/// a live reading / recording session is active. Pure, so it is unit-tested
/// here and only wired to the window event in `main.rs`.
pub fn should_block_close(recording_active: bool) -> bool {
    recording_active
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_web_urls() {
        assert!(is_valid_web_url("https://academy.hosseinnasanih.ir"));
        assert!(is_valid_web_url("https://academy.hosseinnasanih.ir/fa"));
        assert!(is_valid_web_url("http://localhost:3000"));
        assert!(is_valid_web_url("http://127.0.0.1:8931/"));
        assert!(!is_valid_web_url(""));
        assert!(!is_valid_web_url("academy.hosseinnasanih.ir"));
        assert!(!is_valid_web_url("ftp://example.com"));
        assert!(!is_valid_web_url("https://"));
        assert!(!is_valid_web_url("https://exa mple.com"));
        assert!(!is_valid_web_url("https://example.com/a b"));
    }

    #[test]
    fn dock_urls() {
        let base = "https://academy.hosseinnasanih.ir";
        assert_eq!(
            studio_dock_url(base, "fa", 1, DockKind::Practice),
            Some(
                "https://academy.hosseinnasanih.ir/fa/quran/1?tab=hifz&studio=practice"
                    .to_string()
            )
        );
        assert_eq!(
            studio_dock_url(base, "fa", 114, DockKind::History),
            Some(
                "https://academy.hosseinnasanih.ir/fa/quran/114?tab=hifz&studio=history"
                    .to_string()
            )
        );
        // Trailing slash on the base is trimmed, not doubled.
        assert_eq!(
            studio_dock_url("http://localhost:3000/", "fa", 2, DockKind::Practice),
            Some("http://localhost:3000/fa/quran/2?tab=hifz&studio=practice".to_string())
        );
        // Invalid inputs -> None, never a guessed URL.
        assert_eq!(studio_dock_url(base, "fa", 0, DockKind::Practice), None);
        assert_eq!(studio_dock_url(base, "fa", 115, DockKind::Practice), None);
        assert_eq!(studio_dock_url(base, "fas", 1, DockKind::Practice), None);
        assert_eq!(studio_dock_url(base, "FA", 1, DockKind::Practice), None);
        assert_eq!(studio_dock_url("", "fa", 1, DockKind::Practice), None);
        assert_eq!(studio_dock_url("not-a-url", "fa", 1, DockKind::Practice), None);
    }

    #[test]
    fn dock_labels_and_titles() {
        assert_eq!(DockKind::Practice.label(), "hifz-practice");
        assert_eq!(DockKind::History.label(), "hifz-history");
        assert!(DockKind::is_dock_label("hifz-practice"));
        assert!(DockKind::is_dock_label("hifz-history"));
        assert!(!DockKind::is_dock_label("main"));
        assert!(!DockKind::is_dock_label("other"));
        assert!(!DockKind::Practice.title().is_empty());
        assert!(!DockKind::History.title().is_empty());
    }

    #[test]
    fn tile_layout_1920x1080() {
        let (main, practice, history) = tile_studio_layout(1920, 1080).unwrap();
        // 24% of 1920 = 460 -> clamped to 420; centre takes the rest.
        assert_eq!(practice, Rect { x: 1500, y: 0, width: 420, height: 1080 });
        assert_eq!(history, Rect { x: 0, y: 0, width: 420, height: 1080 });
        assert_eq!(main, Rect { x: 420, y: 0, width: 1080, height: 1080 });
        // No overlap, full coverage.
        assert_eq!(history.width + main.width + practice.width, 1920);
    }

    #[test]
    fn tile_layout_1280x800() {
        let (main, practice, history) = tile_studio_layout(1280, 800).unwrap();
        // 24% of 1280 = 307.
        assert_eq!(practice.width, 307);
        assert_eq!(history.width, 307);
        assert_eq!(main.width, 1280 - 2 * 307);
        assert_eq!(main.x, 307);
    }

    #[test]
    fn tile_layout_too_narrow_is_none() {
        assert_eq!(tile_studio_layout(1199, 1080), None);
        assert_eq!(tile_studio_layout(1920, 699), None);
        assert_eq!(tile_studio_layout(960, 600), None);
    }

    #[test]
    fn geometry_clamp() {
        let g = WindowGeometry { x: -50, y: 5000, width: 5000, height: 50 }
            .clamp_to_area(1920, 1080);
        assert_eq!(g.width, 1920);
        assert_eq!(g.height, 200);
        assert_eq!(g.x, 0);
        assert!(g.y <= 1080);
        let g = WindowGeometry { x: 100, y: 100, width: 1280, height: 800 }
            .clamp_to_area(1920, 1080);
        assert_eq!(g, WindowGeometry { x: 100, y: 100, width: 1280, height: 800 });
    }

    #[test]
    fn shell_config_parse() {
        let contents = "window.MATURIDI_WEB_URL = \"https://academy.hosseinnasanih.ir\";\n";
        assert_eq!(
            parse_shell_config_url(contents),
            Some("https://academy.hosseinnasanih.ir".to_string())
        );
        assert_eq!(parse_shell_config_url("window.MATURIDI_WEB_URL = \"\";"), None);
        assert_eq!(parse_shell_config_url("window.MATURIDI_WEB_URL = \"not-a-url\";"), None);
        assert_eq!(parse_shell_config_url("// nothing here"), None);
        assert_eq!(
            parse_shell_config_url("window.MATURIDI_WEB_URL='http://localhost:3000';"),
            Some("http://localhost:3000".to_string())
        );
    }

    #[test]
    fn resolve_priority() {
        // Env wins over config file.
        assert_eq!(
            resolve_web_base_url(
                Some("https://env.example.com"),
                Some("window.MATURIDI_WEB_URL = \"https://cfg.example.com\";"),
                false
            ),
            Some("https://env.example.com".to_string())
        );
        // Invalid env falls through to config.
        assert_eq!(
            resolve_web_base_url(
                Some("bogus"),
                Some("window.MATURIDI_WEB_URL = \"https://cfg.example.com\";"),
                false
            ),
            Some("https://cfg.example.com".to_string())
        );
        // Debug fallback is localhost; release without config is None.
        assert_eq!(
            resolve_web_base_url(None, None, true),
            Some("http://localhost:3000".to_string())
        );
        assert_eq!(resolve_web_base_url(None, None, false), None);
        assert_eq!(
            resolve_web_base_url(
                None,
                Some("window.MATURIDI_WEB_URL = \"\";"),
                false
            ),
            None
        );
    }

    #[test]
    fn host_matching() {
        assert_eq!(url_host("https://academy.hosseinnasanih.ir/fa/quran/1"), Some("academy.hosseinnasanih.ir".to_string()));
        assert_eq!(url_host("http://127.0.0.1:8931/probe"), Some("127.0.0.1".to_string()));
        assert_eq!(url_host("http://localhost:3000/"), Some("localhost".to_string()));
        assert_eq!(url_host("bogus"), None);
        assert!(url_host_matches_base(
            "https://academy.hosseinnasanih.ir/fa/quran/1?tab=hifz",
            "https://academy.hosseinnasanih.ir"
        ));
        assert!(!url_host_matches_base(
            "https://evil.example.com/",
            "https://academy.hosseinnasanih.ir"
        ));
        assert!(!url_host_matches_base(
            "http://localhost:8932/",
            "http://127.0.0.1:8931"
        ));
    }

    #[test]
    fn close_guard_decision() {
        assert!(should_block_close(true));
        assert!(!should_block_close(false));
    }
}
