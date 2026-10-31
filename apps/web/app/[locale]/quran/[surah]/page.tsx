import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getQuranProviders, getSurah } from '@/lib/quran';
import { getSiteConfig, type QuranSettings } from '@/lib/settings';
import { QuranReader } from '@/components/QuranReader';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; surah: string }>;
}): Promise<Metadata> {
  const { locale, surah } = await params;
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
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ locale: string; surah: string }>;
  searchParams: Promise<{ translation?: string; tafsir?: string; reciter?: string; ayah?: string }>;
}) {
  const { locale, surah } = await params;
  const searchParams = await searchParamsPromise;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quran' });
  const n = Number(surah);
  if (!Number.isInteger(n) || n < 1 || n > 114) notFound();

  const siteConfig = await getSiteConfig();
  const providers = await getQuranProviders();

  // Providers config (CRM) wins; quran.* settings are the fallback.
  // Madhhab/player defaults have no providers field — siteConfig is the
  // source (CRM quran.madhhab_default / quran.player_* keys).
  const qs: QuranSettings = {
    defaultTranslation: searchParams.translation ?? providers?.translationEdition ?? siteConfig.quran.defaultTranslation,
    defaultTafsir: searchParams.tafsir ?? providers?.tafsirEdition ?? siteConfig.quran.defaultTafsir,
    defaultReciter: searchParams.reciter ?? providers?.activeReciter ?? siteConfig.quran.defaultReciter,
    showTranslation: providers?.showTranslation ?? siteConfig.quran.showTranslation,
    showTafsir: providers?.showTafsir ?? siteConfig.quran.showTafsir,
    highlightMode: providers?.highlightMode ?? siteConfig.quran.highlightMode,
    madhhabDefault: siteConfig.quran.madhhabDefault,
    playerDefaultSpeed: siteConfig.quran.playerDefaultSpeed,
    playerShowPhoto: siteConfig.quran.playerShowPhoto,
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
          tabsLabel: t('tabsLabel'),
          tabGeneral: t('tabGeneral'),
          tabHifz: t('tabHifz'),
          tabChildren: t('tabChildren'),
          hifzPlaceholder: t('hifzPlaceholder'),
          childrenPlaceholder: t('childrenPlaceholder'),
          madhhabLabel: t('madhhabLabel'),
          madhhabHanafi: t('madhhabHanafi'),
          madhhabShafii: t('madhhabShafii'),
          madhhabMaliki: t('madhhabMaliki'),
          madhhabHanbali: t('madhhabHanbali'),
          sajdaWajib: t('sajdaWajib'),
          sajdaSunnah: t('sajdaSunnah'),
          fawasilCount: t('fawasilCount'),
          fawasilFallback: t('fawasilFallback'),
          schoolKufi: t('schoolKufi'),
          schoolBasri: t('schoolBasri'),
          schoolMadani1: t('schoolMadani1'),
          schoolMadani2: t('schoolMadani2'),
          schoolMakki: t('schoolMakki'),
          schoolShami: t('schoolShami'),
          schoolHimsi: t('schoolHimsi'),
          prevAyah: t('prevAyah'),
          nextAyah: t('nextAyah'),
          speedLabel: t('speedLabel'),
          volumeLabel: t('volumeLabel'),
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
