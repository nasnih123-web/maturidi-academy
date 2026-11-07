/**
 * apps/mobile — src/components/ListenPlayer.tsx
 *
 * The listen-mode player surface (completion mission §5).
 *
 * - `ListenPlayerProvider` owns ONE `useListenPlayer` instance at the
 *   app root, so playback survives navigation: the screen unmounts,
 *   the player does not. Screens and the mini player consume it via
 *   `useListen()`.
 * - `HifzListenPlayer` is the full card: reciter picker, transport
 *   (prev / play-pause / next / stop), ayah selector, progress bar
 *   with tap-to-seek, position display, Tarteel speed badge
 *   (0.5×–1.75×), repeat badge (off / ayah / range / surah) with
 *   counts, offline download, honest error + retry, and the
 *   "estimated timing" label in interpolated mode.
 * - `ListenMiniPlayer` is the compact bar rendered above the tab bar
 *   while a listen session is alive (playing / paused / buffering /
 *   loading): play/pause, surah:ayah, speed, stop. Tapping it opens
 *   the full listen screen (via the `onOpen` prop — navigation lives
 *   in the navigator, not here).
 *
 * Audio is the module singleton (services/listenAudio.ts): starting a
 * listen here replaces any running stream, so two listens can never
 * overlap. iOS shows the lock-screen controls; Android keeps the
 * ExoPlayer session while the app is alive.
 */
