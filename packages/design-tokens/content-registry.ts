/**
 * Content Template Registry — 10 نوع × 10 قالب = 100 (MP v10 Phase 3 §۱۴–§۲۳).
 * قرارداد مشترک با API (visual/templates). هر قالب spec ساختاریافته دارد —
 * رندر از spec، نه کد جدا per-قالب.
 */

export type ContentType =
  | "pdf" | "article" | "audio" | "video" | "video360"
  | "book" | "fatwa" | "course" | "community" | "place";

export type SliderKind = "featured-rail" | "rail" | "shelf" | "carousel" | "grid" | "stack";
export type Layout = "image-top" | "vertical-cover" | "editorial-column" | "centered-play" | "text-first" | "split" | "overlay-meta" | "row" | "card-deck" | "poster";
export type Tier = 0 | 1 | 2 | 3; // افکت: 0 خام → 3 سینمایی

export interface TemplateSpec {
  layout: Layout;
  aspect: "video" | "portrait" | "square" | "none";
  bg: "card" | "emerald-glass" | "dark" | "warm" | "ivory" | "neutral" | "gradient";
  frame: "none" | "gold-thin" | "double" | "bevel" | "ornamental";
  meta: "below" | "overlay" | "side" | "top";
  cta: "none" | "text" | "button" | "icon" | "geometric";
  tier: Tier;
  hover: "none" | "lift" | "zoom" | "tilt" | "glow";
  badge3d?: boolean;
  flip?: boolean;
  ambient?: boolean;
  playFramed?: "rosette" | "shamsa" | "geometric" | false;
  waveform?: boolean;
  orb?: boolean;
}

export interface TemplateDef {
  id: string;
  label: { fa: string; ar: string; en: string };
}

export interface ContentTypeDef {
  templates: TemplateDef[];
  default: string;
  slider: SliderKind;
}

const t = (id: string, fa: string, ar: string, en: string): TemplateDef => ({ id, label: { fa, ar, en } });

/** پرچم‌های نوع-محتوایی که spec قالب‌ها آن‌ها را فعال می‌کنند */
const A = { playFramed: "rosette" as const, waveform: true };
const S = { playFramed: "shamsa" as const, waveform: true };
const V = { playFramed: "geometric" as const };
const O = { orb: true };
const F = { flip: true };

