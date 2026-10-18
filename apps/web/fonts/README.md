# Self-hosted fonts (OFL)

- **Vazirmatn** (400/500/700, arabic+latin) — body face, `--font-main`.
  https://github.com/rastikerdar/vazirmatn — SIL Open Font License 1.1
- **Lalezar** (400, arabic+latin) — display face for headings, `--font-display`
  (per `@maturidi/design-tokens` README). https://github.com/google/fonts
  (ofl/lalezar) — SIL Open Font License 1.1

Loaded via `@font-face` in `app/[locale]/globals.css` with
`font-display: swap` (family names `"Vazirmatn"` / `"Lalezar"`, split
arabic/latin subsets via `unicode-range`), served from `public/fonts/` —
so the production build never needs network access (offline-safe) and
pages make no third-party font requests. The originals are kept here in
`fonts/` as the source of truth.
