/**
 * @maturidi/ui-native — SectionHeader.tsx
 *
 * Presentational only: section title row with an optional action link.
 */
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { common, fontFamily, fontSize, fontWeight, spacing } from "./rn-theme";

export interface SectionHeaderProps {
  title: string;
  actionTitle?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, actionTitle, onAction }: SectionHeaderProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {actionTitle && onAction ? (
        <TouchableOpacity onPress={onAction} accessibilityRole="button">
          <Text style={styles.action}>{actionTitle}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[2],
  },
  title: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: common.textPrimary,
  },
  action: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.sm,
    color: common.primary,
    fontWeight: fontWeight.semibold,
  },
});
