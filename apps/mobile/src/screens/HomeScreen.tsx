/**
 * apps/mobile — src/screens/HomeScreen.tsx
 *
 * Home: renders the CMS-driven sections from GET /api/v1/home/sections —
 * the same contract the web storefront consumes (parity by construction).
 */
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Card, CardTitle, common, EmptyState, fontFamily, fontSize, Screen, spacing } from "@maturidi/ui-native";
import { useHomeSections } from "../hooks/useHome";
import { useAuth, useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";
import { resolveText, type HomeSection } from "../types";

function SectionBody({ section, locale }: { section: HomeSection; locale: "fa" | "ar" | "en" }): React.JSX.Element {
  const data = section.data ?? {};
  const items = Array.isArray((data as { items?: unknown }).items)
    ? ((data as { items: unknown[] }).items as Record<string, unknown>[])
    : [];
  if (items.length === 0) {
    return <Text style={styles.muted}>{t("common.emptyTitle", locale)}</Text>;
  }
  return (
    <View style={styles.items}>
      {items.slice(0, 5).map((item, i) => {
        const title = item.title ?? item.name ?? item.question ?? "";
        return (
          <Text key={String(item.id ?? i)} style={styles.item} numberOfLines={2}>
            {"• "}
            {resolveText(title as never, locale) || String(title)}
          </Text>
        );
      })}
    </View>
  );
}

export function HomeScreen(): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { user } = useAuth();
  const { data: sections, loading, error, refresh } = useHomeSections();

  return (
    <Screen
      title={t("home.title", locale)}
      subtitle={user ? `${t("auth.welcomeBack", locale)} ${user.full_name}` : t("home.subtitle", locale)}
      refreshing={loading}
      onRefresh={refresh}
    >
      {loading && !sections ? (
        <ActivityIndicator size="large" color={common.primary} />
      ) : error ? (
        <EmptyState title={t("common.errorTitle", locale)} message={error} actionTitle={t("common.retry", locale)} onAction={refresh} />
      ) : sections && sections.length > 0 ? (
        sections.map((s) => (
          <Card key={s.key}>
            <CardTitle>{resolveText(s.title, locale)}</CardTitle>
            {s.subtitle ? <Text style={styles.muted}>{resolveText(s.subtitle, locale)}</Text> : null}
            <SectionBody section={s} locale={locale} />
          </Card>
        ))
      ) : (
        <EmptyState title={t("common.emptyTitle", locale)} actionTitle={t("home.refresh", locale)} onAction={refresh} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted },
  items: { gap: spacing[1], marginTop: spacing[2] },
  item: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary },
});
