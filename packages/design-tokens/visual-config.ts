/**
 * Visual Experience schema — ساختاریافته و type-safe (قرارداد §۱۸).
 * Global → Channel → Page → Section → Content Type → Variant → State
 * هیچ raw CSS/JS از ادمین — فقط این اسکما.
 */

export type Channel = "web" | "crm" | "mobile" | "desktop";
export type GeometryVariant = "star8" | "star6" | "star12" | "rosette" | "lattice";

export interface ColorOverrides {
  primary?: string;
  accent?: string;
  background?: string;
  surface?: string;
  text?: string;
  border?: string;
}

export interface VisualEffects {
  glow_strength: number; // 0..1
  shadow_strength: number; // 0..1.5
  pattern_opacity: number; // 0..0.3
  geometry_variant: GeometryVariant;
}

export interface MotionConfig {
  intensity: number; // 0..1 — 0 = reduced-motion equivalent
  speed: number; // 0.5..2
}

export interface Hero3DConfig {
  enabled: boolean;
  quality: "off" | "low" | "high";
  particles: boolean;
  animation_enabled: boolean;
  animation_type: "float" | "rotate" | "pulse" | "orbit";
  speed: number; // 0.5..2
  intensity: number; // 0..1
  float_amount: number; // px 0..40
  rotation: number; // deg 0..30
  glow_intensity: number; // 0..1
  particle_density: number; // 0..1
  lighting_intensity: number; // 0..1
  transition_duration: number; // s 0.3..2
  layout: "two-column" | "centered" | "immersive";
  title_override?: { fa?: string; ar?: string; en?: string } | null;
}

export interface ChannelOverrides {
  density?: "compact" | "comfortable" | "spacious" | null;
  radius?: "sharp" | "soft" | "round" | null;
  effects?: Partial<VisualEffects> | null;
  motion?: Partial<MotionConfig> | null;
  hero_3d?: Partial<Hero3DConfig> | null;
}

export interface VisualConfig {
  version: number;
  colors: ColorOverrides;
  typography: { heading_scale: number; body_scale: number };
  effects: VisualEffects;
  motion: MotionConfig;
  radius: "sharp" | "soft" | "round";
  density: "compact" | "comfortable" | "spacious";
  channels: Partial<Record<Channel, ChannelOverrides>>;
  backgrounds: Record<string, string>; // section → treatment id
  content_types: Record<string, { template?: string }>;
  hero_3d?: Partial<Hero3DConfig>; // resolved for channel by API
}

export const DEFAULT_VISUAL_CONFIG: VisualConfig = {
  version: 1,
  colors: {},
  typography: { heading_scale: 1.0, body_scale: 1.0 },
  effects: { glow_strength: 0.6, shadow_strength: 0.8, pattern_opacity: 0.06, geometry_variant: "star8" },
  motion: { intensity: 1.0, speed: 1.0 },
  radius: "soft",
  density: "comfortable",
  channels: {},
  backgrounds: {},
  content_types: {},
};

/** resolve: Global → Channel override (بدون جهش داده) */
export function resolveChannel(config: VisualConfig, channel: Channel): VisualConfig {
  const ov = config.channels[channel] || {};
  return {
    ...config,
    density: ov.density ?? config.density,
    radius: ov.radius ?? config.radius,
    effects: { ...config.effects, ...(ov.effects ?? {}) },
    motion: { ...config.motion, ...(ov.motion ?? {}) },
    channels: { [channel]: ov },
  } as VisualConfig;
}

/** اعمال پیکربندی روی CSS vars صفحه — مصرف layout */
export function visualConfigToCssVars(config: VisualConfig): Record<string, string> {
  const vars: Record<string, string> = {};
  const c = config.colors;
  if (c.primary) vars["--primary"] = c.primary;
  if (c.accent) vars["--accent"] = c.accent;
  if (c.background) vars["--background"] = c.background;
  if (c.surface) vars["--surface"] = c.surface;
  if (c.text) vars["--foreground"] = c.text;
  if (c.border) vars["--border"] = c.border;
  vars["--glow-strength"] = String(config.effects.glow_strength);
  vars["--pattern-opacity"] = String(config.effects.pattern_opacity);
  vars["--motion-intensity"] = String(config.motion.intensity);
  vars["--motion-speed"] = String(config.motion.speed);
  return vars;
}