import React, { createContext, useContext, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from "react-native";
import { Badge, Button, Card, TextField, common, fontFamily, fontSize, fontWeight, spacing } from "@maturidi/ui-native";
import { useListenPlayer, type ListenControls } from "../hooks/useListenPlayer";
import { useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";
import { formatListenClock } from "../lib/listenPlayer";
import type { Locale } from "../types";

const ListenContext = createContext<ListenControls | null>(null);

export function ListenPlayerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const controls = useListenPlayer();
  return <ListenContext.Provider value={controls}>{children}</ListenContext.Provider>;
}

/** The shared listen player (must be rendered under ListenPlayerProvider). */
export function useListen(): ListenControls {
  const ctx = useContext(ListenContext);
  if (!ctx) throw new Error("useListen must be used inside ListenPlayerProvider");
  return ctx;
}

function errorMessage(kind: string | null, locale: Locale): string {
  switch (kind) {
    case "offline":
      return t("listen.errOffline", locale);
    case "timing":
      return t("listen.errTiming", locale);
    case "audio":
    default:
      return t("listen.errAudio", locale);
  }
}

function repeatLabel(mode: string, locale: Locale): string {
  switch (mode) {
    case "ayah":
      return t("listen.repeatAyah", locale);
    case "range":
      return t("listen.repeatRange", locale);
    case "surah":
      return t("listen.repeatSurah", locale);
    case "off":
    default:
      return t("listen.repeatOff", locale);
  }
}

export function HifzListenPlayer(): React.JSX.Element {
  const locale = useEffectiveLocale();
  const listen = useListen();
  const [ayahInput, setAyahInput] = useState("1");
  const [trackWidth, setTrackWidth] = useState(0);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeCount, setRangeCount] = useState("1");

  const playing = listen.isPlaying;
  const busy = listen.status === "loading" || listen.status === "buffering";
  const totalMs = listen.durationMs > 0 ? listen.durationMs : 0;
  const progressFrac = totalMs > 0 ? Math.min(1, Math.max(0, listen.progressMs / totalMs)) : 0;

  const onSeekPress = (e: GestureResponderEvent) => {
    if (totalMs <= 0 || trackWidth <= 0) return;
    const x = e.nativeEvent.locationX;
    listen.seek(Math.round((Math.min(Math.max(x, 0), trackWidth) / trackWidth) * totalMs));
  };

  const applyRange = () => {
    const start = Number.parseInt(rangeStart, 10);
    const end = Number.parseInt(rangeEnd, 10);
    const count = Number.parseInt(rangeCount, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start || end > listen.ayahCount) return;
    listen.setRepeatRange({ start, end, count: Number.isFinite(count) && count >= 1 ? count : 1 });
    listen.setRepeatMode("range");
  };

  return (
    <Card style={styles.card}>
      {/* Reciter picker */}
      <Text style={styles.label}>{t("listen.reciter", locale)}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reciterRow}>
        {listen.reciters.map((r) => (
          <TouchableOpacity
            key={r.id}
            onPress={() => listen.setReciter(r.id)}
            accessibilityRole="button"
            style={[styles.chip, listen.reciter === r.id ? styles.chipActive : undefined]}
          >
            <Text style={[styles.chipText, listen.reciter === r.id ? styles.chipTextActive : undefined]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Position + progress */}
      <View style={styles.positionRow}>
        <Text style={styles.position}>
          {t("quran.surah", locale)} {listen.surahName || listen.surah} • {t("quran.ayah", locale)} {listen.currentAyah}
          {listen.ayahCount > 0 ? ` / ${listen.ayahCount}` : ""}
        </Text>
        <Text style={styles.position}>
          {formatListenClock(listen.progressMs)}
          {totalMs > 0 ? ` / ${formatListenClock(totalMs)}` : ""}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onSeekPress}
        accessibilityRole="slider"
        accessibilityLabel={t("listen.seek", locale)}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        style={styles.track}
      >
        <View style={[styles.trackFill, { width: `${progressFrac * 100}%` }]} />
      </TouchableOpacity>
      {listen.timingSource === "interpolated" ? (
        <Text style={styles.estimated}>{t("listen.estimated", locale)}</Text>
      ) : null}
      {listen.offline ? <Badge label={t("common.offline", locale)} tone="warning" /> : null}

      {/* Transport */}
      <View style={styles.transport}>
        <Button
          title="‹"
          size="sm"
          variant="secondary"
          disabled={listen.currentAyah <= 1}
          onPress={() => listen.prevAyah()}
        />
        {playing ? (
          <Button title={t("listen.pause", locale)} onPress={() => listen.pause()} />
        ) : (
          <Button
            title={listen.status === "paused" ? t("listen.resume", locale) : t("listen.play", locale)}
            onPress={() => listen.play()}
            loading={busy}
          />
        )}
        <Button
          title="›"
          size="sm"
          variant="secondary"
          disabled={listen.ayahCount > 0 && listen.currentAyah >= listen.ayahCount}
          onPress={() => listen.nextAyah()}
        />
        <Button title={t("listen.stop", locale)} size="sm" variant="ghost" onPress={() => listen.stop()} />
      </View>

      {/* Ayah selector */}
      <View style={styles.ayahNav}>
        <TextField
          value={ayahInput}
          onChangeText={setAyahInput}
          placeholder={t("hifz.ayahNumber", locale)}
          testID="listen-ayah-input"
        />
        <Button
          title={t("hifz.goToAyah", locale)}
          size="sm"
          variant="secondary"
          onPress={() => {
            const n = Number.parseInt(ayahInput, 10);
            if (Number.isFinite(n)) listen.playAyah(n);
          }}
        />
      </View>

      {/* Speed + repeat */}
      <View style={styles.badgesRow}>
        <TouchableOpacity onPress={() => listen.cycleSpeed()} accessibilityRole="button">
          <Badge label={`${listen.speed}×`} tone="neutral" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => listen.cycleRepeatMode()} accessibilityRole="button">
          <Badge
            label={
              listen.repeatRemaining !== null
                ? `${repeatLabel(listen.repeatMode, locale)} (${listen.repeatRemaining})`
                : repeatLabel(listen.repeatMode, locale)
            }
            tone={listen.repeatMode === "off" ? "neutral" : "success"}
          />
        </TouchableOpacity>
        {listen.repeatMode === "ayah" ? (
          <View style={styles.countRow}>
            <Button title="−" size="sm" variant="secondary" onPress={() => listen.setRepeatAyahCount(listen.repeatAyahCount - 1)} />
            <Text style={styles.countText}>
              {t("listen.ayahRepeatCount", locale)}: {listen.repeatAyahCount}
            </Text>
            <Button title="+" size="sm" variant="secondary" onPress={() => listen.setRepeatAyahCount(listen.repeatAyahCount + 1)} />
          </View>
        ) : null}
      </View>
      {listen.repeatMode === "range" ? (
        <View style={styles.rangeRow}>
          <TextField value={rangeStart} onChangeText={setRangeStart} placeholder={t("listen.rangeStart", locale)} />
          <TextField value={rangeEnd} onChangeText={setRangeEnd} placeholder={t("listen.rangeEnd", locale)} />
          <TextField value={rangeCount} onChangeText={setRangeCount} placeholder={t("listen.rangeCount", locale)} />
          <Button title={t("listen.applyRange", locale)} size="sm" variant="secondary" onPress={applyRange} />
        </View>
      ) : null}

      {/* Resume chip */}
      {listen.hasSavedPosition && listen.savedPosition && listen.status === "idle" ? (
        <Button
          title={`${t("listen.resumeFrom", locale)} ${t("quran.ayah", locale)} ${listen.savedPosition.ayah} — ${formatListenClock(listen.savedPosition.progressMs)}`}
          size="sm"
          variant="secondary"
          onPress={() => listen.resumeSaved()}
        />
      ) : null}

      {/* Offline download */}
      <View style={styles.downloadRow}>
        {listen.downloaded ? (
          <Badge label={t("listen.downloaded", locale)} tone="success" />
        ) : (
          <Button
            title={listen.downloading ? t("listen.downloading", locale) : t("listen.download", locale)}
            size="sm"
            variant="secondary"
            loading={listen.downloading}
            onPress={() => void listen.downloadForOffline()}
          />
        )}
        {listen.downloadError ? <Text style={styles.errorText}>{t("listen.errOffline", locale)}</Text> : null}
      </View>

      {/* Error + retry */}
      {listen.status === "error" ? (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>{errorMessage(listen.error, locale)}</Text>
          <Button title={t("common.retry", locale)} size="sm" onPress={() => listen.retry()} />
        </Card>
      ) : null}
      {busy ? <ActivityIndicator color={common.primary} /> : null}
    </Card>
  );
}

