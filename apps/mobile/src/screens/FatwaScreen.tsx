/**
 * apps/mobile — src/screens/FatwaScreen.tsx
 *
 * Fatwa Q&A against the Phase-6 RAG engine. The `ai_label` disclaimer from
 * the server is rendered verbatim — the client must never hide or reword it.
 */
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
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
  statusTone,
  TextField,
} from "@maturidi/ui-native";
import { useFatwa } from "../hooks/useFatwa";
import { useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";

export function FatwaScreen(): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { answer, asking, error, ask, clear } = useFatwa(locale);
  const [question, setQuestion] = useState("");

  const submit = (): void => {
    if (question.trim()) ask(question.trim());
  };

  return (
    <Screen title={t("fatwa.title", locale)} subtitle={t("fatwa.subtitle", locale)}>
      <Card>
        <TextField
          value={question}
          onChangeText={setQuestion}
          placeholder={t("fatwa.askPlaceholder", locale)}
          multiline
          testID="fatwa-question"
        />
        <Button title={t("fatwa.ask", locale)} onPress={submit} loading={asking} />
      </Card>

      {asking ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={common.primary} />
          <Text style={styles.muted}>{t("fatwa.thinking", locale)}</Text>
        </View>
      ) : null}

      {error ? <EmptyState title={t("common.errorTitle", locale)} message={error} /> : null}

      {answer ? (
        <Card>
          <View style={styles.headRow}>
            <Badge label={answer.status} tone={statusTone(answer.status)} />
            <Button title={t("common.close", locale)} variant="ghost" size="sm" onPress={clear} />
          </View>
          {answer.answer ? (
            <Text style={styles.answer}>{answer.answer}</Text>
          ) : (
            <Text style={styles.muted}>{t("fatwa.noAnswer", locale)}</Text>
          )}
          {answer.citations.length > 0 ? (
            <View style={styles.cites}>
              <CardTitle>{t("fatwa.citations", locale)}</CardTitle>
              {answer.citations.map((c) => (
                <View key={c.chunk_id} style={styles.cite}>
                  <Text style={styles.citeText} numberOfLines={3}>
                    {c.excerpt}
                  </Text>
                  {c.topic_category ? <Badge label={c.topic_category} tone="info" /> : null}
                </View>
              ))}
            </View>
          ) : null}
          <Text style={styles.disclaimer}>{answer.ai_label}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: spacing[2], padding: spacing[4] },
  muted: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted, textAlign: "center" },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  answer: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.base,
    lineHeight: 28,
    color: common.textPrimary,
    textAlign: "right",
  },
  cites: { gap: spacing[2], marginTop: spacing[2] },
  cite: { gap: spacing[1], padding: spacing[2], backgroundColor: "#f8fafc", borderRadius: 8 },
  citeText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textPrimary, textAlign: "right" },
  disclaimer: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.xs,
    color: common.textMuted,
    textAlign: "right",
    marginTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: common.border,
    paddingTop: spacing[2],
  },
});
