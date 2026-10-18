import React from "react";

/**
 * Tiny trilingual dictionary for the CRM scaffold.
 *
 * Direction is explicit layout context (contract Phase 0/3 convention):
 * fa/ar → rtl, en → ltr. No user-visible string may live outside this dict.
 */

export type Locale = "fa" | "ar" | "en";
export type Direction = "rtl" | "ltr";

export const LOCALES: Locale[] = ["fa", "ar", "en"];
export const DEFAULT_LOCALE: Locale = "fa";

export const DIRECTIONS: Record<Locale, Direction> = {
  fa: "rtl",
  ar: "rtl",
  en: "ltr",
};

const fa = {
  app: {
    name: "برج کنترل",
    subtitle: "آکادمی ماتریدی",
  },
  nav: {
    dashboard: "داشبورد",
    events: "رویدادها",
    content: "محتوا",
    settings: "تنظیمات",
    branding: "برندینگ",
    logout: "خروج",
  },
  login: {
    title: "ورود به برج کنترل",
    identifier: "ایمیل یا شماره موبایل",
    password: "رمز عبور",
    totp: "کد تأیید دوعاملی",
    submit: "ورود",
    submitting: "در حال ورود…",
    need2fa: "حساب شما دوعاملی دارد؛ کد تأیید را وارد کنید.",
    errorInvalid: "ایمیل/شماره یا رمز عبور نادرست است.",
    errorRate: "تعداد تلاش بیش از حد مجاز؛ دقایقی صبر کنید.",
    errorUnknown: "خطایی رخ داد؛ دوباره تلاش کنید.",
  },
  dashboard: {
    welcome: "خوش آمدید",
    overview: "نمای کلی پلتفرم",
    hint: "از منوی کناری بخش موردنظر را انتخاب کنید.",
  },
  events: {
    title: "فید زندهٔ رویدادها",
    statusConnecting: "در حال اتصال…",
    statusConnected: "متصل",
    statusReconnecting: "تلاش مجدد برای اتصال…",
    statusDisconnected: "قطع شده",
    lastEvent: "آخرین رویداد",
    empty: "هنوز رویدادی دریافت نشده است.",
    emptyHint: "با ثبت یک فتوا یا محتوای آزمایشی، رویداد آن بی‌درنگ این‌جا می‌آید.",
    retryIn: "اتصال مجدد تا {s} ثانیه دیگر",
    payload: "جزئیات",
    eventId: "شناسهٔ رویداد",
  },
  content: {
    title: "مرکز کنترل محتوا",
    search: "جست‌وجو",
    searchPlaceholder: "متن، شناسه یا مالک…",
    type: "نوع",
    module: "ماژول",
    status: "وضعیت",
    owner: "مالک",
    from: "از تاریخ",
    to: "تا تاریخ",
    apply: "اعمال",
    reset: "پاک‌سازی",
    all: "همه",
    tableType: "نوع",
    tableModule: "ماژول",
    tableStatus: "وضعیت",
    tableOwner: "مالک",
    tableDate: "تاریخ",
    empty: "موردی یافت نشد.",
    emptyHint: "فیلترها را تغییر دهید یا بعداً دوباره تلاش کنید.",
    preview: "پیش‌نمایش",
    policies: "سیاست‌ها",
    aiPolicy: "سیاست AI",
    distribution: "توزیع",
    schedule: "زمان‌بندی",
    placements: "جایگاه‌ها",
    audit: "حسابرسی",
    close: "بستن",
    noPreview: "پیش‌نمایشی برای این مورد ثبت نشده است.",
    noPolicies: "سیاستی برای این مورد ثبت نشده است.",
  },
  settings: {
    title: "تنظیمات پلتفرم",
    superOnly: "فقط super_admin",
    sections: {
      ai: "هوش مصنوعی",
      telegram: "تلگرام",
      payments: "پرداخت",
      comms: "ایمیل و پیامک",
    },
    fields: {
      model: "مدل",
      apiKey: "کلید API",
      fallback: "مدل جایگزین",
      botToken: "توکن بات",
      channel: "کانال مقصد",
      session: "نشست (session)",
      zarinpal: "کلید زرین‌پال",
      idpay: "کلید آیدی‌پی",
      emailKey: "کلید سرویس ایمیل",
      smsKey: "کلید سرویس پیامک",
    },
    save: "ذخیره",
    saving: "در حال ذخیره…",
    saved: "ذخیره شد.",
    secretPlaceholder: "••••••••",
    secretHint: "برای تغییر، مقدار جدید را وارد کنید؛ خالی بماند یعنی بدون تغییر.",
    noRestart: "بدون ری‌استارت فعال می‌شود.",
  },
  branding: {
    title: "برندینگ اپلیکیشن",
    displayName: "نام نمایشی اپ",
    icon: "آیکون اپ",
    splash: "صفحهٔ آغازین",
    pickMedia: "انتخاب رسانه",
    mediaStub: "انتخاب‌گر رسانه در فاز بعد (media_assets) فعال می‌شود؛ فعلاً شناسهٔ رسانه را دستی وارد کنید.",
    save: "ذخیره",
    saving: "در حال ذخیره…",
    saved: "ذخیره شد.",
    rebuildNote: "تغییر برندینگ نیاز به build تازهٔ اپ‌ها دارد (آنی اعمال نمی‌شود).",
  },
  status: {
    draft: "پیش‌نویس",
    in_review: "در حال بررسی",
    approved: "تأییدشده",
    published: "منتشرشده",
    rejected: "ردشده",
    archived: "بایگانی‌شده",
  },
  common: {
    loading: "در حال بارگذاری…",
    error: "خطایی رخ داد.",
    retry: "تلاش مجدد",
    close: "بستن",
  },
};

