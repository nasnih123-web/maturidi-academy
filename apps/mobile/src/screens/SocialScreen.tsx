/**
 * apps/mobile — src/screens/SocialScreen.tsx
 *
 * Community feed: composer + paginated feed + likes.
 */
import React, { useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  Button,
  Card,
  common,
  EmptyState,
  fontFamily,
  fontSize,
  Screen,
  spacing,
  TextField,
} from "@maturidi/ui-native";
import { useSocialFeed } from "../hooks/useSocial";
import { useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";

export function SocialScreen(): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { posts, loading, loadingMore, error, hasMore, refresh, loadMore, publish, toggleLike } = useSocialFeed();
  const [draft, setDraft] = useState("");
  const [publishing, setPublishing] = useState(false);

  const onPublish = async (): Promise<void> => {
    if (!draft.trim()) return;
    setPublishing(true);
    const ok = await publish(draft.trim());
    setPublishing(false);
    if (ok) setDraft("");
  };

  return (
    <Screen
      title={t("social.title", locale)}
      subtitle={t("social.subtitle", locale)}
      refreshing={loading}
      onRefresh={refresh}
    >
      <Card>
        <TextField
          value={draft}
          onChangeText={setDraft}
          placeholder={t("social.postPlaceholder", locale)}
          multiline
          testID="social-composer"
        />
        <Button title={t("social.publish", locale)} size="sm" onPress={onPublish} loading={publishing} />
      </Card>
      {loading && posts.length === 0 ? (
        <ActivityIndicator size="large" color={common.primary} />
      ) : error && posts.length === 0 ? (
        <EmptyState title={t("common.errorTitle", locale)} message={error} actionTitle={t("common.retry", locale)} onAction={refresh} />
      ) : posts.length === 0 ? (
        <EmptyState title={t("social.emptyFeed", locale)} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <Card style={styles.post}>
              <Text style={styles.body}>{item.body}</Text>
              <View style={styles.footer}>
                <TouchableOpacity
                  onPress={() => toggleLike(item)}
                  accessibilityRole="button"
                  accessibilityLabel={t("social.like", locale)}
                  style={styles.likeBtn}
                >
                  <Text style={[styles.likeText, item.liked && styles.liked]}>
                    ♥ {item.likes_count}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.meta}>
                  {item.comment_count} {t("social.comments", locale)}
                </Text>
              </View>
            </Card>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
          ListFooterComponent={
            hasMore ? (
              <Button
                title={t("common.loadMore", locale)}
                variant="secondary"
                size="sm"
                onPress={loadMore}
                loading={loadingMore}
              />
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  post: { gap: spacing[2] },
  body: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary, textAlign: "right", lineHeight: 28 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  likeBtn: { padding: spacing[1] },
  likeText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textMuted },
  liked: { color: "#b91c1c" },
  meta: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted },
});
