/**
 * @maturidi/ui-native — Button.tsx
 *
 * Presentational only. Mirrors the variant/size API of `@maturidi/ui-web`
 * Button so the two kits stay interchangeable for a future UI rebuild.
 */
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { common, fontFamily, fontSize, fontWeight, palette, radius, spacing } from "./rn-theme";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
}

const variantStyles: Record<ButtonVariant, { container: ViewStyle; text: TextStyle }> = {
  primary: {
    container: { backgroundColor: common.primary, borderColor: common.primary },
    text: { color: palette.surface },
  },
  secondary: {
    container: { backgroundColor: palette.gray[100], borderColor: palette.border },
    text: { color: palette.text },
  },
  danger: {
    container: { backgroundColor: palette.dangerSolid, borderColor: palette.dangerSolid },
    text: { color: palette.surface },
  },
  ghost: {
    container: { backgroundColor: "transparent", borderColor: "transparent" },
    text: { color: common.primary },
  },
};

const sizeStyles: Record<ButtonSize, { container: ViewStyle; text: TextStyle }> = {
  sm: {
    container: { paddingVertical: spacing[1], paddingHorizontal: spacing[3] },
    text: { fontSize: fontSize.sm },
  },
  md: {
    container: { paddingVertical: spacing[2], paddingHorizontal: spacing[4] },
    text: { fontSize: fontSize.base },
  },
  lg: {
    container: { paddingVertical: spacing[3], paddingHorizontal: spacing[6] },
    text: { fontSize: fontSize.lg },
  },
};

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  style,
  textStyle,
  testID,
}: ButtonProps): React.JSX.Element {
  const v = variantStyles[variant];
  const s = sizeStyles[size];
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      style={[
        styles.base,
        v.container,
        s.container,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" || variant === "danger" ? palette.surface : common.primary}
        />
      ) : (
        <Text style={[styles.text, v.text, s.text, textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  text: {
    fontFamily: fontFamily.bodyFa,
    fontWeight: fontWeight.semibold,
    textAlign: "center",
  },
  disabled: { opacity: 0.55 },
});
