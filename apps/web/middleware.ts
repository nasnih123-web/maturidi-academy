import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  locales: ['fa', 'ar', 'en'],
  defaultLocale: 'fa',
});

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
