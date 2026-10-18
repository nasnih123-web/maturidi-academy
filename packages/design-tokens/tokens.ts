/**
 * @maturidi/design-tokens — tokens.ts
 *
 * The same design tokens as `tokens.css`, exported as a typed object for
 * React Native (and any other non-DOM consumer). Values MUST stay in sync
 * with `tokens.css` — that file is the source of truth; this file is a
 * mechanical mirror of it.
 *
 * No business logic — pure presentation data (§15, ADR 0002).
 */

const emerald = {
  50: "#ecfdf5",
  100: "#d1fae5",
  200: "#a7f3d0",
  300: "#6ee7b7",
  400: "#34d399",
  500: "#10b981",
  600: "#059669",
  700: "#047857",
  800: "#065f46",
  900: "#064e3b",
} as const;

const gold = {
  100: "#fdf6e3",
  200: "#faedc4",
  300: "#f6e09a",
  400: "#f1d070",
  500: "#e9b949",
  600: "#d19a2a",
  700: "#a97a1c",
} as const;

const gray = {
  50: "#f8fafc",
  100: "#f1f5f9",
  200: "#e2e8f0",
  300: "#cbd5e1",
  400: "#94a3b8",
  500: "#64748b",
  600: "#475569",
  700: "#334155",
  800: "#1e293b",
  900: "#0f172a",
} as const;

export const tokens = {
  color: {
    /** Base scales (mirror `--ma-color-emerald-*` etc.) */
    emerald,
    gold,
    gray,
    /** Semantic aliases (mirror `--ma-color-primary-*` etc.) */
    primary: emerald,
    accent: gold,
    neutral: gray,
    /** Status hues */
    info: { 100: "#dbeafe", 700: "#1d4ed8" },
    warning: { 100: "#fef3c7", 700: "#b45309" },
    danger: { 100: "#fee2e2", 700: "#b91c1c" },
    /** Surfaces & text — default pairs pass WCAG 2.2 AA (see README) */
    surface: "#ffffff",
    surfaceSubtle: gray[50],
    text: gray[900],
    textMuted: gray[600],
    border: gray[200],
    /** Status pairs: bg = 100 tint, text = 700 */
    success: { bg: emerald[100], text: emerald[800] },
    infoText: { bg: "#dbeafe", text: "#1d4ed8" },
    warningText: { bg: "#fef3c7", text: "#b45309" },
    dangerText: { bg: "#fee2e2", text: "#b91c1c" },
    dangerSolid: "#b91c1c",
  },
  font: {
    body: '"Vazirmatn", "Segoe UI", Tahoma, Arial, sans-serif',
    /** Display face for key h1/h2 — Lalezar covers Arabic script (fa/ar) + Latin */
    heading: '"Lalezar", "Vazirmatn", "Segoe UI", Tahoma, sans-serif',
    size: {
      xs: 12,
      sm: 13,
      base: 14,
      lg: 16,
      xl: 20,
      "2xl": 24,
      "3xl": 32,
    },
    weight: {
      normal: "400",
      medium: "500",
      semibold: "600",
      bold: "700",
    } as const,
  },
  space: {
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48,
    16: 64,
    20: 80,
    24: 96,
  } as const,
  radius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    "2xl": 24,
    full: 9999,
  } as const,
  /** Reference only — on React Native apply shadows via the shadow* style props. */
  shadow: {
    sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
    md: "0 4px 12px rgba(15, 23, 42, 0.08)",
    lg: "0 12px 32px rgba(15, 23, 42, 0.12)",
  } as const,
} as const;

export type Tokens = typeof tokens;
