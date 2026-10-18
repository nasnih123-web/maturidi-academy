import React from "react";
import { useI18n, type Locale } from "./i18n";

/**
 * Font service — per-locale typography for the CRM (ADR-001: presentation
 * logic lives here, components stay dumb).
 *
 * - Built-in self-hosted fonts: fa → Vazirmatn, ar → Cairo, en → Inter.
 *   The @font-face rules below are the web app's declarations verbatim
 *   (apps/web/app/[locale]/globals.css); the woff2 files were copied to
 *   apps/crm/public/fonts/.
 * - Admin-uploaded fonts (platform_settings keys `fonts.fa|ar|en`,
 *   {family, url}) are injected as @font-face with `font-display: swap`
 *   and used INSTEAD of the built-in for that locale.
 * - The active stack is exposed on <html> via --x-font / --ma-font-body
 *   plus a data attribute; components just inherit it.
 */

export interface UploadedFont {
  family: string;
  url: string;
}

export const BUILT_IN_FAMILY: Record<Locale, string> = {
  fa: "Vazirmatn",
  ar: "Cairo",
  en: "Inter",
};

const AR_VAZIR =
  "U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200D";
const LAT_VAZIR = "U+0000-05FF, U+2000-206F";
const AR_CAIRO =
  "U+0600-06FF, U+0750-077F, U+0870-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC7, U+10EC9-10EEE, U+10EF0-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1";
const LAT_CAIRO =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

interface FaceDef {
  family: "Vazirmatn" | "Cairo" | "Inter";
  file: string;
  weight: 400 | 500 | 700;
  range: string;
}

const FACES: FaceDef[] = [];
for (const weight of [400, 500, 700] as const) {
  FACES.push(
    { family: "Vazirmatn", file: `vazirmatn-arabic-${weight}.woff2`, weight, range: AR_VAZIR },
    { family: "Vazirmatn", file: `vazirmatn-latin-${weight}.woff2`, weight, range: LAT_VAZIR },
    { family: "Cairo", file: `cairo-arabic-${weight}.woff2`, weight, range: AR_CAIRO },
    { family: "Cairo", file: `cairo-latin-${weight}.woff2`, weight, range: LAT_CAIRO },
    { family: "Inter", file: `inter-latin-${weight}.woff2`, weight, range: LAT_CAIRO },
  );
}

function builtInCss(): string {
  return FACES.map(
    (f) =>
      `@font-face {\n` +
      `  font-family: "${f.family}";\n` +
      `  src: url("/fonts/${f.file}") format("woff2");\n` +
      `  font-weight: ${f.weight}; font-style: normal; font-display: swap;\n` +
      `  unicode-range: ${f.range};\n` +
      `}`,
  ).join("\n");
}

/** Idempotent injection of the built-in @font-face rules. */
export function injectBuiltInFonts(): void {
  if (typeof document === "undefined") return;
  const sel = 'style[data-crm-fonts="builtin"]';
  let el = document.querySelector<HTMLStyleElement>(sel);
  if (!el) {
    el = document.createElement("style");
    el.setAttribute("data-crm-fonts", "builtin");
    document.head.appendChild(el);
  }
  if (!el.textContent) el.textContent = builtInCss();
}

/**
 * Inject (or remove, when null) the admin-uploaded @font-face for one
 * locale. Weight range 400–700 so bold/700 text still renders.
 */
export function setUploadedFont(locale: Locale, font: UploadedFont | null): void {
  if (typeof document === "undefined") return;
  const sel = `style[data-crm-fonts="custom-${locale}"]`;
  let el = document.querySelector<HTMLStyleElement>(sel);
  if (!font) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.setAttribute("data-crm-fonts", `custom-${locale}`);
    document.head.appendChild(el);
  }
  const safeFamily = font.family.replace(/["\\]/g, "");
  el.textContent =
    `@font-face {\n` +
    `  font-family: "${safeFamily}";\n` +
    `  src: url("${font.url}") format("woff2");\n` +
    `  font-weight: 400 700; font-style: normal; font-display: swap;\n` +
    `}`;
}

/** Apply the active locale's font stack to the document. */
export function applyLocaleFont(locale: Locale, uploaded: UploadedFont | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const stack = uploaded
    ? `"${uploaded.family.replace(/["\\]/g, "")}", "${BUILT_IN_FAMILY[locale]}", "Segoe UI", Tahoma, Arial, sans-serif`
    : `"${BUILT_IN_FAMILY[locale]}", "Segoe UI", Tahoma, Arial, sans-serif`;
  root.style.setProperty("--x-font", stack);
  root.style.setProperty("--ma-font-body", stack);
  root.style.fontFamily = stack;
  root.setAttribute("data-crm-font-locale", locale);
}

/**
 * React hook: keep the document fonts in sync with the CRM locale and any
 * admin-uploaded fonts. Idempotent; safe to call once at the app root.
 */
export function useCrmFonts(
  uploaded: Record<Locale, UploadedFont | null>,
): void {
  const { locale } = useI18n();
  const key = JSON.stringify(uploaded);

  React.useEffect(() => {
    injectBuiltInFonts();
  }, []);

  React.useEffect(() => {
    const parsed = JSON.parse(key) as Record<Locale, UploadedFont | null>;
    (Object.keys(parsed) as Locale[]).forEach((l) => setUploadedFont(l, parsed[l]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  React.useEffect(() => {
    const parsed = JSON.parse(key) as Record<Locale, UploadedFont | null>;
    applyLocaleFont(locale, parsed[locale] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, key]);
}
