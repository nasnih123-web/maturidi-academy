/**
 * @maturidi/ui-native — rn-theme.ts
 *
 * React Native–ready theme derived from `@maturidi/design-tokens/tokens`
 * (the CSS file stays the source of truth; this module is a typed accessor).
 *
 * Font families are the logical names from the token contract
 * ("Vazirmatn" for fa, "Cairo" for ar, "Inter" for en). The mobile app is
 * responsible for bundling the actual TTF/OTF files and registering them
 * under these names (see apps/mobile/README.md "Fonts"). When a family is
 * not bundled, React Native silently falls back to the system font.
 *
 * No business logic — pure presentation (§15, ADR 0002).
 */
import { tokens } from "@maturidi/design-tokens/tokens";
import type { ViewStyle } from "react-native";

export const palette = tokens.color;
export const spacing = tokens.space;
export const fontSize = tokens.font.size;
export const fontWeight = tokens.font.weight;
export const radius = tokens.radius;

/** Logical font families — must match the names registered via expo-font. */
export const fontFamily = {
  bodyFa: "Vazirmatn",
  bodyAr: "Cairo",
  bodyEn: "Inter",
  heading: "Lalezar",
} as const;

export type FontFamilyKey = keyof typeof fontFamily;

/**
 * React Native shadow preset (the token contract ships CSS box-shadows;
 * on native they must be expressed via shadow* props + elevation).
 */
export function shadow(level: "sm" | "md" | "lg" = "sm"): ViewStyle {
  switch (level) {
    case "lg":
      return {
        shadowColor: "#0f172a",
        shadowOpacity: 0.16,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      };
    case "md":
      return {
        shadowColor: "#0f172a",
        shadowOpacity: 0.1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      };
    default:
      return {
        shadowColor: "#0f172a",
        shadowOpacity: 0.06,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 2,
      };
  }
}

/** Common one-off style values shared by the kit components. */
export const common = {
  screenBackground: palette.surface,
  textPrimary: palette.text,
  textMuted: palette.textMuted,
  border: palette.border,
  primary: palette.primary[700],
  primaryDark: palette.primary[800],
  accent: palette.accent[500],
} as const;
