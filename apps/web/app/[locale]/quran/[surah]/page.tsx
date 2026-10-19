import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getQuranProviders, getSurah } from '@/lib/quran';
import { getSiteConfig, type QuranSettings } from '@/lib/settings';
import { QuranReader } from '@/components/QuranReader';

export async function generateMetadata({
  params: { locale, surah },
}: {
  params: { locale: string; surah: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quran' });
  const n = Number(surah);
  return {
    title: t('surahMetaTitle', { n }),
    description: t('metaDescription'),
  };
}

/**
 * Surah view — server-rendered from GET /api/v1/quran/surah/{n}.
 * Display config (enabled translation/tafsir/reciter editions, visibility
 * flags) comes from GET /api/v1/quran/providers (CRM-driven); the
 * quran.* settings are the fallback. Query params: ?translation= &tafsir=
 * (edition overrides), ?reciter= (forward-compatible selector),
 * ?ayah= (deep-link highlight).
 * Invalid surah numbers 404.
 */
export default async function SurahPage({
  params: { locale, surah },
  searchParams,
}: {
  params: { locale: string; surah: string };
  searchParams: { translation?: string; tafsir?: string; reciter?: string; ayah?: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quran' });
  const n = Number(surah);
  if (!Number.isInteger(n) || n < 1 || n > 114) notFound();

  const siteConfig = await getSiteConfig();
  const providers = await getQuranProviders();

  // Providers config (CRM) wins; quran.* settings are the fallback.
  const qs: QuranSettings = {
    defaultTranslation: searchParams.translation ?? providers?.translationEdition ?? siteConfig.quran.defaultTranslation,
    defaultTafsir: searchParams.tafsir ?? providers?.tafsirEdition ?? siteConfig.quran.defaultTafsir,
    defaultReciter: searchParams.reciter ?? providers?.activeReciter ?? siteConfig.quran.defaultReciter,
    showTranslation: providers?.showTranslation ?? siteConfig.quran.showTranslation,
    showTafsir: providers?.showTafsir ?? siteConfig.quran.showTafsir,
    highlightMode: providers?.highlightMode ?? siteConfig.quran.highlightMode,
  };
  const reciters = providers?.reciters ?? [];

  const ayahParam = searchParams.ayah ? Number(searchParams.ayah) : NaN;
  const initialAyah = Number.isInteger(ayahParam) && ayahParam >= 1 ? ayahParam : null;

  let view: Awaited<ReturnType<typeof getSurah>> | null = null;
  try {
    view = await getSurah(n, {
      translation: qs.defaultTranslation,
      tafsir: qs.defaultTafsir,
      translationEdition: qs.defaultTranslation,
      tafsirEdition: qs.defaultTafsir,
    });
  } catch {
    view = null;
  }

  if (!view) {
    return (
      <div className="page-wrap">
        <h1 className="page-title">{t('surahMetaTitle', { n })}</h1>
        <p className="error-state" role="alert">
          {t('loadFailed')}
        </p>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <QuranReader
        locale={locale}
        surah={view.surah}
        ayahs={view.ayahs}
        reciters={reciters}
        settings={qs}
        initialAyah={initialAyah}
        labels={{
          surahOf: t('surahOf'),
          reciterLabel: t('reciterLabel'),
          playSurah: t('playSurah'),
          pause: t('pause'),
          resume: t('resume'),
          stop: t('stop'),
          prevSurah: t('prevSurah'),
          nextSurah: t('nextSurah'),
          audioUnavailable: t('audioUnavailable'),
          audioFailed: t('audioFailed'),
          ayahLink: t('ayahLink'),
          showTranslation: t('showTranslation'),
          showTafsir: t('showTafsir'),
          bismillah: t('bismillah'),
          playAyah: t('playAyah'),
          playing: t('playing'),
          translationLabel: t('translationLabel'),
          tafsirLabel: t('tafsirLabel'),
          ayahNumber: t('ayahNumber'),
          notesTitle: t('notesTitle'),
          addNote: t('addNote'),
          notePlaceholder: t('notePlaceholder'),
          saveNote: t('saveNote'),
          cancel: t('cancel'),
          editNote: t('editNote'),
          deleteNote: t('deleteNote'),
          deleteConfirm: t('deleteConfirm'),
          privateNote: t('privateNote'),
          publicNote: t('publicNote'),
          signInPrompt: t('signInPrompt'),
          signIn: t('signIn'),
          notesEmpty: t('notesEmpty'),
          notesFailed: t('notesFailed'),
          noteSaved: t('noteSaved'),
          noteDeleted: t('noteDeleted'),
        }}
      />
    </div>
  );
}
