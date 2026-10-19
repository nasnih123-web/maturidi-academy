/**
 * @maturidi/ui-native — TextField.tsx
 *
 * Presentational only: labelled text input with an optional error line.
 * The parent owns the value (controlled input) — this component holds no state.
 */
import React from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { common, fontFamily, fontSize, palette, radius, spacing } from "./rn-theme";

export interface TextFieldProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "phone-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  multiline?: boolean;
  numberOfLines?: number;
  error?: string | null;
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  testID?: string;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType = "default",
  autoCapitalize = "sentences",
  multiline = false,
  numberOfLines = 1,
  error,
  editable = true,
  style,
  inputStyle,
  testID,
}: TextFieldProps): React.JSX.Element {
  return (
    <View style={style} testID={testID}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.gray[400]}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        numberOfLines={numberOfLines}
        editable={editable}
        textAlign="right"
        style={[
          styles.input,
          multiline && styles.multiline,
          error ? styles.inputError : null,
          inputStyle,
        ]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.sm,
    color: common.textMuted,
    marginBottom: spacing[1],
  },
  input: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.base,
    color: common.textPrimary,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: common.border,
    borderRadius: radius.lg,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    textAlign: "right",
  },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  inputError: { borderColor: palette.dangerSolid },
  error: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.xs,
    color: palette.dangerSolid,
    marginTop: spacing[1],
  },
});
