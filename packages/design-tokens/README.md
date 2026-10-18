# ‎@maturidi/design-tokens

Single source of truth for the Maturidi Academy visual identity (Phase 3).
Pure presentation — no business logic, no user-visible strings, no secrets
(engineering contract §15, ADR 0002). Tokens and component libraries live in
`packages/*`, never inside apps, so the whole UI layer can be demolished and
rebuilt without touching logic or data.

## Files

| File | Purpose |
|---|---|
| `tokens.css` | `:root` custom properties (`--ma-*`) + base a11y rules. Web entry point. |
| `tokens.ts` | Same tokens as a typed TS object for React Native / non-DOM consumers. Must stay in sync with `tokens.css` (CSS is the source of truth). |
| `motifs/divider.svg` | Geometric section-divider band (8-point star centerpiece). |
| `motifs/pattern.svg` | Tileable 8-point-star (khatam) lattice background. |
| `motifs/frame.svg` | Image frame with corner ornaments. |
| `motifs/icons/*.svg` | Module line-icons, `currentColor`-friendly: `fatwa`, `quran`, `lessons`, `library`, `community`, `map`, `donation`, `calendar`. |
| `turbo.css` | **Imperial Islamic Luxury system** — primary semantic layer for the ported web UI (`--background`, `--surface`, `--text-primary`, `--accent`, `--primary`, … + `--obsidian-*`/`--gold-*`/`--ivory`). Coexists with `tokens.css`: nothing here overrides a `--ma-*` var, so `platform_settings` theme overrides keep working. Web entry point. |
| `semantic.ts` | Same semantic system as typed TS (LIGHT / DARK ramps, state tokens, spacing, type scale) — platform-agnostic, for React Native / desktop. |
| `imperial.ts` | Imperial constants (`IMPERIAL` obsidian/gold/ivory) as typed TS + re-exported semantic ramps. Non-DOM twin of `turbo.css` — must stay in sync with it. |
| `geometry.ts` | Parametric Islamic-geometry SVG renderers (`GEOMETRY_RENDERERS`: star8/star6/star12/rosette/lattice/mihrab/divider). Pure functions → usable on any platform. |
| `cartouche.ts` | Cartouche / rosette SVG builders (`cartoucheSvg`, `rosetteSvg`, `cartoucheClip`). |
| `content-registry.ts` | Content-template registry: 10 content types × 10 templates with structural specs (layout/aspect/bg/frame/meta/cta). Data, not code — portable. |
| `visual-config.ts` | Visual-experience schema types (`VisualConfig`, `Hero3DConfig`, …) shared with the backend contract. |

## Palette

Brand: **emerald dark green** primary, **gold** accent, **neutral gray**.

| Role | Scale | Hex ramp |
|---|---|---|
| Primary (emerald) 50–900 | `--ma-color-primary-*` | `#ecfdf5 → #d1fae5 → #a7f3d0 → #6ee7b7 → #34d399 → #10b981 → #059669 → #047857 → #065f46 → #064e3b` |
| Accent (gold) 100–700 | `--ma-color-accent-*` | `#fdf6e3 → #faedc4 → #f6e09a → #f1d070 → #e9b949 → #d19a2a → #a97a1c` |
| Neutral (gray) 50–900 | `--ma-color-neutral-*` | `#f8fafc → #f1f5f9 → #e2e8f0 → #cbd5e1 → #94a3b8 → #64748b → #475569 → #334155 → #1e293b → #0f172a` |

The raw scales are also exposed as `--ma-color-emerald-*`, `--ma-color-gold-*`,
`--ma-color-gray-*`; the `primary` / `accent` / `neutral` names are semantic
aliases over them, so a future rebrand only re-points the aliases.

### Semantic aliases (what components should use)