export function ListenMiniPlayer({ onOpen }: { onOpen: () => void }): React.JSX.Element | null {
  const locale = useEffectiveLocale();
  const listen = useListen();
  const alive =
    listen.status === "playing" || listen.status === "paused" || listen.status === "buffering" || listen.status === "loading";
  if (!alive) return null;
  return (
    <TouchableOpacity onPress={onOpen} accessibilityRole="button" style={styles.miniBar}>
      <Text style={styles.miniText}>
        {t("listen.title", locale)} — {listen.surahName || listen.surah}:{listen.currentAyah}
      </Text>
      <Text style={styles.miniText}>{listen.speed}×</Text>
      {listen.isPlaying ? (
        <Button title={t("listen.pause", locale)} size="sm" variant="secondary" onPress={() => listen.pause()} />
      ) : (
        <Button title={t("listen.play", locale)} size="sm" variant="secondary" onPress={() => listen.play()} />
      )}
      <Button title={t("listen.stop", locale)} size="sm" variant="ghost" onPress={() => listen.stop()} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing[2] },
  label: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted },
  reciterRow: { flexDirection: "row" },
  chip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 999,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    marginEnd: spacing[2],
  },
  chipActive: { borderColor: common.primary, backgroundColor: "#dcfce7" },
  chipText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textPrimary },
  chipTextActive: { color: common.primary, fontWeight: fontWeight.bold },
  positionRow: { flexDirection: "row-reverse", justifyContent: "space-between" },
  position: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textPrimary },
  track: { height: 10, borderRadius: 5, backgroundColor: "#e2e8f0", overflow: "hidden" },
  trackFill: { height: "100%", backgroundColor: common.primary },
  estimated: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.xs, color: "#92400e" },
  transport: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[2], justifyContent: "center" },
  ayahNav: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  badgesRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[2], flexWrap: "wrap" },
  countRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[1] },
  countText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textPrimary },
  rangeRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[2], flexWrap: "wrap" },
  downloadRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[2] },
  errorCard: { borderColor: "#b91c1c", backgroundColor: "#fef2f2", gap: spacing[2] },
  errorText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: "#b91c1c" },
  miniBar: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing[2],
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  miniText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textPrimary },
});
