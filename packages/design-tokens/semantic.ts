/**
 * Design tokens v2 — semantic system (Master UI/UX refinement §۲/§۴).
 * هر state صریح؛ contrast-checked؛ dark مستقل (نه inversion).
 */

export type ThemeName = "light" | "dark";

export interface SemanticColors {
  background: string;
  surface: string;
  "surface-elevated": string;
  "surface-glass": string;
  "text-primary": string;
  "text-secondary": string;
  "text-muted": string;
  border: string;
  "border-strong": string;
  accent: string;
  "accent-soft": string;
  primary: string;
  "primary-hover": string;
  "primary-soft": string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  focus: string;
}

/** light — ivory زمینه، emerald نهاد، gold فقط accent */
export const LIGHT: SemanticColors = {
  background: "45 35% 98%",
  surface: "0 0% 100%",
  "surface-elevated": "0 0% 100%",
  "surface-glass": "0 0% 100% / 0.72",
  "text-primary": "165 20% 12%",
  "text-secondary": "165 10% 30%",
  "text-muted": "165 6% 48%",
  border: "150 16% 88%",
  "border-strong": "160 12% 78%",
  accent: "42 72% 44%",
  "accent-soft": "42 72% 44% / 0.14",
  primary: "161 58% 24%",
  "primary-hover": "161 55% 30%",
  "primary-soft": "161 58% 24% / 0.10",
  success: "152 48% 30%",
  warning: "34 72% 42%",
  danger: "0 58% 42%",
  info: "205 60% 36%",
  focus: "161 58% 24%",
};

/** dark — obsidian-green؛ سطوح لایه‌لایه؛ gold روشن‌تر برای contrast */
export const DARK: SemanticColors = {
  background: "168 26% 6%",
  surface: "168 20% 9%",
  "surface-elevated": "168 18% 12%",
  "surface-glass": "168 20% 10% / 0.68",
  "text-primary": "120 14% 92%",
  "text-secondary": "140 8% 72%",
  "text-muted": "150 6% 52%",
  border: "168 12% 20%",
  "border-strong": "168 10% 30%",
  accent: "42 62% 60%",
  "accent-soft": "42 62% 60% / 0.16",
  primary: "160 38% 42%",
  "primary-hover": "160 40% 50%",
  "primary-soft": "160 38% 42% / 0.16",
  success: "150 40% 48%",
  warning: "34 60% 52%",
  danger: "0 48% 56%",
  info: "205 45% 55%",
  focus: "42 62% 60%",
};

export const STATE_TOKENS = {
  "dur-fast": "120ms",
  "dur-base": "220ms",
  "dur-slow": "420ms",
  "dur-reveal": "680ms",
  "ease-out": "cubic-bezier(0.22, 1, 0.36, 1)",
  "ease-spring": "cubic-bezier(0.34, 1.3, 0.5, 1)",
  "focus-ring": "0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--focus))",
  "focus-ring-offset": "2px",
};

export const SPACING_V2 = {
  section: "clamp(3.5rem, 7vw, 6.5rem)",
  gutter: "clamp(1rem, 4vw, 2.5rem)",
  container: "78rem",
  "container-wide": "88rem",
  rhythm: "1.5rem",
};

export const TYPE_SCALE_V2 = {
  "institution": "clamp(1.05rem, 2vw, 1.3rem) / 800",
  "display": "clamp(2rem, 4.2vw, 3.2rem) / 700",
  "h2-section": "clamp(1.35rem, 2.6vw, 1.85rem) / 700",
  "card-title": "1.02rem / 650",
  "body": "0.97rem / 400",
  "meta": "0.78rem / 500",
  "label": "0.72rem / 600",
};

/** قواعد مصرف: عناوین راست‌چین، پاراگراف‌ها justify نه center، خطوط کوتاه */
export const TYPE_RULES = {
  maxMeasureCh: 66,
  lineHeightFa: 1.9,
  lineHeightAr: 1.85,
  lineHeightEn: 1.65,
};
