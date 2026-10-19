/**
 * @maturidi/ui-native — ProgressBar.tsx
 *
 * Presentational only: horizontal progress indicator (0..1).
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { common, palette, radius, spacing } from "./rn-theme";

export interface ProgressBarProps {
  value: number;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({ value, style }: ProgressBarProps): React.JSX.Element {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <View
      style={[styles.track, style]}
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: palette.gray[200],
    overflow: "hidden",
    marginVertical: spacing[1],
  },
  fill: { height: "100%", backgroundColor: common.primary, borderRadius: radius.full },
});
