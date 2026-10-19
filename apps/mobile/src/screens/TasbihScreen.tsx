/**
 * apps/mobile — src/screens/TasbihScreen.tsx
 *
 * Dhikr counter. Presentational: counting state lives in hooks/useTasbih.
 * Dhikr presets are common, well-known phrases offered as shortcuts — the
 * user can type any dhikr; the app never invents fiqh content.
 */
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  Button,
  Card,
  CardTitle,
  common,
  fontFamily,
  fontSize,
  ProgressBar,
  Screen,
  SectionHeader,
  spacing,
  TextField,
} from "@maturidi/ui-native";
import { useTasbih } from "../hooks/useTasbih";
import { useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";

const PRESETS = ["سبحان‌الله", "الحمدلله", "الله‌اکبر", "استغفرالله", "لا إله إلا الله"];

export function TasbihScreen(): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { session, totals, starting, error, start, tap, reset } = useTasbih();
  const [dhikr, setDhikr] = useState(PRESETS[0] ?? "");
  const [target, setTarget] = useState("100");

  const targetNum = Number.parseInt(target, 10);
  const progress = session?.target_count ? Math.min(1, session.count / session.target_count) : 0;
  const done = session?.target_count != null && session.count >= session.target_count;

  return (
    <Screen title={t("tasbih.title", locale)} subtitle={t("tasbih.subtitle", locale)} scroll={false}>
      {!session ? (
        <Card>
          <CardTitle>{t("tasbih.startSession", locale)}</CardTitle>
          <TextField label={t("tasbih.dhikr", locale)} value={dhikr} onChangeText={setDhikr} placeholder={t("tasbih.dhikrPlaceholder", locale)} />
          <TextField
            label={t("tasbih.target", locale)}
            value={target}
            onChangeText={setTarget}
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <SectionHeader title={t("tasbih.presets", locale)} />
          <View style={styles.presets}>
            {PRESETS.map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setDhikr(p)}
                style={[styles.preset, dhikr === p && styles.presetOn]}
                accessibilityRole="button"
              >
                <Text style={[styles.presetText, dhikr === p && styles.presetTextOn]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title={t("tasbih.startSession", locale)}
            onPress={() => start(dhikr.trim(), Number.isNaN(targetNum) ? undefined : targetNum)}
            loading={starting}
          />
        </Card>
      ) : (
        <View style={styles.counterWrap}>
          <Text style={styles.dhikrText}>{session.dhikr_text}</Text>
          <TouchableOpacity
            onPress={tap}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t("tasbih.tapToCount", locale)}
            style={styles.tapCircle}
            testID="tasbih-tap"
          >
            <Text style={styles.countText}>{session.count}</Text>
            <Text style={styles.tapHint}>{t("tasbih.tapToCount", locale)}</Text>
          </TouchableOpacity>
          {session.target_count ? (
            <View style={styles.progressWrap}>
              <ProgressBar value={progress} />
              <Text style={styles.muted}>
                {session.count} / {session.target_count}
              </Text>
            </View>
          ) : null}
          {done ? <Text style={styles.done}>{t("tasbih.sessionCompleted", locale)}</Text> : null}
          <Button title={t("tasbih.newSession", locale)} variant="secondary" onPress={reset} />
        </View>
      )}
      <Card>
        <CardTitle>
          {t("tasbih.today", locale)} — {t("tasbih.totalCount", locale)}
        </CardTitle>
        {totals.length === 0 ? (
          <Text style={styles.muted}>{t("common.emptyTitle", locale)}</Text>
        ) : (
          totals.map((tot) => (
            <View key={tot.dhikr_text} style={styles.totalRow}>
              <Text style={styles.totalText}>{tot.dhikr_text}</Text>
              <Text style={styles.totalNum}>{tot.total_count}</Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  presets: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  preset: { borderWidth: 1, borderColor: common.border, borderRadius: 9999, paddingVertical: 6, paddingHorizontal: 12 },
  presetOn: { backgroundColor: common.primary, borderColor: common.primary },
  presetText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textPrimary },
  presetTextOn: { color: "#fff" },
  error: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: "#b91c1c", textAlign: "center" },
  counterWrap: { alignItems: "center", gap: spacing[4], paddingVertical: spacing[4] },
  dhikrText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize["2xl"], color: common.textPrimary },
  tapCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: common.primary,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
  },
  countText: { fontFamily: fontFamily.bodyFa, fontSize: 56, color: "#fff" },
  tapHint: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: "#e2e8f0" },
  progressWrap: { width: "100%", gap: spacing[1] },
  muted: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted, textAlign: "center" },
  done: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.lg, color: common.primary },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing[1] },
  totalText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary },
  totalNum: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.primary },
});
