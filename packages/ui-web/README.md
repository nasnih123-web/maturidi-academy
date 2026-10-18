# ‎@maturidi/ui-web

Shared React (DOM) components for the platform's web clients — used by
`apps/web` and `apps/crm` (and later the Tauri desktop webview).

Phase 2 scaffold provides three minimal, dependency-free components:

- `Button` — variants `primary | secondary | danger | ghost`, sizes `sm | md | lg`, `loading` state
- `Card` (+ `CardHeader`, `CardTitle`, `CardContent`)
- `Badge` — tones `neutral | info | success | warning | danger`, plus `statusTone()`
  mapping the §9 shared content-workflow states (`draft → in_review → approved → published`,
  `rejected` / `archived`) to tones

No CSS framework, no runtime dependencies — styling is inline so the package
works in any bundler without extra config. Heavier component work lands in
later phases.

## Theming

All components read the `@maturidi/design-tokens` layer through
`var(--ma-*, <fallback>)` — component APIs are unchanged. The fallbacks are
the pre-token values, so components render correctly even standalone, but the
brand identity (emerald primary, gold accent, Vazirmatn/Lalezar type) applies
once the token layer is loaded. Import once at the app root:

```css
/* your app entry css */
@import "@maturidi/ui-web/src/tokens.css"; /* re-exports @maturidi/design-tokens/tokens.css */
```

Runtime theme overrides (`platform_settings` keys `theme.palette.<suffix>` /
`theme.fonts.<name>`) map 1:1 onto `--ma-<suffix>` — see
`packages/design-tokens/README.md` for the mapping table and the WCAG 2.2 AA
contrast table.
