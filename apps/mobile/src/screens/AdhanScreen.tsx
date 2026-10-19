/**
 * apps/mobile — src/screens/AdhanScreen.tsx
 *
 * Prayer times + local reminder scheduling. Times come from the server
 * (GET /api/v1/adhan/times); reminders are LOCAL notifications scheduled
 * via services/push (they work without FCM).
 */
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  common,
  EmptyState,
  fontFamily,
  fontSize,
  Screen,
  SectionHeader,
  spacing,
} from "@maturidi/ui-native";
import { useAdhanTimes } from "../hooks/useAdhan";
import { useEffectiveLocale } from "../hooks/useAuth";
import { cancelAdhanReminders, scheduleAdhanReminders } from "../services/push";
import { t, type I18nKey } from "../i18n/strings";
import type { PrayerKey } from "../types";

const PRAYERS: { key: PrayerKey; labelKey: I18nKey }[] = [
  { key: "imsak", labelKey: "adhan.imsak" },
  { key: "fajr", labelKey: "adhan.fajr" },
  { key: "sunrise", labelKey: "adhan.sunrise" },
  { key: "dhuhr", labelKey: "adhan.dhuhr" },
  { key: "asr", labelKey: "adhan.asr" },
  { key: "maghrib", labelKey: "adhan.maghrib" },
  { key: "isha", labelKey: "adhan.isha" },
  { key: "midnight", labelKey: "adhan.midnight" },
];

const METHODS = ["mwl", "makkah", "egypt", "karachi", "isna", "jafari"];

export function AdhanScreen(): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { times, offline, loading, error, load, coords, useTehran } = useAdhanTimes();
  const [method, setMethod] = useState("mwl");
  const [madhab, setMadhab] = useState<"hanafi" | "shafi">("hanafi");
  const [remindersOn, setRemindersOn] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const reload = (): Promise<void> => load(coords.lat, coords.lng, { method, madhab, tz: 3.5 });

  const toggleReminders = async (): Promise<void> => {
    if (remindersOn) {
      await cancelAdhanReminders();
      setRemindersOn(false);
      return;
    }
    if (!times) return;
    setScheduling(true);
    try {
      const titles = Object.fromEntries(PRAYERS.map((p) => [p.key, t(p.labelKey, locale)])) as Record<
        PrayerKey,
        string
      >;
      const n = await scheduleAdhanReminders(times, titles, t("adhan.title", locale));
      setRemindersOn(n > 0);
    } finally {
      setScheduling(false);
    }
  };

  return (
    <Screen title={t("adhan.title", locale)} subtitle={t("adhan.subtitle", locale)} refreshing={loading} onRefresh={reload}>
      <Card>
        <SectionHeader title={t("adhan.method", locale)} />
        <View style={styles.chips}>
          {METHODS.map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => {
                setMethod(m);
                load(coords.lat, coords.lng, { method: m, madhab, tz: 3.5 });
              }}
              style={[styles.chip, method === m && styles.chipOn]}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, method === m && styles.chipTextOn]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <SectionHeader title={t("adhan.madhab", locale)} />
        <View style={styles.chips}>
          {(["hanafi", "shafi"] as const).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => {
                setMadhab(m);
                load(coords.lat, coords.lng, { method, madhab: m, tz: 3.5 });
              }}
              style={[styles.chip, madhab === m && styles.chipOn]}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, madhab === m && styles.chipTextOn]}>
                {t(m === "hanafi" ? "adhan.madhabHanafi" : "adhan.madhabShafii", locale)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Button title={t("adhan.useTehran", locale)} variant="secondary" size="sm" onPress={useTehran} />
      </Card>

      {loading && !times ? (
        <ActivityIndicator size="large" color={common.primary} />
      ) : error ? (
        <EmptyState title={t("common.errorTitle", locale)} message={error} actionTitle={t("common.retry", locale)} onAction={reload} />
      ) : times ? (
        <Card>
          <View style={styles.headRow}>
            <CardTitle>{times.method_label || times.method}</CardTitle>
            {offline ? <Badge label={t("common.offline", locale)} tone="warning" /> : null}
          </View>
          {PRAYERS.map((p) => (
            <View key={p.key} style={styles.row}>
              <Text style={styles.label}>{t(p.labelKey, locale)}</Text>
              <Text style={styles.time}>{times.times[p.key]}</Text>
            </View>
          ))}
          <Button
            title={t("adhan.remindMe", locale)}
            variant={remindersOn ? "secondary" : "primary"}
            onPress={toggleReminders}
            loading={scheduling}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], marginBottom: spacing[3] },
  chip: { borderWidth: 1, borderColor: common.border, borderRadius: 9999, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: common.primary, borderColor: common.primary },
  chipText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textPrimary },
  chipTextOn: { color: "#fff" },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: common.border,
  },
  label: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary },
  time: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.primary },
});
