/**
 * @maturidi/design-tokens — imperial.ts
 *
 * Imperial Islamic Luxury system as a typed, platform-agnostic TS module.
 * This is the non-DOM twin of `turbo.css`: React Native (`packages/ui-native`)
 * and the Tauri desktop shell consume these values directly, while web
 * consumes the identical values as CSS custom properties from `turbo.css`.
 *
 * SYNC DISCIPLINE: values here MUST stay identical to `turbo.css`.
 * `turbo.css` is the source of truth for the exact values; this file is a
 * mechanical mirror (same rule as `tokens.ts` ↔ `tokens.css`).
 *
 * The semantic color ramps (light/dark) live in `./semantic` (LIGHT / DARK);
 * geometry renderers in `./geometry`; cartouche/rosette in `./cartouche`;
 * content-template registry in `./content-registry`; visual-experience
 * schema in `./visual-config`. This module adds the imperial constants that
 * `turbo.css` defines outside the semantic ramps.
 *
 * No business logic — pure presentation data (§15, ADR 0002).
 */

export const IMPERIAL = {
  /** Obsidian greens — page/canvas depths */
  obsidian: {
    0: "#04100d",
    1: "#081c16",
  },
  /** Imperial golds */
  gold: {
    1: "#e5c07b",
    2: "#d4af37",
    3: "#996515",
  },
  /** Warm ivory for display text on dark */
  ivory: "#ede6d6",
  /** Emerald glassmorphism fill */
  emeraldGlass: "rgba(7, 35, 28, 0.75)",
  /** Canonical gold glow shadow */
  goldGlow: "0 0 15px rgba(212, 175, 55, 0.25)",
} as const;

export type Imperial = typeof IMPERIAL;

/** Re-export the semantic ramps under explicit names for non-DOM consumers. */
export { LIGHT as SEMANTIC_LIGHT, DARK as SEMANTIC_DARK } from "./semantic";
export type { SemanticColors, ThemeName } from "./semantic";
