/**
 * apps/mobile — src/screens/AuthScreen.tsx
 *
 * Sign-in / registration. Presentational: all auth mechanics live in
 * hooks/useAuth → services/auth. The navigator's auth gate reacts to the
 * session status — this screen never navigates itself.
 */
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Button, Card, common, fontFamily, fontSize, Screen, spacing, TextField } from "@maturidi/ui-native";
import { useAuth, useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";

export function AuthScreen(): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { login, register, busy } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [fullName, setFullName] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setFormError(null);    if (mode === "login") {
      if (!identifier.trim()) return setFormError(t("auth.needIdentifier", locale));
      if (!password) return setFormError(t("auth.needPassword", locale));
      const ok = await login({ identifier, password, totpCode: totp || undefined });
      if (!ok) setFormError(t("auth.loginFailed", locale));
    } else {
      if (!fullName.trim()) return setFormError(t("auth.needName", locale));
      if (!identifier.trim()) return setFormError(t("auth.needIdentifier", locale));
      if (!password) return setFormError(t("auth.needPassword", locale));
      if (!acceptTerms) return setFormError(t("auth.needTerms", locale));
      const isEmail = identifier.includes("@");
      const ok = await register({
        fullName,
        email: isEmail ? identifier : undefined,
        phone: isEmail ? undefined : identifier,
        password,
        locale,
      });
      if (!ok) setFormError(t("auth.registerFailed", locale));
    }
  };


  return (
    <Screen title={t("auth.title", locale)} subtitle={t("auth.subtitle", locale)}>
      <Card>
        {mode === "register" ? (
          <TextField
            label={t("auth.fullName", locale)}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            testID="auth-fullname"
          />
        ) : null}
        <TextField
          label={t("auth.identifier", locale)}
          value={identifier}
          onChangeText={setIdentifier}
          placeholder={t("auth.identifierPlaceholder", locale)}
          keyboardType="email-address"
          autoCapitalize="none"
          testID="auth-identifier"
        />
        <TextField
          label={t("auth.password", locale)}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          testID="auth-password"
        />
        {mode === "login" ? (
          <TextField
            label={t("auth.totp", locale)}
            value={totp}
            onChangeText={setTotp}
            placeholder={t("auth.totpHint", locale)}
            keyboardType="numeric"
            autoCapitalize="none"
          />
        ) : null}
        {mode === "register" ? (
          <TouchableOpacity
            onPress={() => setAcceptTerms((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptTerms }}
            style={styles.termsRow}
          >
            <View style={[styles.checkbox, acceptTerms && styles.checkboxOn]} />
            <Text style={styles.termsText}>{t("auth.acceptTerms", locale)}</Text>
          </TouchableOpacity>
        ) : null}
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <Button
          title={t(mode === "login" ? "auth.login" : "auth.register", locale)}
          onPress={submit}
          loading={busy}
          testID="auth-submit"
        />
        <TouchableOpacity onPress={() => setMode((m) => (m === "login" ? "register" : "login"))}>
          <Text style={styles.switch}>{t(mode === "login" ? "auth.noAccount" : "auth.haveAccount", locale)}</Text>
        </TouchableOpacity>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: "#b91c1c", textAlign: "center" },
  switch: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.sm,
    color: common.primary,
    textAlign: "center",
    marginTop: spacing[2],
  },
  termsRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: common.border },
  checkboxOn: { backgroundColor: common.primary, borderColor: common.primary },
  termsText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textPrimary, flex: 1 },
});
