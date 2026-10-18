"use client";

/**
 * ContentCard — per-content-type visual language, driven by the
 * `@maturidi/design-tokens` content-registry spec (layout/aspect/bg/frame/
 * meta/cta/hover). Pure presentation: receives a TemplateItem + template
 * spec key, renders. All user-visible strings arrive via `labels`.
 */
import { useState } from "react";
import {
  TEMPLATE_SPECS,
  type ContentType,
  type TemplateSpec,
} from "@maturidi/design-tokens/content-registry";
import { rosetteSvg } from "@maturidi/design-tokens/cartouche";
import { GEOMETRY_RENDERERS } from "@maturidi/design-tokens/geometry";

export interface TemplateItem {
  id: string;
  title: string;
  subtitle?: string | null;
  author?: string | null;
  category?: string | null;
  duration?: string | null;
  image?: string | null;
  badge?: string | null;
  href?: string | null;
}

export interface ContentCardLabels {
  details: string;
  view: string;
  play: string;
  pause: string;
  verified: string;
  seal: string;
}

export interface ContentCardProps {
  type: ContentType;
  template: string;
  item: TemplateItem;
  dir?: "rtl" | "ltr";
  labels: ContentCardLabels;
}

const ASPECT: Record<TemplateSpec["aspect"], string> = {
  video: "aspect-video",
  portrait: "aspect-[3/4]",
  square: "aspect-square",
  none: "",
};

/* Emerald Glass imperial + grooved gold frame */
const BG: Record<TemplateSpec["bg"], string> = {
  card: "bg-surface border border-border",
  "emerald-glass": "bg-[rgba(7,35,28,0.75)] backdrop-blur-xl border border-[#D4AF37]/35 text-[#EDE6D6]",
  dark: "bg-obsidian text-ivory border border-[color-mix(in_hsl,var(--border)_60%,transparent)]",
  warm: "bg-[color-mix(in_hsl,var(--accent)_8%,var(--surface))]",
  ivory: "bg-ivory text-obsidian border border-border",
  neutral: "bg-muted/40",
  gradient: "bg-gradient-to-br from-[color-mix(in_hsl,var(--primary)_10%,transparent)] to-[color-mix(in_hsl,var(--accent)_8%,transparent)] border border-border",
};

const FRAME: Record<TemplateSpec["frame"], string> = {
  none: "",
  "gold-thin": "ring-1 ring-[#D4AF37]/50 shadow-[0_0_15px_rgba(212,175,55,0.25)]",
  double: "outline outline-1 outline-[color-mix(in_hsl,var(--primary)_35%,transparent)] outline-offset-2",
  bevel: "[clip-path:polygon(14px_0,100%_0,100%_calc(100%-14px),calc(100%-14px)_100%,0_100%,0_14px)]",
  ornamental: "ring-1 ring-[#D4AF37]/55 ring-offset-2 ring-offset-[#D4AF37]/10 shadow-[0_0_18px_rgba(212,175,55,0.28)]",
};

const HOVER: Record<TemplateSpec["hover"], string> = {
  none: "",
  lift: "transition-transform duration-300 hover:-translate-y-1",
  zoom: "group-hover:scale-[1.02] transition-transform duration-300",
  tilt: "transition-transform duration-500 hover:[transform:perspective(800px)_rotateY(-4deg)_rotateX(2deg)]",
  glow: "transition-shadow duration-300 hover:shadow-[0_0_28px_rgba(212,175,55,0.3)]",
};

function RosetteIcon({ size = 44, inner }: { size?: number; inner?: React.ReactNode }) {
  const { svg } = rosetteSvg({ size });
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <span className="absolute inset-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="relative z-10 text-[#E5C07B]">{inner}</span>
    </span>
  );
}