export const CONTENT_REGISTRY: Record<ContentType, ContentTypeDef> = {
  pdf: {
    templates: [
      t("manuscript", "نسخهٔ خطی", "مخطوط", "Manuscript"),
      t("archive", "آرشیوی", "أرشيفي", "Archive"),
      t("editorial", "تحریریه‌ای", "تحريري", "Editorial"),
      t("geometric", "هندسی", "هندسي", "Geometric"),
      t("luminous", "درخشان", "مضيء", "Luminous"),
      t("classical", "کلاسیک", "كلاسيكي", "Classical"),
      t("glass", "شیشه‌ای", "زجاجي", "Glass"),
      t("premium", "پریمیوم", "مميز", "Premium"),
      t("scholar", "علمی", "علمي", "Scholar"),
      t("library", "کتابخانه‌ای", "مكتبة", "Library"),
    ],
    default: "manuscript",
    slider: "shelf",
  },
  article: {
    templates: [
      t("magazine", "مجله‌ای", "مجلة", "Magazine"),
      t("editorial", "تحریریه‌ای", "تحريري", "Editorial"),
      t("featured", "ویژه", "مميز", "Featured"),
      t("asymmetric", "نامتقارن", "غير متماثل", "Asymmetric"),
      t("scholar", "علمی", "علمي", "Scholar"),
      t("minimal", "مینیمال", "بسيط", "Minimal"),
      t("geometric", "هندسی", "هندسي", "Geometric"),
      t("cinematic", "سینمایی", "سينمائي", "Cinematic"),
      t("longform", "بلند", "مطوّل", "Longform"),
      t("reading", "مطالعه", "قراءة", "Reading"),
    ],
    default: "magazine",
    slider: "carousel",
  },
  audio: {
    templates: [
      t("emerald", "زمردی", "زمردي", "Emerald"),
      t("luminous", "درخشان", "مضيء", "Luminous"),
      t("waveform", "موجی", "موجي", "Waveform"),
      t("shamsa", "شمسه", "شمسة", "Shamsa"),
      t("rosette", "ترنج", "ترنجة", "Rosette"),
      t("night", "شبانه", "ليلي", "Night"),
      t("munajat", "مناجات", "مناجاة", "Munajat"),
      t("playlist", "سیاهه", "قائمة", "Playlist"),
      t("minimal", "مینیمال", "بسيط", "Minimal"),
      t("golden", "زرین", "ذهبي", "Golden"),
    ],
    default: "emerald",
    slider: "rail",
  },
  video: {
    templates: [
      t("cinematic", "سینمایی", "سينمائي", "Cinematic"),
      t("featured", "ویژه", "مميز", "Featured"),
      t("documentary", "مستند", "وثائقي", "Documentary"),
      t("scholar", "علمی", "علمي", "Scholar"),
      t("landscape", "چشم‌انداز", "منظر", "Landscape"),
      t("portrait", "پرتره", "بورتريه", "Portrait"),
      t("premium-dark", "پریمیوم تیره", "مميز داكن", "Premium Dark"),
      t("editorial", "تحریریه‌ای", "تحريري", "Editorial"),
      t("immersive", "فراگیر", "غامر", "Immersive"),
      t("compact", "فشرده", "مضغوط", "Compact"),
    ],
    default: "cinematic",
    slider: "featured-rail",
  },
  video360: {
    templates: [
      t("bevel", "بِوِل", "مشطوف", "Bevel"),
      t("orb", "کره", "كرة", "Orb"),
      t("immersive", "فراگیر", "غامر", "Immersive"),
      t("portal", "دروازه", "بوابة", "Portal"),
      t("heritage", "میراثی", "تراثي", "Heritage"),
      t("pilgrimage", "زیارتی", "زيارة", "Pilgrimage"),
      t("atlas", "اطلس", "أطلس", "Atlas"),
      t("panorama", "پانوراما", "بانوراما", "Panorama"),
      t("dim", "تیره", "خافت", "Dim"),
      t("gallery", "نگارخانه", "معرض", "Gallery"),
    ],
    default: "bevel",
    slider: "grid",
  },
  book: {
    templates: [
      t("shelf", "قفسه‌ای", "رفوف", "Shelf"),
      t("dimensional", "سه‌بعدی", "مجسم", "Dimensional"),
      t("manuscript", "نسخهٔ خطی", "مخطوط", "Manuscript"),
      t("premium-library", "کتابخانهٔ ممتاز", "مكتبة مميزة", "Premium Library"),
      t("floating", "شناور", "طائر", "Floating"),
      t("geometric-frame", "قاب هندسی", "إطار هندسي", "Geometric Frame"),
      t("dark-library", "کتابخانهٔ تیره", "مكتبة داكنة", "Dark Library"),
      t("gold-edition", "نسخهٔ زرین", "طبعة ذهبية", "Gold Edition"),
      t("scholar-collection", "مجموعهٔ علمی", "مجموعة علمية", "Scholar Collection"),
      t("featured-volume", "جلد ویژه", "مجلد مميز", "Featured Volume"),
    ],
    default: "shelf",
    slider: "shelf",
  },
  fatwa: {
    templates: [
      t("typographic", "تایپوگرافیک", "طباعي", "Typographic"),
      t("scholarly", "عالمانه", "علمي", "Scholarly"),
      t("verified", "تأییدشده", "موثّق", "Verified"),
      t("madhab", "مذهبی", "مذهبي", "Madhab"),
      t("archival", "بایگانی", "أرشيفي", "Archival"),
      t("question", "پرسشی", "سؤالي", "Question"),
      t("minimal", "مینیمال", "بسيط", "Minimal"),
      t("authority", "مرجعیت", "مرجعية", "Authority"),
      t("timeline", "زمانی", "زمني", "Timeline"),
      t("classical", "کلاسیک", "كلاسيكي", "Classical"),
    ],
    default: "typographic",
    slider: "rail",
  },
  course: {
    templates: [
      t("academy", "آکادمی", "أكاديمية", "Academy"),
      t("premium-course", "دورهٔ ممتاز", "دورة مميزة", "Premium"),
      t("scholar-led", "با استاد", "بقياد عالم", "Scholar-led"),
      t("pathway", "مسیر", "مسار", "Pathway"),
      t("certificate", "گواهی‌دار", "بشهادة", "Certificate"),
      t("featured", "ویژه", "مميز", "Featured"),
      t("intensive", "فشرده", "مكثّف", "Intensive"),
      t("beginner", "مقدماتی", "مبتدئ", "Beginner"),
      t("advanced", "پیشرفته", "متقدّم", "Advanced"),
      t("cohort", "هم‌گروهی", "دفعة", "Cohort"),
    ],
    default: "academy",
    slider: "carousel",
  },
  community: {
    templates: [
      t("discussion", "گفتگو", "نقاش", "Discussion"),
      t("question", "پرسش", "سؤال", "Question"),
      t("scholar-answer", "پاسخ عالم", "جواب عالم", "Scholar Answer"),
      t("activity", "فعالیت", "نشاط", "Activity"),
      t("featured", "ویژه", "مميز", "Featured"),
      t("highlight", "برجسته", "بارز", "Highlight"),
      t("compact", "فشرده", "مضغوط", "Compact"),
      t("timeline", "زمانی", "زمني", "Timeline"),
      t("popular", "محبوب", "شائع", "Popular"),
      t("recent", "تازه", "حديث", "Recent"),
    ],
    default: "discussion",
    slider: "grid",
  },
  place: {
    templates: [
      t("map-pin", "نقشه‌ای", "خريطة", "Map Pin"),
      t("architectural", "معماری", "معماري", "Architectural"),
      t("mosque", "مسجد", "مسجد", "Mosque"),
      t("heritage", "میراثی", "تراثي", "Heritage"),
      t("compact", "فشرده", "مضغوط", "Compact"),
      t("featured", "ویژه", "مميز", "Featured"),
      t("route-aware", "مسیرآگاه", "واعٍ للطريق", "Route-aware"),
      t("nearby", "نزدیک", "قريب", "Nearby"),
      t("destination", "مقصد", "وجهة", "Destination"),
      t("gallery", "نگارخانه", "معرض", "Gallery"),
    ],
    default: "map-pin",
    slider: "grid",
  },
};