export type Dict = typeof fa;

const ar: Dict = {
  app: {
    name: "برج التحكم",
    subtitle: "أكاديمية الماتريدي",
  },
  nav: {
    dashboard: "لوحة القيادة",
    events: "الأحداث",
    content: "المحتوى",
    settings: "الإعدادات",
    branding: "الهوية",
    logout: "خروج",
  },
  login: {
    title: "تسجيل الدخول إلى برج التحكم",
    identifier: "البريد الإلكتروني أو رقم الجوال",
    password: "كلمة المرور",
    totp: "رمز التحقق بخطوتين",
    submit: "دخول",
    submitting: "جارٍ الدخول…",
    need2fa: "حسابك يستخدم التحقق بخطوتين؛ أدخل رمز التحقق.",
    errorInvalid: "البريد/الرقم أو كلمة المرور غير صحيحة.",
    errorRate: "عدد المحاولات تجاوز الحد؛ انتظر قليلاً.",
    errorUnknown: "حدث خطأ؛ حاول مجدداً.",
  },
  dashboard: {
    welcome: "مرحباً بك",
    overview: "نظرة عامة على المنصة",
    hint: "اختر القسم المطلوب من القائمة الجانبية.",
  },
  events: {
    title: "بث الأحداث المباشر",
    statusConnecting: "جارٍ الاتصال…",
    statusConnected: "متصل",
    statusReconnecting: "إعادة محاولة الاتصال…",
    statusDisconnected: "منقطع",
    lastEvent: "آخر حدث",
    empty: "لم يتم استلام أي حدث بعد.",
    emptyHint: "سجّل فتوى أو محتوى تجريبياً وسيظهر حدثه هنا فوراً.",
    retryIn: "إعادة الاتصال بعد {s} ثانية",
    payload: "التفاصيل",
    eventId: "معرّف الحدث",
  },
  content: {
    title: "مركز التحكم بالمحتوى",
    search: "بحث",
    searchPlaceholder: "نص أو معرّف أو مالك…",
    type: "النوع",
    module: "الوحدة",
    status: "الحالة",
    owner: "المالك",
    from: "من تاريخ",
    to: "إلى تاريخ",
    apply: "تطبيق",
    reset: "مسح",
    all: "الكل",
    tableType: "النوع",
    tableModule: "الوحدة",
    tableStatus: "الحالة",
    tableOwner: "المالك",
    tableDate: "التاريخ",
    empty: "لا توجد عناصر.",
    emptyHint: "غيّر المرشحات أو حاول لاحقاً.",
    preview: "معاينة",
    policies: "السياسات",
    aiPolicy: "سياسة الذكاء الاصطناعي",
    distribution: "التوزيع",
    schedule: "الجدولة",
    placements: "المواضع",
    audit: "التدقيق",
    close: "إغلاق",
    noPreview: "لا توجد معاينة مسجلة لهذا العنصر.",
    noPolicies: "لا توجد سياسات مسجلة لهذا العنصر.",
  },
  settings: {
    title: "إعدادات المنصة",
    superOnly: "للمشرف العام فقط",
    sections: {
      ai: "الذكاء الاصطناعي",
      telegram: "تيليغرام",
      payments: "الدفع",
      comms: "البريد والرسائل",
    },
    fields: {
      model: "النموذج",
      apiKey: "مفتاح API",
      fallback: "النموذج البديل",
      botToken: "رمز البوت",
      channel: "القناة المستهدفة",
      session: "الجلسة (session)",
      zarinpal: "مفتاح زرين‌بال",
      idpay: "مفتاح آيدي‌بي",
      emailKey: "مفتاح خدمة البريد",
      smsKey: "مفتاح خدمة الرسائل",
    },
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    saved: "تم الحفظ.",
    secretPlaceholder: "••••••••",
    secretHint: "للتغيير أدخل قيمة جديدة؛ تركه فارغاً يعني بلا تغيير.",
    noRestart: "يُفعَّل دون إعادة التشغيل.",
  },
  branding: {
    title: "هوية التطبيق",
    displayName: "اسم التطبيق المعروض",
    icon: "أيقونة التطبيق",
    splash: "شاشة البداية",
    pickMedia: "اختيار وسائط",
    mediaStub: "سيُفعَّل منتقي الوسائط في مرحلة لاحقة (media_assets)؛ أدخل معرّف الوسائط يدوياً حالياً.",
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    saved: "تم الحفظ.",
    rebuildNote: "تغيير الهوية يتطلب بناءً جديداً للتطبيقات (لا يُطبَّق فورياً).",
  },
  status: {
    draft: "مسودة",
    in_review: "قيد المراجعة",
    approved: "معتمد",
    published: "منشور",
    rejected: "مرفوض",
    archived: "مؤرشف",
  },
  common: {
    loading: "جارٍ التحميل…",
    error: "حدث خطأ.",
    retry: "إعادة المحاولة",
    close: "إغلاق",
  },
};

