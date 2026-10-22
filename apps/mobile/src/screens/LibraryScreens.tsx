/**
 * apps/mobile — src/screens/LibraryScreens.tsx
 *
 * Library DMS: search + browse + offline downloads.
 */
import React, { useState } from "react";
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
  ProgressBar,
  Screen,
  spacing,
  statusTone,
  TextField,
} from "@maturidi/ui-native";
import { useLibrary } from "../hooks/useLibrary";
import { useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";
import { resolveText, type LibraryItem } from "../types";
import type { LibraryStackParamList } from "../navigation/RootNavigator";
import { getLibraryItem, isDownloaded } from "../services/library";

type ListProps = NativeStackScreenProps<LibraryStackParamList, "LibraryHome">;
type ItemProps = NativeStackScreenProps<LibraryStackParamList, "Item">;

const KIND_TONE: Record<string, "info" | "success" | "warning" | "neutral"> = {
  book: "info",
  audio: "success",
  video: "warning",
  pdf: "neutral",
};

export function LibraryListScreen({ navigation }: ListProps): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { items, searching, error, search, refresh } = useLibrary();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<string[] | null>(null);

  const doSearch = async (): Promise<void> => {
    if (!query.trim()) {
      setHits(null);
      refresh();
      return;
    }
    const res = await search(query.trim());
    setHits(res.map((h) => h.item_id));
  };

  const visible = hits ? items.filter((i) => hits.includes(i.id)) : items;

  return (
    <Screen title={t("library.title", locale)} subtitle={t("library.subtitle", locale)}>
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder={t("library.searchPlaceholder", locale)}
            testID="library-search"
          />
        </View>
        <Button title={t("common.search", locale)} size="sm" onPress={doSearch} loading={searching} />
      </View>
      {error ? <EmptyState title={t("common.errorTitle", locale)} message={error} /> : null}
      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        scrollEnabled={false}
        ListEmptyComponent={!error ? <EmptyState title={t("library.noResults", locale)} /> : undefined}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => navigation.navigate("Item", { itemId: item.id })} accessibilityRole="button">
            <Card style={styles.row}>
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={2}>
                  {resolveText(item.title, locale)}
                </Text>
                <View style={styles.badges}>
                  <Badge label={item.kind} tone={KIND_TONE[item.kind] ?? "neutral"} />
                  <Badge label={item.workflow_status} tone={statusTone(item.workflow_status)} />
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
      />
    </Screen>
  );
}

export function LibraryItemScreen({ route, navigation }: ItemProps): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { itemId } = route.params;
  const { downloadingId, downloadProgress, download } = useLibrary();
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    let alive = true;
    getLibraryItem(itemId)
      .then((it) => alive && setItem(it))
      .catch(() => alive && setError("load_failed"));
    isDownloaded(itemId).then((d) => alive && setDownloaded(d));
    return () => {
      alive = false;
    };
  }, [itemId]);

  const onDownload = async (): Promise<void> => {
    if (!item) return;
    setBusy(true);
    const ok = await download(item);
    setBusy(false);
    if (ok) setDownloaded(await isDownloaded(item.id));
  };

  const downloading = downloadingId === itemId;

  return (
    <Screen title={item ? resolveText(item.title, locale) : t("library.title", locale)}>
      <Button title={t("common.back", locale)} variant="ghost" size="sm" onPress={() => navigation.goBack()} />
      {error || !item ? (
        <EmptyState title={t("common.errorTitle", locale)} />
      ) : (
        <Card>
          <CardTitle>{resolveText(item.title, locale)}</CardTitle>
          {item.description ? <Text style={styles.desc}>{resolveText(item.description, locale)}</Text> : null}
          <View style={styles.badges}>
            <Badge label={item.kind} tone={KIND_TONE[item.kind] ?? "neutral"} />
            <Badge label={item.workflow_status} tone={statusTone(item.workflow_status)} />
          </View>
          {item.topic_tags.length > 0 ? (
            <View style={styles.badges}>
              {item.topic_tags.map((tag) => (
                <Badge key={tag} label={tag} tone="neutral" />
              ))}
            </View>
          ) : null}
          {downloading ? (
            <View style={styles.dl}>
              <Text style={styles.muted}>{t("library.downloading", locale)}</Text>
              <ProgressBar value={downloadProgress} />
            </View>
          ) : downloaded ? (
            <Badge label={t("library.downloaded", locale)} tone="success" />
          ) : (
            <Button title={t("library.download", locale)} onPress={onDownload} loading={busy} />
          )}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: "row", gap: spacing[2], alignItems: "flex-start" },
  searchField: { flex: 1 },
  row: { flexDirection: "row" },
  meta: { flex: 1, gap: spacing[1] },
  title: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary, textAlign: "right" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing[1] },
  desc: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textMuted, textAlign: "right", lineHeight: 26 },
  muted: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted },
  dl: { gap: spacing[1] },
});
