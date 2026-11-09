/**
 * apps/mobile — src/screens/ListenScreen.tsx
 *
 * The listen screen (completion mission §5): reciter audio follows the
 * mushaf text — the current word is highlighted in sync with the
 * audio (green background + white text, like the web listen mode).
 *
 * Data: the surah detail is fetched with the current reciter, so the
 * per-ayah `audio_url` values are that reciter's (interpolated
 * fallback). Texts/urls are handed to the shared player via
 * `openSurah`; the player instance lives in `ListenPlayerProvider`,
 * so leaving this screen (another tab, another page) never stops
 * playback — the mini player above the tab bar keeps controlling it.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useFonts } from "expo-font";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button, Card, EmptyState, Screen, common, fontFamily, fontSize, fontWeight, spacing } from "@maturidi/ui-native";
import { HifzListenPlayer, useListen } from "../components/ListenPlayer";
import { useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";
import { getSurah } from "../services/quran";
import type { QuranStackParamList } from "../navigation/RootNavigator";
import type { Locale, SurahDetail } from "../types";

type ListenProps = NativeStackScreenProps<QuranStackParamList, "HifzListen">;

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

export function HifzListenScreen({ route, navigation }: ListenProps): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { number, nameAr, ayah: initialAyah } = route.params;
  const listen = useListen();
  const [fontsLoaded] = useFonts({
    UthmanicHafs: require("../../assets/fonts/UthmanicHafs-v-3.0.ttf"),
  });
  const [detail, setDetail] = useState<SurahDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail with the current reciter (per-ayah audio is that reciter's).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getSurah(number, { reciter: listen.reciter })
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "unknown");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // Re-fetch when the reciter changes (new per-ayah audio).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number, listen.reciter]);

  const ayahTexts = useMemo(() => {
    const out: Record<number, string> = {};
    for (const a of detail?.ayahs ?? []) out[a.ayah] = a.editions[0]?.text ?? "";
    return out;
  }, [detail]);

  const ayahAudioUrls = useMemo(() => {
    const out: Record<number, string | null> = {};
    for (const a of detail?.ayahs ?? []) {
      out[a.ayah] = a.editions.find((e) => e.audio_url)?.audio_url ?? null;
    }
    return out;
  }, [detail]);

  // Hand the surah to the shared player once the detail is in.
  useEffect(() => {
    if (!detail) return;
    listen.openSurah({
      surah: number,
      nameAr,
      ayahCount: detail.ayahs.length,
      ayahTexts,
      ayahAudioUrls,
      startAyah: initialAyah,
    });
    // openSurah is stable; detail identity changes only on refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, number, nameAr]);

  const currentAyahText = ayahTexts[listen.currentAyah] ?? "";
  const words = useMemo(() => splitWords(currentAyahText), [currentAyahText]);

  return (
    <Screen title={`${t("listen.title", locale)} — ${nameAr}`} subtitle={t("listen.subtitle", locale)}>
      <Button title={t("common.back", locale)} variant="ghost" size="sm" onPress={() => navigation.goBack()} />
      {!fontsLoaded || loading ? (
        <ActivityIndicator size="large" color={common.primary} />
      ) : error || !detail ? (
        <EmptyState title={t("common.errorTitle", locale)} message={error ?? undefined} />
      ) : (
        <>
          <Card style={styles.mushafCard}>
            <View style={styles.wordsRow}>
              {words.map((w, i) => {
                const isCurrent = listen.currentWord === i + 1 && listen.isPlaying;
                return (
                  <View key={`${listen.currentAyah}:${i}`} style={[styles.word, isCurrent ? styles.wordCurrent : undefined]}>
                    <Text style={[styles.wordText, isCurrent ? styles.wordTextCurrent : undefined]}>{w}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.ayahEnd}>﴿{listen.currentAyah}﴾</Text>
          </Card>
          <HifzListenPlayer />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  mushafCard: { backgroundColor: "#ffffff", gap: spacing[2] },
  wordsRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 6 },
  word: { borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2 },
  wordCurrent: { backgroundColor: "#188653" },
  wordText: { fontFamily: "UthmanicHafs", fontSize: 28, lineHeight: 52, color: common.textPrimary, textAlign: "right" },
  wordTextCurrent: { color: "#ffffff" },
  ayahEnd: { fontFamily: "UthmanicHafs", fontSize: 24, color: common.primary, textAlign: "center" },
});
