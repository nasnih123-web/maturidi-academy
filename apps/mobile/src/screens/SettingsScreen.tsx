/**
 * apps/mobile — src/screens/SettingsScreen.tsx
 *
 * Settings: account, language, push preference, manual sync, about.
 */
import React, { useState } from "react";
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import {
  Button,
  Card,
  CardTitle,
  common,
  fontFamily,
  fontSize,
  Screen,
  SectionHeader,
  spacing,
} from "@maturidi/ui-native";
import { useAuth, useEffectiveLocale } from "../hooks/useAuth";
import { useSettings } from "../hooks/useSettings";
import { useSyncStatus } from "../hooks/useSync";
import { apiBaseUrl, APP_VERSION } from "../lib/config";
import { t, supportedLocales } from "../i18n/strings";
import type { Locale } from "../types";

export function SettingsScreen(): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { user, logout, busy } = useAuth();
  const { locale: storedLocale, pushEnabled, saving, changeLocale, changePush } = useSettings();
  const { pending, syncing, lastReport, sync } = useSyncStatus();
  const [switchingLocale, setSwitchingLocale] = useState<Locale | null>(null);

  const onLocale = async (l: Locale): Promise<void> => {
    setSwitchingLocale(l);
    await changeLocale(l);
    setSwitchingLocale(null);
  };

  const confirmLogout = (): void => {
    Alert.alert(t("auth.logout", locale), t("auth.logoutConfirm", locale), [
      { text: t("common.cancel", locale), style: "cancel" },
      { text: t("auth.logout", locale), style: "destructive", onPress: () => logout() },
    ]);
  };

  return (
    <Screen title={t("settings.title", locale)} subtitle={t("settings.subtitle", locale)}>
      <Card>
        <SectionHeader title={t("settings.account", locale)} />
        <View style={styles.kv}>
          <Text style={styles.k}>{t("settings.name", locale)}</Text>
          <Text style={styles.v}>{user?.full_name ?? "—"}</Text>
        </View>
        <View style={styles.kv}>
          <Text style={styles.k}>{t("settings.email", locale)}</Text>
          <Text style={styles.v}>{user?.email ?? "—"}</Text>
        </View>
        <View style={styles.kv}>
          <Text style={styles.k}>{t("settings.phone", locale)}</Text>
          <Text style={styles.v}>{user?.phone ?? "—"}</Text>
        </View>
      </Card>

      <Card>
        <SectionHeader title={t("settings.language", locale)} />
        <View style={styles.chips}>
          {supportedLocales.map((l) => (
            <TouchableOpacity
              key={l.code}
              onPress={() => onLocale(l.code)}
              disabled={switchingLocale != null}
              style={[styles.chip, storedLocale === l.code && styles.chipOn]}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, storedLocale === l.code && styles.chipTextOn]}>{l.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      <Card>
        <SectionHeader title={t("settings.notifications", locale)} />
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>{t("settings.pushEnabled", locale)}</Text>
            <Text style={styles.hint}>{t("settings.pushHint", locale)}</Text>
          </View>
          <Switch value={pushEnabled} onValueChange={changePush} disabled={saving} />
        </View>
      </Card>

      <Card>
        <SectionHeader title={t("settings.sync", locale)} />
        <View style={styles.row}>
          <Text style={styles.label}>
            {syncing
              ? t("settings.syncing", locale)
              : pending > 0
                ? `${t("settings.pendingOps", locale)}: ${pending}`
                : t("settings.syncIdle", locale)}
          </Text>
        </View>
        {lastReport ? (
          <Text style={styles.hint}>
            ✓ {lastReport.accepted} · ✕ {lastReport.conflicts} · ↓ {lastReport.applied} · 🗑 {lastReport.tombstones}
          </Text>
        ) : null}
        <Button title={t("settings.syncNow", locale)} variant="secondary" onPress={sync} loading={syncing} />
      </Card>

      <Card>
        <SectionHeader title={t("settings.about", locale)} />
        <View style={styles.kv}>
          <Text style={styles.k}>{t("settings.version", locale)}</Text>
          <Text style={styles.v}>{APP_VERSION}</Text>
        </View>
        <View style={styles.kv}>
          <Text style={styles.k}>{t("settings.apiUrl", locale)}</Text>
          <Text style={styles.v}>{apiBaseUrl()}</Text>
        </View>
      </Card>

      <Card>
        <CardTitle>{t("auth.logout", locale)}</CardTitle>
        <Button title={t("auth.logout", locale)} variant="danger" onPress={confirmLogout} loading={busy} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing[1] },
  k: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted },
  v: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textPrimary },
  chips: { flexDirection: "row", gap: spacing[2] },
  chip: { borderWidth: 1, borderColor: common.border, borderRadius: 9999, paddingVertical: 8, paddingHorizontal: 16 },
  chipOn: { backgroundColor: common.primary, borderColor: common.primary },
  chipText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary },
  chipTextOn: { color: "#fff" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  rowText: { flex: 1, gap: 2 },
  label: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary },
  hint: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted },
});