const en: Dict = {
  app: {
    name: "Control Tower",
    subtitle: "Maturidi Academy",
  },
  nav: {
    dashboard: "Dashboard",
    events: "Events",
    content: "Content",
    settings: "Settings",
    branding: "Branding",
    logout: "Log out",
  },
  login: {
    title: "Sign in to the Control Tower",
    identifier: "Email or phone number",
    password: "Password",
    totp: "Two-factor code",
    submit: "Sign in",
    submitting: "Signing in…",
    need2fa: "Your account uses 2FA; enter the verification code.",
    errorInvalid: "Invalid email/phone or password.",
    errorRate: "Too many attempts; wait a few minutes.",
    errorUnknown: "Something went wrong; try again.",
  },
  dashboard: {
    welcome: "Welcome",
    overview: "Platform overview",
    hint: "Pick a section from the side menu.",
  },
  events: {
    title: "Live event feed",
    statusConnecting: "Connecting…",
    statusConnected: "Connected",
    statusReconnecting: "Reconnecting…",
    statusDisconnected: "Disconnected",
    lastEvent: "Last event",
    empty: "No events received yet.",
    emptyHint: "Register a test fatwa or content item and its event will appear here instantly.",
    retryIn: "Reconnecting in {s}s",
    payload: "Details",
    eventId: "Event ID",
  },
  content: {
    title: "Content Control Center",
    search: "Search",
    searchPlaceholder: "Text, id or owner…",
    type: "Type",
    module: "Module",
    status: "Status",
    owner: "Owner",
    from: "From date",
    to: "To date",
    apply: "Apply",
    reset: "Clear",
    all: "All",
    tableType: "Type",
    tableModule: "Module",
    tableStatus: "Status",
    tableOwner: "Owner",
    tableDate: "Date",
    empty: "No items found.",
    emptyHint: "Adjust the filters or try again later.",
    preview: "Preview",
    policies: "Policies",
    aiPolicy: "AI policy",
    distribution: "Distribution",
    schedule: "Schedule",
    placements: "Placements",
    audit: "Audit",
    close: "Close",
    noPreview: "No preview recorded for this item.",
    noPolicies: "No policies recorded for this item.",
  },
  settings: {
    title: "Platform settings",
    superOnly: "super_admin only",
    sections: {
      ai: "AI",
      telegram: "Telegram",
      payments: "Payments",
      comms: "Email & SMS",
    },
    fields: {
      model: "Model",
      apiKey: "API key",
      fallback: "Fallback model",
      botToken: "Bot token",
      channel: "Target channel",
      session: "Session",
      zarinpal: "ZarinPal key",
      idpay: "IDPay key",
      emailKey: "Email service key",
      smsKey: "SMS service key",
    },
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    secretPlaceholder: "••••••••",
    secretHint: "Enter a new value to change it; leave empty for no change.",
    noRestart: "Takes effect without restart.",
  },
  branding: {
    title: "App branding",
    displayName: "App display name",
    icon: "App icon",
    splash: "Splash screen",
    pickMedia: "Pick media",
    mediaStub: "The media picker activates in a later phase (media_assets); enter the media id manually for now.",
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    rebuildNote: "Branding changes need a fresh app build (not applied instantly).",
  },
  status: {
    draft: "Draft",
    in_review: "In review",
    approved: "Approved",
    published: "Published",
    rejected: "Rejected",
    archived: "Archived",
  },
  common: {
    loading: "Loading…",
    error: "Something went wrong.",
    retry: "Retry",
    close: "Close",
  },
};

