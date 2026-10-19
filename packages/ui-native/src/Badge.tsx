/**
 * @maturidi/ui-native — Badge.tsx
 *
 * Presentational only. Mirrors `@maturidi/ui-web` Badge tones.
 */
import React from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from "./rn-theme";

export type BadgeTone = "success" | "info" | "warning" | "danger" | "neutral";

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const tones: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: palette.success.bg, fg: palette.success.text },
  info: { bg: palette.infoText.bg, fg: palette.infoText.text },
  warning: { bg: palette.warningText.bg, fg: palette.warningText.text },
  danger: { bg: palette.dangerText.bg, fg: palette.dangerText.text },
  neutral: { bg: palette.gray[100], fg: palette.gray[700] },
};

export function Badge({ label, tone = "neutral", style, textStyle }: BadgeProps): React.JSX.Element {
  const t = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }, style]}>
      <Text style={[styles.text, { color: t.fg }, textStyle]}>{label}</Text>
    </View>
  );
}

/** Map a workflow status string to a badge tone (pure presentation mapping). */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "published":
    case "approved":
    case "completed":
    case "active":
      return "success";
    case "in_review":
    case "in_progress":
    case "pending":
      return "warning";
    case "rejected":
    case "failed":
    case "archived":
      return "danger";
    case "draft":
      return "neutral";
    default:
      return "info";
  }
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingVertical: spacing[1] / 2,
    paddingHorizontal: spacing[2],
  },
  text: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
});
