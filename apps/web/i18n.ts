import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';

const locales = ['fa', 'ar', 'en'] as const;
const defaultLocale = 'fa';

export default getRequestConfig(async ({ requestLocale }) => {
  // next-intl v4: locale از request می‌آید و باید در کانفیگ برگردانده شود؛
  // locale نامعتبر به پیش‌فرض برمی‌گردد (رفتار معادل v3 همین فایل).
  const requested = await requestLocale;
  const locale = hasLocale(locales, requested) ? requested : defaultLocale;
  return {
    locale,
    // direction بخشی صریح از layout context است (فاز ۰/۳) — fa/ar → rtl، en → ltr
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