const dicts: Record<Locale, Dict> = { fa, ar, en };

function getByPath(obj: unknown, path: string): string | undefined {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function translate(locale: Locale, path: string): string {
  return (
    getByPath(dicts[locale], path) ??
    getByPath(dicts[DEFAULT_LOCALE], path) ??
    path
  );
}

/** Locale-aware date formatting; timestamps stay UTC ISO until the UI (contract §1). */
export function formatDate(locale: Locale, iso: string): string {
  try {
    const tag = locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en";
    return new Intl.DateTimeFormat(tag, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

interface I18nContextValue {
  locale: Locale;
  dir: Direction;
  setLocale: (l: Locale) => void;
  t: (path: string) => string;
  formatDate: (iso: string) => string;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

function applyDocumentAttrs(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = DIRECTIONS[locale];
  document.title = `${translate(locale, "app.name")} — ${translate(locale, "app.subtitle")}`;
}

export function I18nProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [locale, setLocaleState] = React.useState<Locale>(() => {
    const saved = localStorage.getItem("crm.locale") as Locale | null;
    const initial: Locale =
      saved === "fa" || saved === "ar" || saved === "en"
        ? saved
        : DEFAULT_LOCALE;
    applyDocumentAttrs(initial);
    return initial;
  });

  const setLocale = React.useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("crm.locale", l);
    applyDocumentAttrs(l);
  }, []);

  const t = React.useCallback(
    (path: string) => translate(locale, path),
    [locale],
  );
  const fmt = React.useCallback((iso: string) => formatDate(locale, iso), [locale]);

  const value = React.useMemo(
    () => ({ locale, dir: DIRECTIONS[locale], setLocale, t, formatDate: fmt }),
    [locale, setLocale, t, fmt],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
