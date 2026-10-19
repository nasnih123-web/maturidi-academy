/**
 * apps/mobile — src/screens/QuranScreens.tsx
 *
 * Quran reader: surah list → surah detail (ayahs) → per-ayah notes.
 * Presentational: data comes from hooks/useQuran → services/quran.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
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
  spacing,
  TextField,
} from "@maturidi/ui-native";
import { useQuranNotes, useSurahDetail, useSurahs } from "../hooks/useQuran";
import { useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";
import type { QuranStackParamList } from "../navigation/RootNavigator";
import type { Ayah } from "../types";

type ListProps = NativeStackScreenProps<QuranStackParamList, "QuranHome">;
type SurahProps = NativeStackScreenProps<QuranStackParamList, "Surah">;

export function QuranListScreen({ navigation }: ListProps): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { surahs, loading, error, refresh } = useSurahs();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return surahs;
    return surahs.filter(
      (s) => s.name_ar.includes(q) || s.name_en.toLowerCase().includes(q.toLowerCase()) || String(s.number) === q,
    );
  }, [surahs, query]);

  return (
    <Screen title={t("quran.title", locale)} subtitle={t("quran.subtitle", locale)}>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder={t("quran.searchSurah", locale)}
        testID="quran-search"
      />
      {loading ? (
        <ActivityIndicator size="large" color={common.primary} />
      ) : error ? (
        <EmptyState title={t("common.errorTitle", locale)} message={error} actionTitle={t("common.retry", locale)} onAction={refresh} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => String(s.number)}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => navigation.navigate("Surah", { number: item.number, nameAr: item.name_ar })}
              accessibilityRole="button"
            >
              <Card style={styles.surahRow}>
                <View style={styles.surahNum}>
                  <Text style={styles.surahNumText}>{item.number}</Text>
                </View>
                <View style={styles.surahMeta}>
                  <Text style={styles.surahAr}>{item.name_ar}</Text>
                  <Text style={styles.surahEn}>
                    {item.name_en} • {item.ayahs} {t("quran.ayahs", locale)}
                  </Text>
                </View>
              </Card>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
        />
      )}
    </Screen>
  );
}

function AyahNotes({ surah, ayah }: { surah: number; ayah: number }): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { notes, conflicts, addNote, removeNote, resolveNoteConflict } = useQuranNotes(surah, ayah);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    if (!draft.trim()) return;
    setSaving(true);
    const ok = await addNote({ surah, ayah, note_text: draft.trim(), is_private: true });
    setSaving(false);
    if (ok) setDraft("");
  };

  return (
    <View style={styles.notesWrap}>
      {conflicts.length > 0 ? (
        <Card style={styles.conflictCard}>
          <CardTitle>{t("quran.conflictTitle", locale)}</CardTitle>
          <Text style={styles.muted}>{t("quran.conflictMessage", locale)}</Text>
          {conflicts.map((c) => {
            const localText =
              c.local_payload && typeof c.local_payload.note_text === "string"
                ? String(c.local_payload.note_text)
                : "…";
            const remoteText =
              c.remote_payload && typeof c.remote_payload.note_text === "string"
                ? String(c.remote_payload.note_text)
                : "…";
            return (
              <View key={c.id} style={styles.conflictRow}>
                <Text style={styles.conflictLabel}>{t("quran.keepMine", locale)}:</Text>
                <Text style={styles.muted}>{localText}</Text>
                <Text style={styles.conflictLabel}>{t("quran.keepOther", locale)}:</Text>
                <Text style={styles.muted}>{remoteText}</Text>
                <View style={styles.conflictBtns}>
                  <Button
                    title={t("quran.keepMine", locale)}
                    size="sm"
                    onPress={() => resolveNoteConflict(c.id, "keep_local")}
                  />
                  <Button
                    title={t("quran.keepOther", locale)}
                    size="sm"
                    variant="secondary"
                    onPress={() => resolveNoteConflict(c.id, "keep_remote")}
                  />
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}
      {notes.length === 0 ? (
        <Text style={styles.muted}>{t("quran.noNotes", locale)}</Text>
      ) : (
        notes.map((n) => (
          <Card key={n.id} style={styles.noteCard}>
            <Text style={styles.noteText}>{n.note_text}</Text>
            <View style={styles.noteRow}>
              <Badge label={t("quran.notePrivate", locale)} tone="neutral" />
              <TouchableOpacity onPress={() => removeNote(n.id)} accessibilityRole="button">
                <Text style={styles.delete}>{t("common.delete", locale)}</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))
      )}
      <TextField
        value={draft}
        onChangeText={setDraft}
        placeholder={t("quran.notePlaceholder", locale)}
        multiline
        testID={`note-input-${surah}-${ayah}`}
      />
      <Button title={t("quran.addNote", locale)} size="sm" onPress={save} loading={saving} />
    </View>
  );
}

function AyahRow({ ayah, locale }: { ayah: Ayah; locale: "fa" | "ar" | "en" }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const main = ayah.editions[0];
  const translation = ayah.editions.find((e) => e.edition !== main?.edition && /fa|ar|en/i.test(e.edition));
  return (
    <Card style={styles.ayahCard}>
      <View style={styles.ayahHead}>
        <Badge label={String(ayah.ayah)} tone="neutral" />
      </View>
      <Text style={styles.ayahText}>{main?.text ?? ""}</Text>
      {translation ? <Text style={styles.translation}>{translation.text}</Text> : null}
      <TouchableOpacity onPress={() => setOpen((v) => !v)} accessibilityRole="button">
        <Text style={styles.notesToggle}>
          {t("quran.notes", locale)} {open ? "▾" : "▸"}
        </Text>
      </TouchableOpacity>
      {open ? <AyahNotes surah={ayah.surah} ayah={ayah.ayah} /> : null}
    </Card>
  );
}

export function SurahScreen({ route, navigation }: SurahProps): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { number, nameAr } = route.params;
  const { detail, loading, error } = useSurahDetail(number);

  return (
    <Screen
      title={`${t("quran.surah", locale)} ${nameAr}`}
      subtitle={detail ? `${detail.ayahs.length} ${t("quran.ayahs", locale)}` : undefined}
    >
      <Button title={t("common.back", locale)} variant="ghost" size="sm" onPress={() => navigation.goBack()} />
      {loading ? (
        <ActivityIndicator size="large" color={common.primary} />
      ) : error || !detail ? (
        <EmptyState title={t("common.errorTitle", locale)} message={error ?? undefined} />
      ) : (
        detail.ayahs.map((a) => <AyahRow key={`${a.surah}:${a.ayah}`} ayah={a} locale={locale} />)
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  surahRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  surahNum: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: common.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  surahNumText: { color: "#fff", fontFamily: fontFamily.bodyFa, fontSize: fontSize.base },
  surahMeta: { flex: 1 },
  surahAr: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.xl, color: common.textPrimary, textAlign: "right" },
  surahEn: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted },
  ayahCard: { gap: spacing[2] },
  ayahHead: { flexDirection: "row", justifyContent: "flex-end" },
  ayahText: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.xl,
    lineHeight: 44,
    color: common.textPrimary,
    textAlign: "right",
  },
  translation: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textMuted, textAlign: "right" },
  notesToggle: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.primary, marginTop: spacing[1] },
  notesWrap: { gap: spacing[2], marginTop: spacing[2] },
  noteCard: { gap: spacing[1] },
  noteText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary, textAlign: "right" },
  noteRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  delete: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: "#b91c1c" },
  muted: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted },
  conflictCard: { borderColor: "#b45309", gap: spacing[2] },
  conflictRow: { gap: spacing[1] },
  conflictLabel: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textPrimary },
  conflictBtns: { flexDirection: "row", gap: spacing[2], marginTop: spacing[1] },
});
