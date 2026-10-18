/**
 * Cartouche & Rosette Engine — الحاقیهٔ سیستم بصری §۱.
 * کتیبه: باکس افقی کشیده با انتهای قوسی محرابی؛ ترنج: شمسهٔ ۱۲پر.
 * هر دو پارامتریک و برداری (SVG path مولد) — ریسپانسیو، بدون PNG.
 */

/** path کتیبه — عرض/ارتفاع دلخواه، نوک قوس با ضریب tipH */
export function cartouchePath(w: number, h: number, tipW = 34, tipH = 0.62): string {
  // بدنه: مستطیل با انتهای قوسی محرابی (چپ/راست)
  const bodyL = tipW;
  const bodyR = w - tipW;
  const midY = h / 2;
  const tipY = h * (0.5 - tipH / 2);
  const tipY2 = h * (0.5 + tipH / 2);
  // قوس چپ: از بالا-چپ بدنه به نوک میانی سپس پایین-چپ
  return [
    `M ${bodyL} ${tipY}`,
    `C ${bodyL * 0.25} ${tipY}, 0 ${midY * 0.55}, 0 ${midY}`,
    `C 0 ${midY * 1.45}, ${bodyL * 0.25} ${tipY2}, ${bodyL} ${tipY2}`,
    `L ${bodyR} ${h - tipY}`,
    `C ${(w - bodyL * 0.25)} ${tipY2}, ${w} ${midY * 1.45}, ${w} ${midY}`,
    `C ${w} ${midY * 0.55}, ${(w - bodyL * 0.25)} ${tipY}, ${bodyR} ${tipY}`,
    "Z",
  ].join(" ");
}

/** SVG کتیبهٔ کامل — قاب طلایی + واترمارک شمسه + لایهٔ شیشه */
export function cartoucheSvg(opts: {
  w?: number; h?: number; uid?: string;
  gold?: string; gold2?: string; glass?: string; waterOpacity?: number;
}): { svg: string; pathId: string; w: number; h: number } {
  const {
    w = 640, h = 120, uid = `c${Math.random().toString(36).slice(2, 8)}`,
    gold = "#D4AF37", gold2 = "#E5C07B", glass = "rgba(7,35,28,0.75)", waterOpacity = 0.04,
  } = opts;
  const d = cartouchePath(w, h);
  const pathId = `${uid}-p`;
  const gradId = `${uid}-g`;
  const rosette = rosetteSvg({ size: h * 0.72, gold, gold2, uid: `${uid}-r` }).svg;
  const rosetteX = w - h * 0.52;
  const rosetteY = h / 2;
  const svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${gold2}"/><stop offset="0.5" stop-color="${gold}"/><stop offset="1" stop-color="${gold2}"/>
    </linearGradient>
    <clipPath id="${pathId}"><path d="${d}"/></clipPath>
  </defs>
  <g clip-path="url(#${pathId})">
    <rect width="${w}" height="${h}" fill="${glass}"/>
    <g transform="translate(${w * 0.5 - h * 0.9}, ${h * 0.5 - h * 0.9})" opacity="${waterOpacity}">${rosetteSvg({ size: h * 1.8, gold, gold2, uid: `${uid}-w` }).svg}</g>
  </g>
  <path d="${d}" fill="none" stroke="url(#${gradId})" stroke-width="1.4" style="filter: drop-shadow(0 0 6px rgba(212,175,55,0.28))"/>
  <g transform="translate(${rosetteX}, ${rosetteY})">${rosette}</g>
</svg>`;
  return { svg, pathId, w, h };
}

/** شمسهٔ ۱۲پر — ستارهٔ لایه‌لایه با دایرهٔ مرکزی */
export function rosetteSvg(opts: { size?: number; gold?: string; gold2?: string; uid?: string; points?: number }): { svg: string } {
  const { size = 88, gold = "#D4AF37", gold2 = "#E5C07B", uid = `r${Math.random().toString(36).slice(2, 8)}`, points = 12 } = opts;
  const c = size / 2;
  const rO = c * 0.92;
  const rI = c * 0.62;
  let star = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rO : rI;
    const a = (Math.PI * i) / points;
    star += (i === 0 ? "M" : "L") + (c + r * Math.sin(a)).toFixed(2) + " " + (c - r * Math.cos(a)).toFixed(2);
  }
  star += "Z";
  let inner = "";
  for (let i = 0; i < points; i++) {
    const a = (2 * Math.PI * i) / points;
    const px = (c + rI * 0.52 * Math.sin(a)).toFixed(2);
    const py = (c - rI * 0.52 * Math.cos(a)).toFixed(2);
    inner += `<circle cx="${px}" cy="${py}" r="${(c * 0.16).toFixed(2)}"/>`;
  }
  const gradId = `${uid}-g`;
  const svg = `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs><radialGradient id="${gradId}">
    <stop offset="0" stop-color="${gold2}" stop-opacity="0.95"/><stop offset="1" stop-color="${gold}" stop-opacity="0.75"/>
  </radialGradient></defs>
  <g fill="none" stroke="url(#${gradId})" stroke-width="1.3" style="filter: drop-shadow(0 0 5px rgba(212,175,55,0.3))">
    <path d="${star}"/><circle cx="${c}" cy="${c}" r="${(rI * 0.95).toFixed(2)}"/>${inner}
    <circle cx="${c}" cy="${c}" r="${(c * 0.22).toFixed(2)}"/>
  </g></svg>`;
  return { svg };
}

/** CSS clip-path کتیبه (برای باکس‌های HTML با محتوای واقعی) — مقادیر % تا ریسپانسیو بماند */
export function cartoucheClip(tipW = "34px"): string {
  return `polygon(
    ${tipW} 6%, 6% 26%, 0 50%, 6% 74%, ${tipW} 94%,
    calc(100% - ${tipW}) 94%, calc(100% - 6%) 74%, 100% 50%, calc(100% - 6%) 26%, calc(100% - ${tipW}) 6%
  )`;
}
