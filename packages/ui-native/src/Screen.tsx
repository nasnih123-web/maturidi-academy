/**
 * @maturidi/ui-native — Screen.tsx
 *
 * Presentational screen scaffold: safe-area aware container with optional
 * scroll, header title and pull-to-refresh wiring. Holds no data logic.
 */
import React from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { common, fontFamily, fontSize, fontWeight, palette, spacing } from "./rn-theme";

export interface ScreenProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Screen({
  title,
  subtitle,
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
  contentStyle,
  testID,
}: ScreenProps): React.JSX.Element {
  const body = (
    <View style={[styles.content, contentStyle]} testID={testID}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={common.primary} />
            ) : undefined
          }
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: common.screenBackground },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, padding: spacing[4], gap: spacing[3] },
  title: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize["3xl"],
    color: common.textPrimary,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.sm,
    color: common.textMuted,
    marginTop: -spacing[2],
  },
});
