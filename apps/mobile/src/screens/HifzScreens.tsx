/**
 * apps/mobile — src/screens/HifzScreens.tsx
 *
 * Native Hifz study page (R-15: mobile had no Hifz at all).
 * Presentational: all session logic lives in hooks/useHifz.ts, all
 * transport in services/hifz*.ts (ADR-001).
 *
 * The page mirrors the web study page (QuranHifzStudy.tsx, PR #114):
 * - Mushaf text is the provider's Tanzil Uthmani text (the same source
 *   the server grades against), rendered in the bundled KFGQPC
 *   UthmanicHafs v3.0 font — never in the UI font. While the font is
 *   loading, a spinner shows instead of the text.
 * - Words are split on whitespace exactly like the server's word
 *   index, so `word_index` from live/grade events maps 1:1. Unlike
 *   the web page, there is no mushaf-lines layer here, so the ۞
 *   positional-shift issue (R-03) cannot occur: the text shown IS the
 *   graded text.
 * - Tajweed letter colours are the web's clip-verified rules
 *   (lib/quranTajweed.ts, ported from the web).
 * - The most recently heard live word is fully blue (Tarteel clip,
 *   R-07); older words fall back to their verdict tint.
 * - Practice hides unrecited words by default (like the web page);
 *   Peek reveals the next hidden word (and registers a mistake
 *   server-side, like the web page); "نمایش متن" reveals everything.
 * - `listening` is real in v2 (server readiness: session_started →
 *   engine_ready → audio_ready → listening). Frames are sent only
 *   after `listening`, so the waiting phase is shown honestly as
 *   "engine warming up" and `listening` means truly listening.
 * - v2 corrections overwrite a written word (never a duplicate);
 *   `partial` marks the word currently being read.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFonts } from "expo-font";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Badge, Button, Card, EmptyState, Screen, TextField, common, fontFamily, fontSize, fontWeight, spacing } from "@maturidi/ui-native";
import { useHifz, type HifzLiveWord } from "../hooks/useHifz";
import { useSurahDetail } from "../hooks/useQuran";
import { useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";
import { wordKey } from "../lib/hifzProtocol";
import { colorizeTajweedWord, type TajweedColor } from "../lib/quranTajweed";
import type { QuranStackParamList } from "../navigation/RootNavigator";
import type { Locale } from "../types";

type HifzProps = NativeStackScreenProps<QuranStackParamList, "HifzStudy">;

const TAJWEED_COLORS: Record<TajweedColor, string> = {
  // Same hexes as the web's .hifz-tj-* classes (phase 7 palette).
  darkred: "#8b0000",
  orangered: "#c2410c",
  lightorange: "#d97706",
  yellow: "#a16207",
  green: "#15803d",
  lightblue: "#0284c7",
  darkblue: "#1d4ed8",
  gray: "#57534e",
};

const STATUS_BG: Record<HifzLiveWord["status"], string> = {
  correct: "#dcfce7",
  close: "#fef3c7",
  wrong: "#fee2e2",
  skipped: "#e5e7eb",
};

function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function errorMessage(code: string | null, locale: Locale): string {
  if (!code) return "";
  const known: Record<string, string> = {
    "mic-permission-denied": t("hifz.errMicDenied", locale),
    "mic-permission-error": t("hifz.errMicError", locale),
    "engine-unavailable": t("hifz.errEngineUnavailable", locale),
    "mapping-unavailable": t("hifz.errMappingUnavailable", locale),
    "live-unavailable-whisper": t("hifz.errLiveWhisper", locale),
    "connect-timeout": t("hifz.errConnectTimeout", locale),
    "engine-ready-timeout": t("hifz.errEngineReadyTimeout", locale),
    "session-max-duration": t("hifz.errSessionMaxDuration", locale),
    "socket-error": t("hifz.errSocket", locale),
    "socket-closed": t("hifz.errSocket", locale),
    "background-stopped": t("hifz.errBackgroundStopped", locale),
    interrupted: t("hifz.errInterrupted", locale),
    "empty-audio": t("hifz.errEmptyAudio", locale),
    "recording-too-long": t("hifz.errTooLong", locale),
    "network_error": t("hifz.errNetwork", locale),
    unauthorized: t("hifz.errUnauthorized", locale),
  };
  return known[code] ?? `${t("hifz.errGeneric", locale)} (${code})`;
}

function noticeMessage(code: string | null, locale: Locale): string {
  if (!code) return "";
  const known: Record<string, string> = {
    "hifz_frames_before_ready": t("hifz.noticeFramesBeforeReady", locale),
    "hifz_rate_limited": t("hifz.noticeRateLimited", locale),
    "hifz_audio_clipping": t("hifz.noticeClipping", locale),
  };
  return known[code] ?? `${t("hifz.noticeGeneric", locale)} (${code})`;
}

function readinessMessage(kind: string | null, locale: Locale): string {
  switch (kind) {
    case "session_started":
      return t("hifz.readinessSession", locale);
    case "engine_ready":
      return t("hifz.readinessEngine", locale);
    case "audio_ready":
      return t("hifz.readinessAudio", locale);
    default:
      return t("hifz.waitingEngine", locale);
  }
}

function HifzWord({
  text,
  word,
  hidden,
  isPartial,
  locale,
}: {
  text: string;
  word: HifzLiveWord | undefined;
  hidden: boolean;
  isPartial: boolean;
  locale: Locale;
}): React.JSX.Element {
  if (hidden) {
    // A partial word stays hidden (practice mode) but gets the
    // "currently being read" outline, so the user knows where they are
    // without the word being revealed for them.
    return (
      <View style={[styles.hiddenWord, isPartial ? styles.partialWord : undefined]}>
        <Text style={styles.hiddenWordText}>···</Text>
      </View>
    );
  }
  const segments = colorizeTajweedWord(text);
  const bg = word
    ? word.isLatest
      ? "#dbeafe"
      : STATUS_BG[word.status]
    : undefined;
  return (
    <View
      style={[
        styles.word,
        bg ? { backgroundColor: bg } : undefined,
        word?.peeked ? styles.peekedWord : undefined,
        isPartial ? styles.partialWord : undefined,
      ]}
    >
      <Text style={styles.wordText}>
        {segments.map((seg, i) => (
          <Text key={i} style={seg.color ? { color: TAJWEED_COLORS[seg.color] } : undefined}>
            {seg.text}
          </Text>
        ))}
      </Text>
      {word?.peeked ? <Text style={styles.peekMark}>{t("hifz.peekMark", locale)}</Text> : null}
    </View>
  );
}

export function HifzStudyScreen({ route, navigation }: HifzProps): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { number, nameAr, ayah: initialAyah } = route.params;
  const [ayahNum, setAyahNum] = useState(initialAyah ?? 1);
  const [ayahInput, setAyahInput] = useState(String(initialAyah ?? 1));
  const [hideUnrevealed, setHideUnrevealed] = useState(true);
  const [modeSel, setModeSel] = useState<"live" | "grade">("live");
  const [fontsLoaded] = useFonts({
    UthmanicHafs: require("../../assets/fonts/UthmanicHafs-v-3.0.ttf"),
  });
  const hifz = useHifz();
  const { detail, loading, error } = useSurahDetail(number);

  const ayahCount = detail?.ayahs.length ?? 0;
  const currentAyah = useMemo(
    () => detail?.ayahs.find((a) => a.ayah === ayahNum),
    [detail, ayahNum],
  );
  const ayahWords = useMemo(() => {
    const text = currentAyah?.editions[0]?.text ?? "";
    return text.split(/\s+/).filter((w) => w.length > 0);
  }, [currentAyah]);

  const sessionActive =
    hifz.phase === "preparing" ||
    hifz.phase === "waiting_engine" ||
    hifz.phase === "listening" ||
    hifz.phase === "recording" ||
    hifz.phase === "grading";
  const allRevealed = ayahWords.every((_, i) => hifz.words[wordKey(number, ayahNum, i)] !== undefined);

  const goToAyah = (n: number): void => {
    if (sessionActive) return;
    const clamped = Math.max(1, Math.min(ayahCount || 1, n));
    setAyahNum(clamped);
    setAyahInput(String(clamped));
    hifz.reset();
  };

  const startSession = (): void => {
    if (modeSel === "live") void hifz.startLive(number, ayahNum);
    else void hifz.startRecording(number, ayahNum);
  };

  return (
    <Screen title={`${t("hifz.title", locale)} — ${nameAr}`} subtitle={t("hifz.subtitle", locale)}>
      <Button title={t("common.back", locale)} variant="ghost" size="sm" onPress={() => navigation.goBack()} />
      {!fontsLoaded || loading ? (
        <ActivityIndicator size="large" color={common.primary} />
      ) : error || !detail || !currentAyah ? (
        <EmptyState title={t("common.errorTitle", locale)} message={error ?? undefined} />
      ) : (
        <>
          <Card style={styles.controls}>
            <View style={styles.ayahNav}>
              <Button
                title="‹"
                size="sm"
                variant="secondary"
                disabled={sessionActive || ayahNum <= 1}
                onPress={() => goToAyah(ayahNum - 1)}
              />
              <TextField
                value={ayahInput}
                onChangeText={setAyahInput}
                placeholder={t("hifz.ayahNumber", locale)}
                testID="hifz-ayah-input"
              />
              <Button
                title={t("hifz.goToAyah", locale)}
                size="sm"
                variant="secondary"
                disabled={sessionActive}
                onPress={() => goToAyah(Number.parseInt(ayahInput, 10) || 1)}
              />
              <Button
                title="›"
                size="sm"
                variant="secondary"
                disabled={sessionActive || ayahNum >= ayahCount}
                onPress={() => goToAyah(ayahNum + 1)}
              />
            </View>
            <Text style={styles.muted}>
              {t("quran.ayah", locale)} {ayahNum} {t("quran.surah", locale)} {nameAr} • {ayahCount} {t("quran.ayahs", locale)}
            </Text>
            {hifz.locatedAyah !== null && hifz.locatedAyah !== ayahNum ? (
              <Button
                title={`${t("hifz.locatedGoTo", locale)} ${hifz.locatedAyah}`}
                size="sm"
                variant="secondary"
                disabled={sessionActive}
                onPress={() => goToAyah(hifz.locatedAyah ?? ayahNum)}
              />
            ) : null}
          </Card>

          <Card style={styles.mushafCard}>
            <View style={styles.wordsRow}>
              {ayahWords.map((w, i) => {
                const key = wordKey(number, ayahNum, i);
                const word = hifz.words[key];
                const hidden = hideUnrevealed && word === undefined;
                const isPartial =
                  hifz.partialWord !== null &&
                  hifz.partialWord.surah === number &&
                  hifz.partialWord.ayah === ayahNum &&
                  hifz.partialWord.wordIndex === i;
                return <HifzWord key={key} text={w} word={word} hidden={hidden} isPartial={isPartial} locale={locale} />;
              })}
            </View>
            <Text style={styles.ayahEnd}>﴿{ayahNum}﴾</Text>
          </Card>

          <View style={styles.countsRow}>
            <Badge label={`${t("hifz.correct", locale)}: ${hifz.counts.correct}`} tone="success" />
            <Badge label={`${t("hifz.close", locale)}: ${hifz.counts.close}`} tone="warning" />
            <Badge label={`${t("hifz.wrong", locale)}: ${hifz.counts.wrong}`} tone="danger" />
            <Badge label={`${t("hifz.skipped", locale)}: ${hifz.counts.skipped}`} tone="neutral" />
            {hifz.diag.extraWords > 0 ? (
              <Badge label={`${t("hifz.extra", locale)}: ${hifz.diag.extraWords}`} tone="neutral" />
            ) : null}
          </View>

          <Card style={styles.sessionCard}>
            <View style={styles.modeRow}>
              <TouchableOpacity
                onPress={() => !sessionActive && setModeSel("live")}
                accessibilityRole="button"
                disabled={sessionActive}
              >
                <Text style={[styles.modeLabel, modeSel === "live" ? styles.modeActive : styles.muted]}>
                  {t("hifz.modeLive", locale)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => !sessionActive && setModeSel("grade")}
                accessibilityRole="button"
                disabled={sessionActive}
              >
                <Text style={[styles.modeLabel, modeSel === "grade" ? styles.modeActive : styles.muted]}>
                  {t("hifz.modeGrade", locale)}
                </Text>
              </TouchableOpacity>
              <Text style={styles.clock}>{formatClock(hifz.elapsedSec)}</Text>
            </View>

            {hifz.phase === "waiting_engine" ? (
              <>
                <ActivityIndicator color={common.primary} />
                <Text style={styles.listeningNote}>{readinessMessage(hifz.readiness, locale)}</Text>
              </>
            ) : null}
            {hifz.phase === "listening" ? (
              <Text style={styles.listeningNote}>{t("hifz.listeningNow", locale)}</Text>
            ) : null}
            {hifz.phase === "preparing" ? <ActivityIndicator color={common.primary} /> : null}

            {hifz.phase === "idle" || hifz.phase === "done" || hifz.phase === "error" ? (
              <Button
                title={modeSel === "live" ? t("hifz.startLive", locale) : t("hifz.startRecording", locale)}
                onPress={startSession}
              />
            ) : null}
            {hifz.phase === "listening" ? (
              <Button title={t("hifz.stopLive", locale)} variant="secondary" onPress={() => void hifz.stopLive()} />
            ) : null}
            {hifz.phase === "recording" ? (
              <Button title={t("hifz.stopAndGrade", locale)} onPress={() => void hifz.stopAndGrade()} />
            ) : null}
            {hifz.phase === "grading" ? (
              <Button title={t("hifz.grading", locale)} loading disabled onPress={() => undefined} />
            ) : null}

            <View style={styles.sessionBtns}>
              <Button
                title={t("hifz.peek", locale)}
                size="sm"
                variant="secondary"
                disabled={hifz.attempt === null || allRevealed}
                onPress={() => void hifz.peekNext(number, ayahNum, ayahWords)}
              />
              <Button
                title={hideUnrevealed ? t("hifz.showText", locale) : t("hifz.hideText", locale)}
                size="sm"
                variant="ghost"
                onPress={() => setHideUnrevealed((v) => !v)}
              />
              {hifz.phase === "done" && hifz.attempt ? (
                <Button
                  title={t("hifz.complete", locale)}
                  size="sm"
                  variant="secondary"
                  onPress={() => void hifz.completeSession()}
                />
              ) : null}
            </View>

            <Text style={styles.diag}>
              {t("hifz.diag", locale)}: {hifz.diag.sampleRate}Hz • {t("hifz.framesSent", locale)} {hifz.diag.framesSent}
              {hifz.diag.framesDropped > 0 ? ` • ${t("hifz.framesDropped", locale)} ${hifz.diag.framesDropped}` : ""} •{" "}
              {t("hifz.framesReceived", locale)} {hifz.diag.framesReceived}
              {hifz.diag.seqGaps > 0 ? ` • ${t("hifz.seqGaps", locale)} ${hifz.diag.seqGaps}` : ""}
              {hifz.engine ? ` • ${hifz.engine}` : ""}
            </Text>
            {hifz.notice ? (
              <Card style={styles.noticeCard}>
                <Text style={styles.noticeText}>{noticeMessage(hifz.notice, locale)}</Text>
              </Card>
            ) : null}
            {hifz.error ? (
              <Card style={styles.errorCard}>
                <Text style={styles.errorText}>{errorMessage(hifz.error, locale)}</Text>
              </Card>
            ) : null}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { gap: spacing[2] },
  ayahNav: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  muted: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted },
  mushafCard: { backgroundColor: "#ffffff", gap: spacing[2] },
  wordsRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 6 },
  word: { borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2 },
  wordText: { fontFamily: "UthmanicHafs", fontSize: 28, lineHeight: 52, color: common.textPrimary, textAlign: "right" },
  hiddenWord: {
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: "#f1f5f9",
    minWidth: 44,
    alignItems: "center",
  },
  hiddenWordText: { fontFamily: fontFamily.bodyFa, fontSize: 28, lineHeight: 52, color: "#94a3b8" },
  peekedWord: { borderWidth: 1, borderColor: "#b45309" },
  partialWord: { borderWidth: 1, borderStyle: "dashed", borderColor: "#1d4ed8" },
  noticeCard: { borderColor: "#92400e", backgroundColor: "#fffbeb" },
  noticeText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: "#92400e" },
  peekMark: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.xs, color: "#b45309" },
  ayahEnd: { fontFamily: "UthmanicHafs", fontSize: 24, color: common.primary, textAlign: "center" },
  countsRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing[2] },
  sessionCard: { gap: spacing[2] },
  modeRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[3] },
  modeLabel: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base },
  modeActive: { color: common.primary, fontWeight: fontWeight.bold },
  clock: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary, marginStart: "auto" },
  listeningNote: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: "#92400e" },
  sessionBtns: { flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing[2] },
  diag: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.xs, color: common.textMuted },
  errorCard: { borderColor: "#b91c1c", backgroundColor: "#fef2f2" },
  errorText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: "#b91c1c" },
});
