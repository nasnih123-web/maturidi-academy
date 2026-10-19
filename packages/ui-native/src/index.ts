/**
 * @maturidi/ui-native — index.ts
 *
 * Public surface of the shared React Native UI kit. Presentational
 * components + the RN theme accessor only — no business logic
 * (engineering-contract §15, ADR 0002 / ADR-001).
 */
export { tokens } from "@maturidi/design-tokens/tokens";
export type { Tokens } from "@maturidi/design-tokens/tokens";

export {
  palette,
  spacing,
  fontSize,
  fontWeight,
  radius,
  fontFamily,
  common,
  shadow,
} from "./rn-theme";
export type { FontFamilyKey } from "./rn-theme";

export { Button } from "./Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";

export { Card, CardContent, CardHeader, CardTitle } from "./Card";
export type { CardProps } from "./Card";

export { Badge, statusTone } from "./Badge";
export type { BadgeProps, BadgeTone } from "./Badge";

export { TextField } from "./TextField";
export type { TextFieldProps } from "./TextField";

export { Screen } from "./Screen";
export type { ScreenProps } from "./Screen";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { SectionHeader } from "./SectionHeader";
export type { SectionHeaderProps } from "./SectionHeader";

export { ProgressBar } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";
