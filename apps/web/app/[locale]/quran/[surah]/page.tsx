import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getQuranProviders, getSurah, getSurahs } from '@/lib/quran';
import {
  QURAN_MUSHAF_V2_INDEX_URL,
  v2PageIndexForAyah,
  v2PageUrl,
  type V2MushafIndex,
} from '@/lib/quran-mushaf-v2';
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
 * The V2 index, read from the public file (server-side only). Cached
 * in module scope — the file is immutable at runtime, so one disk
 * read serves every hifz-tab render in this server process. Null when
 * the file is missing or unparsable (the client loader then fetches
 * it over HTTP instead; the page still works).
 */
let cachedV2Index: V2MushafIndex | null | undefined;
async function loadV2IndexFromDisk(): Promise<V2MushafIndex | null> {
  if (cachedV2Index !== undefined) return cachedV2Index;
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', 'quran-mushaf-v2-index.json'),
      'utf-8',
    );
    cachedV2Index = JSON.parse(raw) as V2MushafIndex;
  } catch {
    cachedV2Index = null;
  }
  return cachedV2Index;
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
      // The reciter dropdown reloads with ?reciter=<id>; without
      // forwarding it here the bundle is always built with the first
      // active reciter's audio, so playback never leaves Alafasy.
      reciter: searchParams.reciter ?? null,
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

  // Round 2 §8 — per-page V2 chunks: the hifz tab preloads the tiny
  // index + the initial ayah's page chunk (not the whole 193KB file).
  // The index is read from disk (module-level cache — the file is
  // immutable at runtime) and the page is the binary search over it;
  // any failure here only drops the preloads, never the page — the
  // client loader fetches index + chunk lazily instead.
  let initialV2Page: number | null = null;
  if (initialTab === 'hifz') {
    try {
      const index = await loadV2IndexFromDisk();
      if (index) {
        const p = v2PageIndexForAyah(index, view.surah.number, initialAyah ?? 1);
        initialV2Page = p !== null ? p + 1 : null;
      }
    } catch {
      initialV2Page = null;
    }
  }

  return (
    <div className="page-wrap">
      {/* hifz-completion performance (§8, round 2 — per-page chunks):
          the study page's mushaf used to need the whole 604-page V2
          file (~193KB gzip, ~17.5s on slow 3G). Now it needs only the
          tiny index (~3.7KB gzip) + the initial page's chunk (~0.7KB
          gzip). Both are preloaded from the server-rendered head
          (same URLs the loader fetches, so the browser reuses these
          downloads) and start with the first wave instead of after
          hydration. crossOrigin="anonymous" is required: without it
          the preload does not match the fetch() and the data
          downloads twice. Only the hifz tab needs it — the umum
          reader loads V2 lazily on its own, only in page/range modes. */}
      {initialTab === 'hifz' && (
        <>
          <link
            rel="preload"
            href={QURAN_MUSHAF_V2_INDEX_URL}
            as="fetch"
            crossOrigin="anonymous"
          />
          {initialV2Page !== null && (
            <link
              rel="preload"
              href={v2PageUrl(initialV2Page)}
              as="fetch"
              crossOrigin="anonymous"
            />
          )}
        </>
      )}
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
          hifz: {
            title: t('hifzTitle'),
            surahLabel: t('hifzSurahLabel'),
            pageLabel: t('hifzPageLabel'),
            prevPage: t('hifzPrevPage'),
            nextPage: t('hifzNextPage'),
            pageJump: t('hifzPageJump'),
            studyModeOn: t('hifzStudyModeOn'),
            studyModeOff: t('hifzStudyModeOff'),
            liveStart: t('hifzLiveStart'),
            liveStop: t('hifzLiveStop'),
            liveCancel: t('hifzLiveCancel'),
            liveListening: t('hifzLiveListening'),
            liveConnecting: t('hifzLiveConnecting'),
            liveEnded: t('hifzLiveEnded'),
            liveDisconnected: t('hifzLiveDisconnected'),
            liveDiagSampleRate: t('hifzLiveDiagSampleRate'),
            liveDiagFrames: t('hifzLiveDiagFrames'),
            liveDiagSocket: t('hifzLiveDiagSocket'),
            liveRequestingPermission: t('hifzLiveRequestingPermission'),
            liveEngineLoading: t('hifzLiveEngineLoading'),
            liveInterrupted: t('hifzLiveInterrupted'),
            liveStopping: t('hifzLiveStopping'),
            liveLegacyCapture: t('hifzLiveLegacyCapture'),
            liveDeviceChanged: t('hifzLiveDeviceChanged'),
            liveFramesBeforeReady: t('hifzLiveFramesBeforeReady'),
            liveReadingNow: t('hifzLiveReadingNow'),
            liveDiagCapture: t('hifzLiveDiagCapture'),
            liveDiagDropped: t('hifzLiveDiagDropped'),
            liveOnlyZipformer: t('hifzLiveOnlyZipformer'),
            ayahLabel: t('hifzAyahLabel'),
            prevAyah: t('hifzPrevAyah'),
            nextAyah: t('hifzNextAyah'),
            wallHint: t('hifzWallHint'),
            recordGrade: t('hifzRecordGrade'),
            stopRecording: t('hifzStopRecording'),
            recording: t('hifzRecording'),
            grading: t('hifzGrading'),
            practiceWordHint: t('hifzPracticeWordHint'),
            practiceWord: t('hifzPracticeWord'),
            clearPractice: t('hifzClearPractice'),
            peekWord: t('hifzPeekWord'),
            peekAyah: t('hifzPeekAyah'),
            micDenied: t('hifzMicDenied'),
            offline: t('hifzOffline'),
            offlineDisconnected: t('hifzOfflineDisconnected'),
            modelUnavailable: t('hifzModelUnavailable'),
            pauseLive: t('hifzPauseLive'),
            resumeLive: t('hifzResumeLive'),
            pausedHint: t('hifzPausedHint'),
            startAyahHint: t('hifzStartAyahHint'),
            dispute: t('hifzDispute'),
            disputed: t('hifzDisputed'),
            signInHint: t('hifzSignInHint'),
            engineUnavailable: t('hifzEngineUnavailable'),
            selectAyahHint: t('hifzSelectAyahHint'),
            svgFailedNote: t('hifzSvgFailedNote'),
            loadingPage: t('hifzLoadingPage'),
            textsFailed: t('hifzTextsFailed'),
            textsRetry: t('hifzTextsRetry'),
            errorGeneric: t('hifzErrorGeneric'),
            noAttemptHint: t('hifzNoAttemptHint'),
            revealedByPeek: t('hifzRevealedByPeek'),
            pillErrors: t('hifzPillErrors'),
            pillAccuracy: t('hifzPillAccuracy'),
            pillTimer: t('hifzPillTimer'),
            errorsTitle: t('hifzErrorsTitle'),
            errorsWrong: t('hifzErrorsWrong'),
            errorsExtra: t('hifzErrorsExtra'),
            errorsEmpty: t('hifzErrorsEmpty'),
            errorsExpected: t('hifzErrorsExpected'),
            errorsHeard: t('hifzErrorsHeard'),
            errorsOpen: t('hifzErrorsOpen'),
            errorsClose: t('hifzErrorsClose'),
            errorsDelete: t('hifzErrorsDelete'),
            errorsTransposed: t('hifzErrorsTransposed'),
            errorsLearn: t('hifzErrorsLearn'),
            settingsTitle: t('hifzSettingsTitle'),
            settingsOpen: t('hifzSettingsOpen'),
            freezeSetting: t('hifzFreezeSetting'),
            freezeHint: t('hifzFreezeHint'),
            mistakeDetection: t('hifzMistakeDetection'),
            tashkeelDetection: t('hifzTashkeelDetection'),
            resumableSessions: t('hifzResumableSessions'),
            hideMarkers: t('hifzHideMarkers'),
            freezeHold: t('hifzFreezeHold'),
            freezeResume: t('hifzFreezeResume'),
            hideScript: t('hifzHideScript'),
            showScript: t('hifzShowScript'),
            rangeStart: t('hifzRangeStart'),
            rangeEnd: t('hifzRangeEnd'),
            repeatAyah: t('hifzRepeatAyah'),
            repeatRange: t('hifzRepeatRange'),
            rangeErrorStart: t('hifzRangeErrorStart'),
            rangeErrorEnd: t('hifzRangeErrorEnd'),
            rangeErrorOrder: t('hifzRangeErrorOrder'),
            resumeTitle: t('hifzResumeTitle'),
            resumeContinue: t('hifzResumeContinue'),
            resumeDismiss: t('hifzResumeDismiss'),
            peekWordHint: t('hifzPeekWordHint'),
            peekAyahHint: t('hifzPeekAyahHint'),
            headerJuz: t('hifzHeaderJuz'),
            headerHizb: t('hifzHeaderHizb'),
            headerPage: t('hifzHeaderPage'),
            menuOpen: t('hifzMenuOpen'),
            searchOpen: t('hifzSearchOpen'),
            searchTitle: t('hifzSearchTitle'),
            bookmarkAdd: t('hifzBookmarkAdd'),
            bookmarkRemove: t('hifzBookmarkRemove'),
            displayMode: t('hifzDisplayMode'),
            displayPage: t('hifzDisplayPage'),
            displayScroll: t('hifzDisplayScroll'),
            displayCard: t('hifzDisplayCard'),
            displaySheetTitle: t('hifzDisplaySheetTitle'),
            displayMushaf: t('hifzDisplayMushaf'),
            displayMushafDesc: t('hifzDisplayMushafDesc'),
            displayNass: t('hifzDisplayNass'),
            displayNassDesc: t('hifzDisplayNassDesc'),
            displayTranslation: t('hifzDisplayTranslation'),
            displayTranslationDesc: t('hifzDisplayTranslationDesc'),
            translationLoading: t('hifzTranslationLoading'),
            translationUnavailable: t('hifzTranslationUnavailable'),
            listenReciter: t('hifzListenReciter'),
            listenPlay: t('hifzListenPlay'),
            listenPause: t('hifzListenPause'),
            listenResume: t('hifzListenResume'),
            listenStop: t('hifzListenStop'),
            listenPrevAyah: t('hifzListenPrevAyah'),
            listenNextAyah: t('hifzListenNextAyah'),
            listenRepeat: t('hifzListenRepeat'),
            listenRepeatOff: t('hifzListenRepeatOff'),
            listenRepeatAyah: t('hifzListenRepeatAyah'),
            listenRepeatRange: t('hifzListenRepeatRange'),
            listenRepeatSurah: t('hifzListenRepeatSurah'),
            listenSpeed: t('hifzListenSpeed'),
            listenCurrentAyah: t('hifzListenCurrentAyah'),
            listenProgress: t('hifzListenProgress'),
            listenSegmentsNote: t('hifzListenSegmentsNote'),
            listenInterpolatedNote: t('hifzListenInterpolatedNote'),
            listenAudioFailed: t('hifzListenAudioFailed'),
            listenLoading: t('hifzListenLoading'),
            listenBuffering: t('hifzListenBuffering'),
            listenOffline: t('hifzListenOffline'),
            listenRetry: t('hifzListenRetry'),
            listenResumeFrom: t('hifzListenResumeFrom'),
            listenLongPressSwitch: t('hifzListenLongPressSwitch'),
            listenReciters: [
              { id: 'abdul_basit_mujawwad', label: t('hifzListenReciterAbdulBasitMujawwad') },
              { id: 'abdul_basit', label: t('hifzListenReciterAbdulBasit') },
              { id: 'sudais', label: t('hifzListenReciterSudais') },
              { id: 'shatri', label: t('hifzListenReciterShatri') },
              { id: 'hani_rifai', label: t('hifzListenReciterHaniRifai') },
              { id: 'husary', label: t('hifzListenReciterHusary') },
              { id: 'alafasy', label: t('hifzListenReciterAlafasy') },
              { id: 'minshawi_mujawwad', label: t('hifzListenReciterMinshawiMujawwad') },
              { id: 'minshawi', label: t('hifzListenReciterMinshawi') },
              { id: 'shuraym', label: t('hifzListenReciterShuraym') },
              { id: 'tablawi', label: t('hifzListenReciterTablawi') },
              { id: 'husary_muallim', label: t('hifzListenReciterHusaryMuallim') },
            ],
            mutashabihat: {
              title: t('hifzMutashabihatTitle'),
              hide: t('hifzMutashabihatHide'),
              show: t('hifzMutashabihatShow'),
              empty: t('hifzMutashabihatEmpty'),
              goToAyah: t('hifzMutashabihatGoToAyah'),
            },
            hubLink: t('hifzHubLink'),
          },
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
          settingsSheetTitle: t('settingsSheetTitle'),
          settingsSheetClose: t('settingsSheetClose'),
          settingsGroupAudio: t('settingsGroupAudio'),
          settingsGroupDisplay: t('settingsGroupDisplay'),
          settingsGroupEditions: t('settingsGroupEditions'),
          playerStatusIdle: t('playerStatusIdle'),
          playerStatusLoading: t('playerStatusLoading'),
          playerStatusPlaying: t('playerStatusPlaying'),
          playerStatusPaused: t('playerStatusPaused'),
          playerStatusEnded: t('playerStatusEnded'),
          playerStatusError: t('playerStatusError'),
          playerExpandLabel: t('playerExpandLabel'),
          playerCollapseLabel: t('playerCollapseLabel'),
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
          ayahsCountLabel: t('ayahsCount'),
          meccanLabel: t('meccan'),
          medinanLabel: t('medinan'),
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
      {providers?.providersByType?.text === 'self_hosted' && (
        <p style={{ textAlign: 'center', fontSize: '0.7rem', opacity: 0.6, marginTop: '2rem' }}>
          <a href="https://tanzil.net" target="_blank" rel="noreferrer">
            {t('textCredit')}
          </a>
        </p>
      )}
    </div>
  );
}
