/**
 * Islamic Geometry Engine — رندررهای پارامتریک (MP v10 Phase 3 §۷).
 * هر شکل = SVG تولیدشده از پارامترها؛ هیچ PNG/SVG ثابت "سیستم" نیست.
 */
export interface GeometryParams {
  size?: number;
  rotation?: number;
  density?: number;
  stroke?: number;
  color?: string;
  opacity?: number;
  glow?: boolean;
}

function polyPoints(cx: number, cy: number, r: number, n: number, rot: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (2 * Math.PI * i) / n;
    pts.push(`${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function starPath(cx: number, cy: number, rOuter: number, rInner: number, points: number, rot: number): string {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rot + (Math.PI * i) / points;
    const x = (cx + r * Math.sin(a)).toFixed(2);
    const y = (cy - r * Math.cos(a)).toFixed(2);
    d += (i === 0 ? "M" : "L") + x + " " + y;
  }
  return d + "Z";
}

/** star8 — هشت‌پر کلاسیک با دو مربع چرخیده */
export function Star8(p: GeometryParams = {}): string {
  const { size = 96, rotation = 0, stroke = 1.4, color = "currentColor", opacity = 1, density = 1 } = p;
  const c = size / 2;
  const r = c * 0.86 * density;
  const rot = (rotation * Math.PI) / 180;
  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="${color}" stroke-width="${stroke}" opacity="${opacity}">
    <rect x="${c - r * 0.7}" y="${c - r * 0.7}" width="${r * 1.4}" height="${r * 1.4}" transform="rotate(${rotation} ${c} ${c})"/>
    <rect x="${c - r * 0.7}" y="${c - r * 0.7}" width="${r * 1.4}" height="${r * 1.4}" transform="rotate(${rotation + 45} ${c} ${c})"/>
    <circle cx="${c}" cy="${c}" r="${r * 0.34}"/>
  </g>
</svg>`;
}

/** star6 — شش‌پر */
export function Star6(p: GeometryParams = {}): string {
  const { size = 96, rotation = 0, stroke = 1.4, color = "currentColor", opacity = 1 } = p;
  const c = size / 2;
  const r = c * 0.85;
  const rot = (rotation * Math.PI) / 180;
  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="${color}" stroke-width="${stroke}" opacity="${opacity}">
    <polygon points="${polyPoints(c, c, r, 6, rot)}"/>
    <polygon points="${polyPoints(c, c, r, 6, rot + Math.PI / 6)}"/>
  </g>
</svg>`;
}

/** star12 — دوازده‌پر */
export function Star12(p: GeometryParams = {}): string {
  const { size = 96, stroke = 1.3, color = "currentColor", opacity = 1 } = p;
  const c = size / 2;
  const star = starPath(c, c, c * 0.9, c * 0.62, 12, 0);
  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="${color}" stroke-width="${stroke}" opacity="${opacity}">
    <path d="${star}"/><circle cx="${c}" cy="${c}" r="${c * 0.28}"/>
  </g>
</svg>`;
}

/** rosette — ترنج */
export function Rosette(p: GeometryParams = {}): string {
  const { size = 96, stroke = 1.3, color = "currentColor", opacity = 1, density = 1 } = p;
  const c = size / 2;
  const petals = Math.max(6, Math.round(8 * density));
  const r = c * 0.82;
  let paths = "";
  for (let i = 0; i < petals; i++) {
    const a = (2 * Math.PI * i) / petals;
    const px = c + r * 0.45 * Math.sin(a);
    const py = c - r * 0.45 * Math.cos(a);
    paths += `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${(r * 0.3).toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="${color}" stroke-width="${stroke}" opacity="${opacity}">${paths}
  <circle cx="${c}" cy="${c}" r="${r * 0.24}"/></g></svg>`;
}

/** lattice — شبکهٔ هندسی تکرارشونده (pattern) */
export function Lattice(p: GeometryParams = {}): string {
  const { size = 48, stroke = 1.1, color = "currentColor", opacity = 0.5 } = p;
  const h = size / 2;
  return `<svg width="${size * 4}" height="${size * 4}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs><pattern id="lat" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
  <g fill="none" stroke="${color}" stroke-width="${stroke}" opacity="${opacity}">
    <rect x="${h * 0.3}" y="${h * 0.3}" width="${h * 1.4}" height="${h * 1.4}"/>
    <rect x="${h * 0.3}" y="${h * 0.3}" width="${h * 1.4}" height="${h * 1.4}" transform="rotate(45 ${h} ${h})"/>
  </g></pattern></defs>
  <rect width="100%" height="100%" fill="url(#lat)"/></svg>`;
}

/** ornamental-frame — قاب محرابی (mihrab arch) */
export function MihrabFrame(p: GeometryParams = {}): string {
  const { size = 120, stroke = 1.6, color = "currentColor", opacity = 1 } = p;
  const w = size;
  const h = size * 1.3;
  const r = w / 2;
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M ${w - stroke} ${h - stroke} L ${w - stroke} ${r}
           A ${r - stroke} ${r - stroke} 0 0 0 ${stroke} ${r}
           L ${stroke} ${h - stroke} Z"
        fill="none" stroke="${color}" stroke-width="${stroke}" opacity="${opacity}"/>
  <path d="M ${w * 0.18} ${h - stroke * 3} L ${w * 0.18} ${r * 1.1}
           A ${r * 0.82} ${r * 0.82} 0 0 0 ${w * 0.82} ${r * 1.1}
           L ${w * 0.82} ${h - stroke * 3}"
        fill="none" stroke="${color}" stroke-width="${stroke * 0.7}" opacity="${opacity * 0.6}"/>
</svg>`;
}

/** divider — جداکنندهٔ هندسی */
export function Divider(p: GeometryParams = {}): string {
  const { size = 200, stroke = 1.2, color = "currentColor", opacity = 0.7 } = p;
  const c = size / 2;
  const star = starPath(c, 12, 9, 4.5, 8, 0);
  return `<svg viewBox="0 0 ${size} 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="${color}" stroke-width="${stroke}" opacity="${opacity}">
    <line x1="0" y1="12" x2="${c - 16}" y2="12"/>
    <path d="${star}"/>
    <line x1="${c + 16}" y1="12" x2="${size}" y2="12"/>
  </g></svg>`;
}

export const GEOMETRY_RENDERERS: Record<string, (p?: GeometryParams) => string> = {
  star8: Star8,
  star6: Star6,
  star12: Star12,
  rosette: Rosette,
  lattice: Lattice,
  mihrab: MihrabFrame,
  divider: Divider,
};

export type GeometryVariant = keyof typeof GEOMETRY_RENDERERS;