/** spec هر (نوع، قالب) — ترکیب متمایز؛ تغییر صرف رنگ نیست (§۲۳) */
export const TEMPLATE_SPECS: Record<ContentType, Record<string, TemplateSpec>> = {
  pdf: {
    manuscript: { layout: "vertical-cover", aspect: "portrait", bg: "ivory", frame: "gold-thin", meta: "below", cta: "geometric", tier: 2, hover: "tilt", badge3d: true, flip: true },
    archive: { layout: "row", aspect: "none", bg: "neutral", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    editorial: { layout: "editorial-column", aspect: "video", bg: "card", frame: "none", meta: "below", cta: "text", tier: 1, hover: "lift" },
    geometric: { layout: "image-top", aspect: "square", bg: "card", frame: "double", meta: "below", cta: "geometric", tier: 1, hover: "glow" },
    luminous: { layout: "image-top", aspect: "portrait", bg: "emerald-glass", frame: "gold-thin", meta: "overlay", cta: "icon", tier: 2, hover: "glow", ambient: true, flip: true },
    classical: { layout: "vertical-cover", aspect: "portrait", bg: "warm", frame: "ornamental", meta: "below", cta: "text", tier: 1, hover: "lift" },
    glass: { layout: "image-top", aspect: "portrait", bg: "emerald-glass", frame: "none", meta: "overlay", cta: "icon", tier: 2, hover: "zoom", ambient: true },
    premium: { layout: "vertical-cover", aspect: "portrait", bg: "dark", frame: "gold-thin", meta: "below", cta: "button", tier: 3, hover: "tilt", badge3d: true, flip: true },
    scholar: { layout: "split", aspect: "none", bg: "card", frame: "none", meta: "side", cta: "text", tier: 1, hover: "lift" },
    library: { layout: "row", aspect: "none", bg: "neutral", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none", flip: true },
  },
  article: {
    magazine: { layout: "editorial-column", aspect: "video", bg: "card", frame: "none", meta: "below", cta: "text", tier: 1, hover: "lift" },
    editorial: { layout: "image-top", aspect: "video", bg: "card", frame: "none", meta: "below", cta: "text", tier: 1, hover: "lift" },
    featured: { layout: "split", aspect: "video", bg: "warm", frame: "gold-thin", meta: "below", cta: "button", tier: 2, hover: "lift", badge3d: true },
    asymmetric: { layout: "editorial-column", aspect: "portrait", bg: "card", frame: "none", meta: "top", cta: "icon", tier: 2, hover: "tilt" },
    scholar: { layout: "text-first", aspect: "none", bg: "ivory", frame: "none", meta: "below", cta: "text", tier: 0, hover: "none" },
    minimal: { layout: "row", aspect: "none", bg: "neutral", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    geometric: { layout: "image-top", aspect: "square", bg: "card", frame: "double", meta: "below", cta: "geometric", tier: 1, hover: "glow" },
    cinematic: { layout: "image-top", aspect: "video", bg: "dark", frame: "none", meta: "overlay", cta: "button", tier: 3, hover: "zoom", ambient: true, badge3d: true },
    longform: { layout: "editorial-column", aspect: "portrait", bg: "ivory", frame: "none", meta: "below", cta: "text", tier: 1, hover: "lift" },
    reading: { layout: "text-first", aspect: "none", bg: "card", frame: "none", meta: "below", cta: "text", tier: 0, hover: "none" },
  },
  audio: {
    emerald: { layout: "centered-play", aspect: "square", bg: "emerald-glass", frame: "none", meta: "below", cta: "geometric", tier: 2, hover: "glow", ambient: true, ...A },
    luminous: { layout: "centered-play", aspect: "square", bg: "gradient", frame: "none", meta: "below", cta: "geometric", tier: 3, hover: "glow", ambient: true, ...A },
    waveform: { layout: "centered-play", aspect: "square", bg: "emerald-glass", frame: "none", meta: "overlay", cta: "icon", tier: 2, hover: "lift", ...S },
    shamsa: { layout: "centered-play", aspect: "square", bg: "card", frame: "ornamental", meta: "below", cta: "geometric", tier: 3, hover: "glow", ...S },
    rosette: { layout: "centered-play", aspect: "square", bg: "warm", frame: "ornamental", meta: "below", cta: "geometric", tier: 2, hover: "lift", ...A },
    night: { layout: "centered-play", aspect: "square", bg: "dark", frame: "none", meta: "below", cta: "icon", tier: 3, hover: "glow", ambient: true, ...A },
    munajat: { layout: "centered-play", aspect: "square", bg: "dark", frame: "gold-thin", meta: "overlay", cta: "geometric", tier: 3, hover: "glow", ambient: true, ...S },
    playlist: { layout: "row", aspect: "none", bg: "neutral", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none", waveform: true },
    minimal: { layout: "row", aspect: "none", bg: "card", frame: "none", meta: "side", cta: "icon", tier: 1, hover: "lift" },
    golden: { layout: "centered-play", aspect: "square", bg: "warm", frame: "gold-thin", meta: "below", cta: "button", tier: 3, hover: "tilt", ...S },
  },
  video: {
    cinematic: { layout: "image-top", aspect: "video", bg: "dark", frame: "none", meta: "overlay", cta: "icon", tier: 3, hover: "zoom", ambient: true, ...V },
    featured: { layout: "split", aspect: "video", bg: "dark", frame: "gold-thin", meta: "below", cta: "button", tier: 3, hover: "lift", badge3d: true, ...V },
    documentary: { layout: "editorial-column", aspect: "video", bg: "card", frame: "none", meta: "below", cta: "text", tier: 2, hover: "lift", ...V },
    scholar: { layout: "split", aspect: "video", bg: "ivory", frame: "none", meta: "side", cta: "text", tier: 1, hover: "lift", ...V },
    landscape: { layout: "image-top", aspect: "video", bg: "card", frame: "none", meta: "below", cta: "icon", tier: 2, hover: "zoom", ...V },
    portrait: { layout: "vertical-cover", aspect: "portrait", bg: "dark", frame: "none", meta: "overlay", cta: "icon", tier: 2, hover: "zoom", ...V },
    "premium-dark": { layout: "image-top", aspect: "video", bg: "dark", frame: "gold-thin", meta: "overlay", cta: "button", tier: 3, hover: "tilt", badge3d: true, ...V },
    editorial: { layout: "editorial-column", aspect: "video", bg: "ivory", frame: "none", meta: "below", cta: "text", tier: 1, hover: "lift", ...V },
    immersive: { layout: "image-top", aspect: "video", bg: "gradient", frame: "none", meta: "overlay", cta: "icon", tier: 3, hover: "zoom", ambient: true, ...V },
    compact: { layout: "row", aspect: "none", bg: "neutral", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
  },
  video360: {
    bevel: { layout: "image-top", aspect: "video", bg: "card", frame: "bevel", meta: "below", cta: "icon", tier: 2, hover: "lift", ...O },
    orb: { layout: "centered-play", aspect: "square", bg: "gradient", frame: "none", meta: "below", cta: "geometric", tier: 3, hover: "glow", ambient: true, ...O },
    immersive: { layout: "image-top", aspect: "video", bg: "dark", frame: "none", meta: "overlay", cta: "icon", tier: 3, hover: "zoom", ambient: true, ...O },
    portal: { layout: "image-top", aspect: "portrait", bg: "dark", frame: "ornamental", meta: "overlay", cta: "button", tier: 3, hover: "tilt", ...O },
    heritage: { layout: "vertical-cover", aspect: "portrait", bg: "warm", frame: "gold-thin", meta: "below", cta: "text", tier: 2, hover: "lift", ...O },
    pilgrimage: { layout: "image-top", aspect: "portrait", bg: "ivory", frame: "double", meta: "below", cta: "geometric", tier: 2, hover: "glow", ...O },
    atlas: { layout: "split", aspect: "video", bg: "card", frame: "none", meta: "side", cta: "text", tier: 1, hover: "lift", ...O },
    panorama: { layout: "image-top", aspect: "video", bg: "emerald-glass", frame: "none", meta: "below", cta: "icon", tier: 2, hover: "zoom", ...O },
    dim: { layout: "image-top", aspect: "video", bg: "dark", frame: "none", meta: "overlay", cta: "icon", tier: 1, hover: "none", ...O },
    gallery: { layout: "card-deck", aspect: "video", bg: "card", frame: "bevel", meta: "below", cta: "icon", tier: 2, hover: "lift", ...O },
  },
  book: {
    shelf: { layout: "vertical-cover", aspect: "portrait", bg: "card", frame: "none", meta: "below", cta: "icon", tier: 1, hover: "lift", flip: true },
    dimensional: { layout: "vertical-cover", aspect: "portrait", bg: "card", frame: "none", meta: "below", cta: "icon", tier: 3, hover: "tilt", badge3d: true, flip: true },
    manuscript: { layout: "vertical-cover", aspect: "portrait", bg: "ivory", frame: "gold-thin", meta: "below", cta: "text", tier: 2, hover: "tilt", flip: true },
    "premium-library": { layout: "vertical-cover", aspect: "portrait", bg: "dark", frame: "gold-thin", meta: "below", cta: "button", tier: 3, hover: "tilt", badge3d: true, flip: true },
    floating: { layout: "vertical-cover", aspect: "portrait", bg: "gradient", frame: "none", meta: "overlay", cta: "icon", tier: 3, hover: "glow", ambient: true, flip: true },
    "geometric-frame": { layout: "image-top", aspect: "portrait", bg: "card", frame: "double", meta: "below", cta: "geometric", tier: 1, hover: "glow", flip: true },
    "dark-library": { layout: "vertical-cover", aspect: "portrait", bg: "dark", frame: "none", meta: "overlay", cta: "icon", tier: 2, hover: "zoom", flip: true },
    "gold-edition": { layout: "vertical-cover", aspect: "portrait", bg: "warm", frame: "gold-thin", meta: "below", cta: "button", tier: 3, hover: "tilt", badge3d: true, flip: true },
    "scholar-collection": { layout: "split", aspect: "portrait", bg: "ivory", frame: "none", meta: "side", cta: "text", tier: 1, hover: "lift" },
    "featured-volume": { layout: "split", aspect: "portrait", bg: "warm", frame: "ornamental", meta: "below", cta: "button", tier: 3, hover: "tilt", badge3d: true, flip: true },
  },
  fatwa: {
    typographic: { layout: "text-first", aspect: "none", bg: "card", frame: "none", meta: "top", cta: "text", tier: 0, hover: "none" },
    scholarly: { layout: "text-first", aspect: "none", bg: "ivory", frame: "none", meta: "top", cta: "text", tier: 1, hover: "lift" },
    verified: { layout: "text-first", aspect: "none", bg: "card", frame: "gold-thin", meta: "top", cta: "geometric", tier: 1, hover: "lift", badge3d: true },
    madhab: { layout: "split", aspect: "none", bg: "neutral", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    archival: { layout: "row", aspect: "none", bg: "neutral", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    question: { layout: "text-first", aspect: "none", bg: "warm", frame: "none", meta: "top", cta: "text", tier: 0, hover: "lift" },
    minimal: { layout: "row", aspect: "none", bg: "card", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    authority: { layout: "text-first", aspect: "none", bg: "dark", frame: "gold-thin", meta: "top", cta: "button", tier: 2, hover: "glow", badge3d: true },
    timeline: { layout: "row", aspect: "none", bg: "card", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    classical: { layout: "text-first", aspect: "none", bg: "ivory", frame: "ornamental", meta: "top", cta: "geometric", tier: 1, hover: "lift" },
  },
  course: {
    academy: { layout: "image-top", aspect: "video", bg: "card", frame: "none", meta: "below", cta: "button", tier: 1, hover: "lift" },
    "premium-course": { layout: "image-top", aspect: "video", bg: "dark", frame: "gold-thin", meta: "overlay", cta: "button", tier: 3, hover: "tilt", badge3d: true },
    "scholar-led": { layout: "split", aspect: "video", bg: "ivory", frame: "none", meta: "side", cta: "text", tier: 1, hover: "lift" },
    pathway: { layout: "editorial-column", aspect: "video", bg: "gradient", frame: "none", meta: "below", cta: "geometric", tier: 2, hover: "glow" },
    certificate: { layout: "image-top", aspect: "video", bg: "card", frame: "double", meta: "below", cta: "button", tier: 2, hover: "lift", badge3d: true },
    featured: { layout: "split", aspect: "video", bg: "warm", frame: "gold-thin", meta: "below", cta: "button", tier: 3, hover: "lift", badge3d: true },
    intensive: { layout: "image-top", aspect: "video", bg: "dark", frame: "none", meta: "overlay", cta: "icon", tier: 2, hover: "zoom" },
    beginner: { layout: "image-top", aspect: "video", bg: "card", frame: "none", meta: "below", cta: "text", tier: 1, hover: "lift" },
    advanced: { layout: "editorial-column", aspect: "portrait", bg: "dark", frame: "none", meta: "overlay", cta: "button", tier: 2, hover: "tilt" },
    cohort: { layout: "split", aspect: "video", bg: "emerald-glass", frame: "none", meta: "side", cta: "geometric", tier: 2, hover: "glow", ambient: true },
  },
  community: {
    discussion: { layout: "text-first", aspect: "none", bg: "card", frame: "none", meta: "top", cta: "text", tier: 0, hover: "none" },
    question: { layout: "text-first", aspect: "none", bg: "warm", frame: "none", meta: "top", cta: "text", tier: 0, hover: "lift" },
    "scholar-answer": { layout: "text-first", aspect: "none", bg: "emerald-glass", frame: "gold-thin", meta: "top", cta: "geometric", tier: 1, hover: "glow", badge3d: true },
    activity: { layout: "row", aspect: "none", bg: "neutral", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    featured: { layout: "split", aspect: "video", bg: "card", frame: "gold-thin", meta: "below", cta: "button", tier: 2, hover: "lift" },
    highlight: { layout: "text-first", aspect: "none", bg: "gradient", frame: "none", meta: "top", cta: "text", tier: 2, hover: "glow" },
    compact: { layout: "row", aspect: "none", bg: "card", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    timeline: { layout: "row", aspect: "none", bg: "card", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    popular: { layout: "text-first", aspect: "none", bg: "card", frame: "double", meta: "top", cta: "text", tier: 1, hover: "lift" },
    recent: { layout: "row", aspect: "none", bg: "neutral", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
  },
  place: {
    "map-pin": { layout: "row", aspect: "none", bg: "card", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    architectural: { layout: "image-top", aspect: "portrait", bg: "card", frame: "none", meta: "below", cta: "text", tier: 2, hover: "lift" },
    mosque: { layout: "image-top", aspect: "video", bg: "ivory", frame: "ornamental", meta: "below", cta: "geometric", tier: 2, hover: "glow" },
    heritage: { layout: "vertical-cover", aspect: "portrait", bg: "warm", frame: "gold-thin", meta: "overlay", cta: "text", tier: 2, hover: "tilt", badge3d: true },
    compact: { layout: "row", aspect: "none", bg: "neutral", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    featured: { layout: "split", aspect: "video", bg: "card", frame: "gold-thin", meta: "below", cta: "button", tier: 3, hover: "lift", badge3d: true },
    "route-aware": { layout: "split", aspect: "video", bg: "emerald-glass", frame: "none", meta: "side", cta: "geometric", tier: 1, hover: "glow" },
    nearby: { layout: "row", aspect: "none", bg: "card", frame: "none", meta: "side", cta: "icon", tier: 0, hover: "none" },
    destination: { layout: "image-top", aspect: "video", bg: "gradient", frame: "none", meta: "overlay", cta: "button", tier: 2, hover: "zoom" },
    gallery: { layout: "card-deck", aspect: "video", bg: "card", frame: "none", meta: "below", cta: "icon", tier: 1, hover: "lift" },
  },
};

export const TEMPLATE_TOTALS: Record<ContentType, number> = Object.fromEntries(
  Object.entries(CONTENT_REGISTRY).map(([k, v]) => [k, v.templates.length]),
) as Record<ContentType, number>;

/** اعتبارسنجی ۱۰×۱۰ — crash-fast در dev/CI */
export function validateRegistry(): string[] {
  const errors: string[] = [];
  for (const [type, def] of Object.entries(CONTENT_REGISTRY)) {
    if (def.templates.length !== 10) errors.push(`${type}: ${def.templates.length} templates (expect 10)`);
    const ids = new Set(def.templates.map((t) => t.id));
    if (ids.size !== def.templates.length) errors.push(`${type}: duplicate ids`);
    if (!ids.has(def.default)) errors.push(`${type}: default '${def.default}' missing`);
    const specs = TEMPLATE_SPECS[type as ContentType];
    for (const t of def.templates) if (!specs?.[t.id]) errors.push(`${type}/${t.id}: no spec`);
  }
  return errors;
}
