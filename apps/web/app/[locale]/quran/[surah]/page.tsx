import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getQuranProviders, getSurah, getSurahs } from '@/lib/quran';
import { parseSvgMushafKey } from '@/lib/quran-svg-page';
import { RANGE_COUNTS, type QuranViewMode } from '@/lib/quran-view-modes';
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
 * ?ayah= (deep-link highlight), ?tab= (section: general/hifz/children),
 * ?view= + ?target= (umum view mode + range target; refresh keeps the
 * view). Range targets are validated against the range size (30/120/604);
 * an out-of-range target degrades to the mode's list, never a crash.
 * Invalid surah numbers 404.
 *
 * User-locked 2026-11-01: the reader renders ONLY the ?tab= section —
 * no tab bar, no other section's content.
 */
export default async function SurahPage({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ locale: string; surah: string }>;
  searchParams: Promise<{
    translation?: string;
    tafsir?: string;
    reciter?: string;
    ayah?: string;
    tab?: string;
    view?: string;
    target?: string;
    mushaf?: string;
  }>;
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
    waveformStyle: siteConfig.quran.waveformStyle,
    displayFont: siteConfig.quran.displayFont,
    displayTheme: siteConfig.quran.displayTheme,
    // Providers (CRM playback) wins when present; public settings are
    // the fallback — both now flow through the same whitelist.
    repeatDefault: providers?.repeatDefault ?? siteConfig.quran.repeatDefault,
  };
  const reciters = providers?.reciters ?? [];

  const ayahParam = searchParams.ayah ? Number(searchParams.ayah) : NaN;
  const initialAyah = Number.isInteger(ayahParam) && ayahParam >= 1 ? ayahParam : null;
  // Section deep-link: only the three real sections; anything else is عموم.
  const initialTab =
    searchParams.tab === 'hifz' || searchParams.tab === 'children' ? searchParams.tab : 'general';

  // View-mode deep-link: only the four real modes besides سوره; anything
  // else is سوره. Target validated against the mode's range size.
  const initialView: QuranViewMode =
    searchParams.view === 'ayah' ||
    searchParams.view === 'juz' ||
    searchParams.view === 'hizb' ||
    searchParams.view === 'page'
      ? searchParams.view
      : 'surah';
  const maxTarget =
    initialView === 'juz' || initialView === 'hizb' || initialView === 'page'
      ? RANGE_COUNTS[initialView]
      : 0;
  const targetParam = searchParams.target ? Number(searchParams.target) : NaN;
  const initialTarget =
    Number.isInteger(targetParam) && targetParam >= 1 && targetParam <= maxTarget
      ? targetParam
      : null;
  // Mushaf deep-link: only the five real keys; anything else is Hafs.
  const initialMushaf = parseSvgMushafKey(searchParams.mushaf ?? null);

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

  // Full surah list for search name matching (non-fatal on failure).
  let surahList: Awaited<ReturnType<typeof getSurahs>> = [];
  try {
    surahList = await getSurahs();
  } catch {
    surahList = [];
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
        initialTab={initialTab}
        initialView={initialView}
        initialTarget={initialTarget}
        initialMushaf={initialMushaf}
        surahList={surahList}
        translationEditions={providers?.translationEditions ?? []}
        tafsirEditions={providers?.tafsirEditions ?? []}
        fontSizeDefault={providers?.fontSize ?? 20}
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
          modeLabel: t('modeLabel'),
          modeAyah: t('modeAyah'),
          modePage: t('modePage'),
          modeSurah: t('modeSurah'),
          modeJuz: t('modeJuz'),
          modeHizb: t('modeHizb'),
          prevPage: t('prevPage'),
          nextPage: t('nextPage'),
          prevJuz: t('prevJuz'),
          nextJuz: t('nextJuz'),
          prevHizb: t('prevHizb'),
          nextHizb: t('nextHizb'),
          pageCurrent: t('pageCurrent'),
          juzCurrent: t('juzCurrent'),
          hizbCurrent: t('hizbCurrent'),
          mushafHeaderSurah: t('mushafHeaderSurah'),
          ayahOf: t('ayahOf'),
          juzPageOf: t('juzPageOf'),
          surahTotalLabel: t('surahTotalLabel'),
          rangeTotalLabel: t('rangeTotalLabel'),
          waveformLabel: t('waveformLabel'),
          juzListTitle: t('juzListTitle'),
          hizbListTitle: t('hizbListTitle'),
          pageListTitle: t('pageListTitle'),
          backToList: t('backToList'),
          pageJumpLabel: t('pageJumpLabel'),
          pageJumpButton: t('pageJumpButton'),
          pageJumpOutOfRange: t('pageJumpOutOfRange'),
          rangeLoading: t('rangeLoading'),
          rangeFailed: t('rangeFailed'),
          scriptLabel: t('scriptLabel'),
          scriptUthmani: t('scriptUthmani'),
          scriptIndopak: t('scriptIndopak'),
          scriptTypefaceNote: t('scriptTypefaceNote'),
          displayFontLabel: t('displayFontLabel'),
          fontSystem: t('fontSystem'),
          fontAmiri: t('fontAmiri'),
          fontScheherazade: t('fontScheherazade'),
          fontSizeLabel: t('fontSizeLabel'),
          displayThemeLabel: t('displayThemeLabel'),
          themeDark: t('themeDark'),
          themeSepia: t('themeSepia'),
          themeLight: t('themeLight'),
          themeGreen: t('themeGreen'),
          fullscreenLabel: t('fullscreenLabel'),
          exitFullscreenLabel: t('exitFullscreenLabel'),
          autoScrollLabel: t('autoScrollLabel'),
          autoScrollSpeedLabel: t('autoScrollSpeedLabel'),
          repeatLabel: t('repeatLabel'),
          repeatOff: t('repeatOff'),
          repeatAyah: t('repeatAyah'),
          repeatSurah: t('repeatSurah'),
          translationEditionLabel: t('translationEditionLabel'),
          tafsirEditionLabel: t('tafsirEditionLabel'),
          bookmarksLabel: t('bookmarksLabel'),
          bookmarksTitle: t('bookmarksTitle'),
          bookmarkAyah: t('bookmarkAyah'),
          bookmarkPage: t('bookmarkPage'),
          bookmarkRemove: t('bookmarkRemove'),
          bookmarksEmpty: t('bookmarksEmpty'),
          bookmarkFavorite: t('bookmarkFavorite'),
          bookmarkUnfavorite: t('bookmarkUnfavorite'),
          bookmarkRemoveBtn: t('bookmarkRemoveBtn'),
          resumeReading: t('resumeReading'),
          lastReadLabel: t('lastReadLabel'),
          listFilterLabel: t('listFilterLabel'),
          listFilterPlaceholder: t('listFilterPlaceholder'),
          listSortLabel: t('listSortLabel'),
          listSortAsc: t('listSortAsc'),
          listSortDesc: t('listSortDesc'),
          readingLabel: t('readingLabel'),
          exitReadingLabel: t('exitReadingLabel'),
          pickerLabel: t('pickerLabel'),
          pickerTitle: t('pickerTitle'),
          pickerSearchLabel: t('pickerSearchLabel'),
          pickerSearchPlaceholder: t('pickerSearchPlaceholder'),
          pickerCloseLabel: t('pickerCloseLabel'),
          mushafLabel: t('mushafLabel'),
          mushafTitle: t('mushafTitle'),
          mushafHafs: t('mushafHafs'),
          mushafWarsh: t('mushafWarsh'),
          mushafQalun: t('mushafQalun'),
          mushafDouri: t('mushafDouri'),
          mushafShubah: t('mushafShubah'),
          mushafHafsMargins: t('mushafHafsMargins'),
          mushafWarshMargins: t('mushafWarshMargins'),
          mushafQalunMargins: t('mushafQalunMargins'),
          mushafMadina: t('mushafMadina'),
          mushafTajweed: t('mushafTajweed'),
          mushafCurrent: t('mushafCurrent'),
          mushafSoon: t('mushafSoon'),
          mushafNote: t('mushafNote'),
          readingSettingsLabel: t('readingSettingsLabel'),
          readingPageOf: t('readingPageOf'),
          svgFallbackNote: t('svgFallbackNote'),
          svgUnavailableNote: t('svgUnavailableNote'),
          svgRefPanelNote: t('svgRefPanelNote'),
          svgNonHafsAyahNote: t('svgNonHafsAyahNote'),
          svgEditionTextLabel: t('svgEditionTextLabel'),
          svgCredit: t('svgCredit'),
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
        searchLabels={{
          searchPlaceholder: t('searchPlaceholder'),
          searchAria: t('searchAria'),
          searchHint: t('searchHint'),
          searchLoading: t('searchLoading'),
          noResults: t('noResults'),
          searchSurahHeading: t('searchSurahHeading'),
          searchAyahHeading: t('searchAyahHeading'),
          searchPageHeading: t('searchPageHeading'),
          searchPageOutOfRange: t('searchPageOutOfRange'),
          searchMore: t('searchMore'),
        }}
      />
    </div>
  );
}
