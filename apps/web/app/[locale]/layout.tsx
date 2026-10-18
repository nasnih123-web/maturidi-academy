import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { bodyFont, headingFont } from '@/lib/fonts';
import './globals.css';
// Design tokens (built by the design-tokens package track). Imported here so
// `--ma-*` vars resolve before our fallbacks; our CSS keeps local fallbacks
// so the page still renders if the package is unavailable.
// NOTE: this import is added only when packages/design-tokens/tokens.css exists.
import '@maturidi/design-tokens/tokens.css';

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
    <html
      lang={locale}
      dir={DIRECTION[locale] ?? 'rtl'}
      className={`${bodyFont.variable} ${headingFont.variable}`}
    >
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
