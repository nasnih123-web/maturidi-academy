import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async ({ locale }) => ({
  // direction بخشی صریح از layout context است (فاز ۰/۳) — fa/ar → rtl، en → ltr
  messages: (await import(`./messages/${locale}.json`)).default,
}));