function GeometrySvg({ variant, size = 44 }: { variant: string; size?: number }) {
  const fn = GEOMETRY_RENDERERS[variant];
  if (!fn) return null;
  const svg = fn({ size, color: "hsl(var(--primary))", opacity: 0.85 });
  return <span className="inline-block [&>svg]:size-full" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Waveform({ bars = 14, live = false }: { bars?: number; live?: boolean }) {
  return (
    <span className="flex h-5 items-end gap-[3px]" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full ${live ? "wave-live" : ""}`}
          style={{
            height: `${30 + ((i * 37) % 70)}%`,
            background: "linear-gradient(180deg, #E5C07B, #1a6b52)",
            animationDelay: `${(i % 7) * 0.12}s`,
          }}
        />
      ))}
    </span>
  );
}

function Gyroscope({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="gyro-spin" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" />
      <ellipse cx="12" cy="12" rx="3.6" ry="9" />
    </svg>
  );
}

function Seal({ label }: { label: string }) {
  const { svg } = rosetteSvg({ size: 46 });
  return (
    <span className="relative inline-flex items-center justify-center opacity-90" title={label}>
      <span className="absolute inset-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="relative z-10 text-[9px] font-bold text-[#D4AF37]">{label}</span>
    </span>
  );
}

function PlayFramed({ style }: { style: NonNullable<TemplateSpec["playFramed"]> }) {
  if (style === "geometric") {
    return (
      <span className="flex size-14 items-center justify-center rounded-full border border-current opacity-90">
        <svg viewBox="0 0 24 24" className="size-5 fill-current"><path d="M8 5v14l11-7z" /></svg>
      </span>
    );
  }
  const variant = style === "rosette" ? "rosette" : "star12";
  return (
    <span className="relative flex size-16 items-center justify-center">
      <span className="absolute inset-0 opacity-80"><GeometrySvg variant={variant} size={64} /></span>
      <svg viewBox="0 0 24 24" className="relative size-5 fill-[hsl(var(--primary))]"><path d="M8 5v14l11-7z" /></svg>
    </span>
  );
}

export function ContentCard({ type, template, item, dir = "rtl", labels }: ContentCardProps) {
  const registrySpecs = TEMPLATE_SPECS[type as ContentType];
  const spec: TemplateSpec | undefined =
    registrySpecs?.[template] ?? Object.values(registrySpecs ?? TEMPLATE_SPECS.article)[0];
  const [playing, setPlaying] = useState(false);
  const metaLine = [item.author, item.category, item.duration].filter(Boolean).join(" · ");
  const badge = item.badge ?? null;
  const flip = spec.flip ? "[perspective:1200px] hover:[&>.inner]:[transform:rotateY(-8deg)] [&>.inner]:transition-transform duration-300" : "";

  const isAudio = type === "audio";
  const is360 = type === "video360";
  const isFatwa = type === "fatwa";
  const isBookOrPdf = type === "book" || type === "pdf";
  const frameIcon = is360 ? <Gyroscope /> : isBookOrPdf ? <GeometrySvg variant="mihrab" size={22} /> : <GeometrySvg variant="star8" size={22} />;

  const media = spec.aspect !== "none" && (
    <div className={`relative w-full shrink-0 overflow-hidden ${ASPECT[spec.aspect]} ${type === "video" || is360 ? "video-groove" : ""}`}>
      {item.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <div className={`flex size-full items-center justify-center text-[hsl(var(--primary))] ${isBookOrPdf ? "leather-bg" : "bg-[color-mix(in_hsl,var(--primary)_6%,transparent)]"}`}>
          <span className="opacity-75">{isAudio ? <Waveform bars={12} /> : frameIcon}</span>
        </div>
      )}
      {spec.meta === "overlay" && (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 text-white">
          <span className="block text-sm font-semibold">{item.title}</span>
          {metaLine && <span className="block text-xs opacity-85">{metaLine}</span>}
        </span>
      )}
      {spec.playFramed && spec.layout === "image-top" && (
        <span className="absolute inset-0 flex items-center justify-center">{<PlayFramed style={spec.playFramed} />}</span>
      )}
      {(type === "video" || spec.playFramed) && spec.layout !== "centered-play" && (
        <span className="holo-play absolute end-2 top-2 flex size-9 items-center justify-center rounded-full border border-[#E5C07B]/60 bg-black/45 text-[#E5C07B] backdrop-blur-sm">
          <svg viewBox="0 0 24 24" className="size-4 fill-current"><path d="M8 5v14l11-7z" /></svg>
        </span>
      )}
      {is360 && (
        <span className="absolute end-2 top-2 flex items-center gap-1 rounded-full border border-[#E5C07B]/60 bg-black/55 px-2 py-0.5 text-[10px] font-bold text-[#E5C07B]">
          <Gyroscope size={11} /> 360°
        </span>
      )}
      {isBookOrPdf && (
        <span className="page-flip absolute inset-y-0 end-0 w-1/3 origin-right bg-gradient-to-l from-white/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
      )}
    </div>
  );

  const meta = spec.meta !== "overlay" && (
    <div className={spec.meta === "side" ? "min-w-0 flex-1" : "flex flex-col gap-1"}>
      {spec.meta === "top" && <h3 className="text-sm font-bold leading-snug">{item.title}</h3>}
      {spec.meta !== "top" && <h3 className="font-semibold leading-snug">{item.title}</h3>}
      {item.subtitle && spec.meta !== "top" && <p className="line-clamp-2 text-[0.85rem] leading-7 text-[hsl(var(--text-secondary))]">{item.subtitle}</p>}
      {metaLine && <p className="text-xs text-[hsl(var(--text-muted))] tabular-nums">{metaLine}</p>}
    </div>
  );

  const cta = spec.cta !== "none" && spec.meta !== "overlay" && (
    <span className={`mt-auto ${spec.meta === "side" ? "" : "pt-2"}`}>
      {spec.cta === "text" && <span className="text-xs font-semibold text-[hsl(var(--primary))]">{labels.details}</span>}
      {spec.cta === "button" && <span className="inline-flex rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[hsl(var(--primary-hover))]">{labels.view}</span>}
      {spec.cta === "icon" && <span aria-hidden className="text-[hsl(var(--primary))] transition-transform group-hover:-translate-x-0.5">←</span>}
      {spec.cta === "geometric" && <span className="inline-flex items-center gap-2 text-xs font-semibold text-[hsl(var(--primary))]"><GeometrySvg variant="divider" size={56} /> {labels.view}</span>}
    </span>
  );

  let body: React.ReactNode;
  switch (spec.layout) {
    case "centered-play":
      body = (
        <span className="flex flex-col items-center gap-3 p-5 text-center">
          {spec.playFramed && (
            <button onClick={() => setPlaying(!playing)} aria-pressed={playing} aria-label={playing ? labels.pause : labels.play} className="cursor-pointer transition-transform hover:scale-105">
              <PlayFramed style={spec.playFramed} />
            </button>
          )}
          <h3 className="font-semibold leading-snug">{item.title}</h3>
          {metaLine && <p className="text-xs text-[hsl(var(--text-muted))] tabular-nums">{metaLine}</p>}
          {spec.waveform && <Waveform bars={playing ? 18 : 14} />}
        </span>
      );
      break;
    case "vertical-cover":
      body = (
        <span className="flex flex-col">
          {media}
          {spec.meta !== "overlay" && <span className="flex flex-col gap-1.5 p-4">{meta}{cta}</span>}
        </span>
      );
      break;
    case "editorial-column":
      body = (
        <span className="flex flex-col">
          {media}
          <span className="flex flex-1 flex-col gap-2 p-4">
            {item.category && <span className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--primary))]">{item.category}</span>}
            {meta}
            {cta}
          </span>
        </span>
      );
      break;
    case "text-first":
      body = (
        <span className="flex flex-col gap-2 p-5">
          {badge && <span className="text-[11px] font-bold text-[hsl(var(--accent))]">{badge}</span>}
          <h3 className="font-bold leading-snug">{item.title}</h3>
          {item.subtitle && <p className="line-clamp-3 text-sm opacity-70">{item.subtitle}</p>}
          {metaLine && <p className="text-xs opacity-60">{metaLine}</p>}
          {isFatwa && <span className="mt-1 flex items-center justify-between"><Seal label={labels.seal} /><span className="text-[10px] text-[hsl(var(--text-muted))]">{labels.verified}</span></span>}
          {cta}
        </span>
      );
      break;
    case "split":
      body = (
        <span className="flex gap-3 p-3">
          {media}
          <span className="flex min-w-0 flex-col gap-1.5">{meta}{cta}</span>
        </span>
      );
      break;
    case "row":
      body = (
        <span className="flex items-center gap-3 p-3">
          <span className="shrink-0 text-[hsl(var(--primary))]"><GeometrySvg variant="star8" size={30} /></span>
          {meta}
          {cta}
        </span>
      );
      break;
    case "card-deck":
      body = (
        <span className="relative flex flex-col">
          {media}
          <span className="absolute inset-x-3 top-2 h-full rounded-lg bg-black/10" aria-hidden />
          <span className="relative flex flex-col gap-1.5 p-4">{meta}{cta}</span>
        </span>
      );
      break;
    case "image-top":
    default:
      body = (
        <span className="flex flex-col">{media}<span className="flex flex-col gap-1.5 p-4">{meta}{cta}</span></span>
      );
  }

  const Tag = item.href ? "a" : "div";
  return (
    <Tag
      href={item.href ?? undefined}
      dir={dir}
      data-template={template}
      data-type={type}
      className={`group relative block overflow-hidden rounded-xl ${BG[spec.bg]} ${FRAME[spec.frame]} ${HOVER[spec.hover]} ${flip} ${isAudio ? "audio-cartouche" : ""}`}
      aria-label={item.title}
    >
      <span className="inner block">{body}</span>
    </Tag>
  );
}