- `--ma-color-surface` (`#ffffff`), `--ma-color-surface-subtle` (neutral-50)
- `--ma-color-text` (neutral-900), `--ma-color-text-muted` (neutral-600)
- `--ma-color-border` (neutral-200)
- Status pairs (`bg` = 100 tint, `text` = 700 — both guaranteed AA, see table):
  `--ma-color-success-bg/text` (emerald), `--ma-color-info-bg/text` (blue),
  `--ma-color-warning-bg/text` (amber), `--ma-color-danger-bg/text` (red),
  `--ma-color-danger-solid` (danger-700, for filled destructive actions)

Status hues deliberately sit **off** the brand scales so a badge never reads
as brand color.

## Typography

- `--ma-font-body: "Vazirmatn", "Segoe UI", Tahoma, Arial, sans-serif`
  — Vazirmatn is the body workhorse: open-source, designed for Persian/Arabic
  with a matching Latin; Segoe UI/Tahoma/Arial are system fallbacks already
  present on Windows/macOS and common in ایران.
- `--ma-font-heading: "Lalezar", "Vazirmatn", "Segoe UI", Tahoma, sans-serif`
  — a **separate display face for key h1/h2**.

**Why Lalezar:** it is an Arabic+Latin *display* typeface (Borna Izadpanah,
Google Fonts) whose design brief was literally Persian-language poster
lettering from ایران's 1960s–70s Film-Farsi era — i.e. it was drawn for
Persian first and given a matching Latin companion, not the other way round.
It covers the Arabic script (fa/ar) and Latin, is open-source (OFL), and its
bold, ornamental character suits headings while Vazirmatn stays neutral for
body text. Fallback chain keeps headings readable if the webfont fails to
load (Lalezar → Vazirmatn → system fonts).

Size/weight/leading scales: `--ma-font-size-xs…3xl`, `--ma-font-weight-*`,
`--ma-leading-tight/snug/normal/relaxed`.

## Spacing / radii / shadows / focus

- `--ma-space-0…24` (4px base: 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96px as rem)
- `--ma-radius-sm/md/lg/xl/2xl/full` (4/8/12/16/24/9999px)
- `--ma-shadow-sm/md/lg`
- `--ma-focus-ring: 3px solid var(--ma-color-primary-500)` (+ `--ma-focus-ring-offset: 2px`)

## platform_settings override mapping

The backend exposes runtime theme overrides under `platform_settings` as
`theme.palette.<suffix>` and `theme.fonts.<name>`. The `<suffix>` maps 1:1 to
the token name after the `--ma-` prefix:

| Backend key | CSS custom property |
|---|---|
| `theme.palette.color-primary-700` | `--ma-color-primary-700` |
| `theme.palette.color-accent-500` | `--ma-color-accent-500` |
| `theme.palette.color-text` | `--ma-color-text` |
| `theme.palette.color-surface` | `--ma-color-surface` |
| `theme.fonts.font-body` | `--ma-font-body` |
| `theme.fonts.font-heading` | `--ma-font-heading` |

Rule: strip the `theme.palette.` / `theme.fonts.` prefix, prepend `--ma-`.
Only these presentation keys are overridable; secrets stay in the secrets
flow (contract §3) and never in theme settings.

## Consumption

**Web (`@maturidi/ui-web`, `apps/web`, `apps/crm`):** import once at the app
root (or via `@maturidi/ui-web/src/tokens.css`, which re-exports it):

```css
@import "@maturidi/design-tokens/tokens.css";
```

then reference values with a fallback so components also render standalone:

```css
.my-button {
  background: var(--ma-color-primary-700, #047857);
  border-radius: var(--ma-radius-lg, 12px);
  font-family: var(--ma-font-body, sans-serif);
}
```

**React Native (`@maturidi/ui-native`):**

```ts
import { tokens } from "@maturidi/design-tokens";

const styles = {
  button: { backgroundColor: tokens.color.primary[700], borderRadius: tokens.radius.lg },
  title: { fontFamily: "Lalezar" }, // load via expo-font / react-native config
};
```

