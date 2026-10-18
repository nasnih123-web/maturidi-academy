import { useTranslations } from 'next-intl';

// اسکلت فاز ۱ — صفحهٔ اول کامل ویترینی در فاز ۳
export default function HomePage() {
  const t = useTranslations();
  return (
    <main style={{ fontFamily: 'Vazirmatn, system-ui', padding: '4rem 1rem', textAlign: 'center' }}>
      <h1>{t('appName')}</h1>
      <p>{t('tagline')}</p>
      <p style={{ opacity: 0.6 }}>{t('comingSoon')}</p>
    </main>
  );
}
