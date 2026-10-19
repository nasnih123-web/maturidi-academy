/**
 * @maturidi/ui-native — EmptyState.tsx
 *
 * Presentational only: centered message for empty lists / errors.
 */
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { common, fontFamily, fontSize, spacing } from "./rn-theme";
import { Button } from "./Button";

export interface EmptyStateProps {
  title: string;
  message?: string;
  actionTitle?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ title, message, actionTitle, onAction, style }: EmptyStateProps): React.JSX.Element {
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionTitle && onAction ? (
        <Button title={actionTitle} onPress={onAction} variant="secondary" size="sm" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", padding: spacing[6], gap: spacing[2] },
  title: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.lg, color: common.textPrimary },
  message: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.sm,
    color: common.textMuted,
    textAlign: "center",
  },
});