> Note: `tokens.ts` font stacks are strings for documentation; on native,
> load the actual font files (Vazirmatn, Lalezar — both OFL) and reference
> them by family name.

**Imperial system (ported turbo UI) — multi-platform:**

| Platform | Entry | Usage |
|---|---|---|
| Web | `turbo.css` | `@import "@maturidi/design-tokens/turbo.css";` then `hsl(var(--text-primary))`, `var(--gold-2)`, … |
| React Native / desktop (Tauri) | `imperial.ts` + `semantic.ts` | `import { IMPERIAL, SEMANTIC_DARK } from "@maturidi/design-tokens/imperial";` — same values, no DOM. |
| Any | `geometry.ts` / `cartouche.ts` | `GEOMETRY_RENDERERS.star8({size: 64, color: "#D4AF37"})` returns an SVG string — embed in WebView, SVG view, or `<img src="data:…">`. |
| Any | `content-registry.ts` | `TEMPLATE_SPECS[type][template]` drives card rendering per platform; the registry is data, not web code. |

Sync rule: `turbo.css` ↔ `imperial.ts` must carry identical values
(same discipline as `tokens.css` ↔ `tokens.ts`).

## WCAG 2.2 AA contrast

Ratios computed per WCAG (sRGB → relative luminance). AA requires ≥ 4.5:1
for normal text, ≥ 3:1 for large text (≥ 18pt / 14pt bold). Every default
text/background pair below passes AA for normal text:

| Text | On background | Ratio | Verdict |
|---|---|---|---|
| `--ma-color-text` `#0f172a` | `--ma-color-surface` `#ffffff` | 17.9:1 | ✅ AAA |
| `--ma-color-text-muted` `#475569` | `#ffffff` | 7.6:1 | ✅ AA |
| `#ffffff` (button label) | `--ma-color-primary-700` `#047857` | 5.5:1 | ✅ AA |
| `#ffffff` (button label) | `--ma-color-danger-solid` `#b91c1c` | 6.5:1 | ✅ AA |
| `--ma-color-text-muted` `#475569` | neutral-100 `#f1f5f9` (secondary btn) | 6.9:1 | ✅ AA |
| `--ma-color-success-text` `#065f46` | `--ma-color-success-bg` `#d1fae5` | 6.8:1 | ✅ AA |
| `--ma-color-info-text` `#1d4ed8` | `--ma-color-info-bg` `#dbeafe` | 5.5:1 | ✅ AA |
| `--ma-color-warning-text` `#b45309` | `--ma-color-warning-bg` `#fef3c7` | 4.5:1 | ✅ AA (at the floor — keep ≥ 12px) |
| `--ma-color-danger-text` `#b91c1c` | `--ma-color-danger-bg` `#fee2e2` | 5.3:1 | ✅ AA |
| `--ma-color-accent-300` `#f6e09a` | `--ma-color-primary-900` `#064e3b` (dark hero) | 7.4:1 | ✅ AA |
| `--ma-color-accent-700` `#a97a1c` | `#ffffff` | 3.8:1 | ⚠️ large text / decorative only |

Rule of thumb: gold (`--ma-color-accent-700`) on light surfaces is for
large headings or non-text decoration only — never body copy. Borders and
hairlines (`--ma-color-border`) are non-text and exempt.

## Motion policy

Decorative motion is opt-out safe: `tokens.css` ships
`@media (prefers-reduced-motion: reduce)` that collapses all
animations/transitions to `0.01ms`. Components must not re-introduce motion
under that media query.

## Hard rules for this package

1. Values change here, nowhere else. Components use `var(--ma-*, fallback)`.
2. No business logic, no user-visible strings (always `LocalizedText` at the app layer), no fiqh rules, no secrets — §15.
3. Adding/removing a token is a contract change: note it here and keep
   `tokens.css` ↔ `tokens.ts` in sync.
