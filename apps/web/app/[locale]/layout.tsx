import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

// direction بخشی صریح از layout است، مستقل از locale (فاز ۰/۳)
const DIRECTION: Record<string, 'rtl' | 'ltr'> = { fa: 'rtl', ar: 'rtl', en: 'ltr' };

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  const messages = await getMessages();
  return (
    <html lang={locale} dir={DIRECTION[locale] ?? 'rtl'}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
