/**
 * @maturidi/ui-native — Card.tsx
 *
 * Presentational only. Mirrors `@maturidi/ui-web` Card / CardHeader /
 * CardTitle / CardContent.
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
import { common, fontFamily, fontSize, fontWeight, palette, radius, shadow, spacing } from "./rn-theme";

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({ children, style, testID }: CardProps): React.JSX.Element {
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function CardHeader({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return <View style={[styles.header, style]}>{children}</View>;
}

export function CardTitle({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}): React.JSX.Element {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function CardContent({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return <View style={[styles.content, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: common.border,
    padding: spacing[4],
    ...shadow("sm"),
  },
  header: { marginBottom: spacing[2] },
  title: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize.xl,
    color: common.textPrimary,
    fontWeight: fontWeight.bold,
  },
  content: { gap: spacing[2] },
});
