'use client';

/**
 * QuranChildren — the children section shell (Phase 4, mockup screens 1–4).
 *
 * One page, three tabs in the reader (?tab=children) with its own
 * bottom tab bar: خانه (dashboard) · سوره‌ها (list) · پخش (study) ·
 * آزمون (quiz). Surah changes navigate via router.push so the URL
 * stays truthful (the RSC page server-loads the new surah's ayahs).
 *
 * Study = real printed Madani 1421 pages (the V2 pipeline hifz
 * uses) + word-by-word recitation via useQuranListen (real segments
 * when available, interpolated highlight labelled estimated) +
 * per-surah videos + offline packs. Hifz (1405) is untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QuranMushafV2Page } from './QuranMushafV2Page';
import { QuranSheetShell } from './QuranPickerSheet';
import {
  QuranChildrenDashboard,
  type ChildrenView,
} from './QuranChildrenDashboard';
import { QuranChildrenQuiz } from './QuranChildrenQuiz';
import { useQuranListen } from '@/lib/quran-listen';
import {
  fetchRecitationTiming,
  type RecitationTiming,
} from '@/lib/quran-recitation-timing';
import {
  expandV2Page,
  loadV2Index,
  loadV2Page,
  loadV2PageGlyphs,
  v2PageAyahs,
  v2PageIndexForAyah,
  v2SurahPageRange,
  type MushafWordViews,
  type V2Expansion,
  type V2MushafIndex,
  type V2Page,
  type V2PageGlyphs,
} from '@/lib/quran-mushaf-v2';
import { listenReciterPhotoUrl } from '@/lib/hifz-player';
import { normalizeQuranText } from '@/lib/quran-search';
import type { SurahSummary } from '@/lib/quran';
import {
  CHILDREN_DEFAULT_RECITER,
  CHILDREN_RECITER_STORAGE_KEY,
  downloadSurahPack,
  downloadWholeQuranPack,
  fetchChildrenOfflinePack,
  fetchChildrenProgress,
  fetchChildrenVideos,
  fetchSurahAyahTexts,
  formatNum,
  isAudioCached,
  pickLocalizedText,
  recordChildrenListen,
  type ChildrenLabels,
  type ChildrenProgress,
  type ChildrenVideo,
  type WholeQuranDownloadProgress,
} from '@/lib/quran-children';

export function QuranChildren({
  locale,
  surahNumber,
  surahNameAr,
  ayahCount,
  initialAyah,
  initialView,
  initialTexts,
  ayahAudioUrls,
  surahList,
  labels,
  reciterPhotos,
  bismillah,
}: {
  locale: string;
  surahNumber: number;
  surahNameAr: string;
  ayahCount: number;
  initialAyah: number | null;
  initialView: ChildrenView;
  initialTexts: Record<number, string>;
  ayahAudioUrls: Record<number, string | null>;
  surahList: SurahSummary[];
  labels: ChildrenLabels;
  reciterPhotos: Record<string, string | null>;
  bismillah: string;
}): React.ReactElement {
  const router = useRouter();
  const [view, setView] = useState<ChildrenView>(
    initialAyah !== null ? 'study' : initialView,
  );
  const [reciter, setReciter] = useState<string>(() => {
    if (typeof window === 'undefined') return CHILDREN_DEFAULT_RECITER;
    try {
      return (
        window.localStorage.getItem(CHILDREN_RECITER_STORAGE_KEY) ??
        CHILDREN_DEFAULT_RECITER
      );
    } catch {
      return CHILDREN_DEFAULT_RECITER;
    }
  });
  const [reciterSheetOpen, setReciterSheetOpen] = useState(false);
  const [progressBySurah, setProgressBySurah] = useState<
    Map<number, ChildrenProgress>
  >(new Map());

  const goTo = useCallback(
    (surah: number, nextView: ChildrenView, ayah?: number) => {
      const params = new URLSearchParams({ tab: 'children', cview: nextView });
      if (ayah !== undefined && ayah > 1) params.set('ayah', String(ayah));
      router.push(`/${locale}/quran/${surah}?${params.toString()}`);
      setView(nextView);
    },
    [locale, router],
  );

  const loadProgress = useCallback(async () => {
    try {
      const rows = await fetchChildrenProgress();
      setProgressBySurah(new Map(rows.map((r) => [r.surah, r])));
    } catch {
      // Guest or offline — the list still renders, without stars.
    }
  }, []);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  useEffect(() => {
    if (view === 'list' || view === 'home') void loadProgress();
  }, [view, loadProgress]);

  // A new URL surah resets the view (the study remounts via key).
  useEffect(() => {
    setView(initialAyah !== null ? 'study' : initialView);
  }, [surahNumber, initialAyah, initialView]);

  const pickReciter = useCallback((id: string) => {
    setReciter(id);
    try {
      window.localStorage.setItem(CHILDREN_RECITER_STORAGE_KEY, id);
    } catch {
      /* storage unavailable — the choice still applies this visit */
    }
    setReciterSheetOpen(false);
  }, []);

  const tabs: { id: ChildrenView; label: string }[] = [
    { id: 'home', label: labels.tabHome },
    { id: 'list', label: labels.tabList },
    { id: 'study', label: labels.tabStudy },
    { id: 'quiz', label: labels.tabQuiz },
  ];

  return (
    <div className="quran-children">
      {view === 'home' && (
        <QuranChildrenDashboard
          labels={labels}
          locale={locale}
          surahList={surahList}
          returnUrl={`/${locale}/quran/${surahNumber}?tab=children`}
          onNavigate={(surah, nextView, ayah) => goTo(surah, nextView, ayah)}
        />
      )}
      {view === 'list' && (
        <ChildrenList
          labels={labels}
          locale={locale}
          surahList={surahList}
          progressBySurah={progressBySurah}
          onOpen={(surah) => goTo(surah, 'study')}
        />
      )}
      {view === 'study' && (
        <ChildrenStudy
          key={`${surahNumber}:${reciter}`}
          labels={labels}
          locale={locale}
          surahNumber={surahNumber}
          surahNameAr={surahNameAr}
          ayahCount={ayahCount}
          initialAyah={initialAyah}
          initialTexts={initialTexts}
          ayahAudioUrls={ayahAudioUrls}
          reciter={reciter}
          reciterPhotos={reciterPhotos}
          bismillah={bismillah}
          onPickReciter={() => setReciterSheetOpen(true)}
        />
      )}
      {view === 'quiz' && (
        <QuranChildrenQuiz
          labels={labels}
          locale={locale}
          surah={surahNumber}
          surahNameAr={surahNameAr}
        />
      )}

      <nav className="quran-children-tabbar" aria-label={labels.homeTitle}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={view === t.id ? 'page' : undefined}
            className={view === t.id ? 'is-active' : ''}
            onClick={() => setView(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {reciterSheetOpen && (
        <QuranSheetShell
          title={labels.reciterPick}
          closeLabel={labels.reciterClose}
          onClose={() => setReciterSheetOpen(false)}
        >
          <ul className="quran-children-reciters">
            {labels.reciterNames.map((r) => {
              const photo = listenReciterPhotoUrl(r.id, reciterPhotos);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={reciter === r.id}
                    className={reciter === r.id ? 'is-active' : ''}
                    onClick={() => pickReciter(r.id)}
                  >
                    {photo ? (
                      <img src={photo} alt="" width={40} height={40} />
                    ) : (
                      <span className="quran-children-reciter-ph" aria-hidden="true">
                        ♪
                      </span>
                    )}
                    <span>{r.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </QuranSheetShell>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Surah list (mockup screen 2)
// ---------------------------------------------------------------------------

type ListFilter = 'all' | 'juz30' | 'completed' | 'learning';

function ChildrenList({
  labels,
  locale,
  surahList,
  progressBySurah,
  onOpen,
}: {
  labels: ChildrenLabels;
  locale: string;
  surahList: SurahSummary[];
  progressBySurah: Map<number, ChildrenProgress>;
  onOpen: (surah: number) => void;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');

  const rows = useMemo(() => {
    const q = normalizeQuranText(query.trim());
    const digits = query
      .trim()
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString())
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());
    return surahList.filter((s) => {
      const p = progressBySurah.get(s.number);
      if (filter === 'juz30' && !s.juz.includes(30)) return false;
      if (filter === 'completed' && p?.status !== 'completed') return false;
      if (filter === 'learning' && p?.status !== 'learning') return false;
      if (!q && !digits) return true;
      const num = Number(digits);
      if (Number.isInteger(num) && num >= 1 && num <= 114 && s.number === num)
        return true;
      const hay = normalizeQuranText(`${s.nameAr} ${s.englishName} ${s.number}`);
      return q !== '' && hay.includes(q);
    });
  }, [surahList, progressBySurah, query, filter]);

  const filters: { id: ListFilter; label: string }[] = [
    { id: 'all', label: labels.filterAll },
    { id: 'juz30', label: labels.filterJuz30 },
    { id: 'completed', label: labels.filterCompleted },
    { id: 'learning', label: labels.filterLearning },
  ];

  return (
    <section className="quran-children-list">
      <h2>{labels.listTitle}</h2>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={labels.listSearchPlaceholder}
        aria-label={labels.listSearchPlaceholder}
        className="quran-children-search"
      />
      <div className="quran-children-filters" role="group" aria-label={labels.listTitle}>
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            className={filter === f.id ? 'is-active' : ''}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p>{labels.listEmpty}</p>
      ) : (
        <ol className="quran-children-surahs">
          {rows.map((s) => {
            const p = progressBySurah.get(s.number);
            const stars = p?.stars ?? 0;
            const listened = p?.listened_ayahs ?? 0;
            const pct =
              s.ayahCount > 0
                ? Math.min(100, Math.round((listened / s.ayahCount) * 100))
                : 0;
            return (
              <li key={s.number}>
                <button type="button" onClick={() => onOpen(s.number)}>
                  <span className="quran-children-surah-num">
                    {formatNum(s.number, locale)}
                  </span>
                  <span className="quran-children-surah-meta">
                    <span className="quran-children-surah-name">{s.nameAr}</span>
                    <span className="quran-children-surah-sub">
                      {labels.surahNumber.replace('%n%', formatNum(s.number, locale))}
                      {' · '}
                      {labels.ayahCount.replace('%n%', formatNum(s.ayahCount, locale))}
                      {s.englishName ? ` · ${s.englishName}` : ''}
                    </span>
                    <span
                      className="quran-children-progressbar"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                  <span
                    className="quran-children-stars"
                    aria-label={`${formatNum(stars, locale)} / 3`}
                  >
                    {'★'.repeat(stars)}
                    {'☆'.repeat(3 - stars)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Study: Madani 1421 page + word-by-word player + videos + offline
// ---------------------------------------------------------------------------

function ChildrenStudy({
  labels,
  locale,
  surahNumber,
  surahNameAr,
  ayahCount,
  initialAyah,
  initialTexts,
  ayahAudioUrls,
  reciter,
  reciterPhotos,
  bismillah,
  onPickReciter,
}: {
  labels: ChildrenLabels;
  locale: string;
  surahNumber: number;
  surahNameAr: string;
  ayahCount: number;
  initialAyah: number | null;
  initialTexts: Record<number, string>;
  ayahAudioUrls: Record<number, string | null>;
  reciter: string;
  reciterPhotos: Record<string, string | null>;
  bismillah: string;
  onPickReciter: () => void;
}): React.ReactElement {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [studyAyah, setStudyAyah] = useState<number>(initialAyah ?? 1);
  const [pageOverride, setPageOverride] = useState<number | null>(null);
  const [volume, setVolume] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    try {
      const v = Number(window.localStorage.getItem('children-volume'));
      return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
    } catch {
      return 1;
    }
  });

  // Completion tracking: the hook's callbacks fire for manual jumps
  // too, so an ayah counts as listened only when playback really
  // reached its end (segments: timing toMs; interpolated: 90% of
  // the ayah duration). One POST per ayah per visit.
  const timingRef = useRef<RecitationTiming | null>(null);
  const lastProgressRef = useRef({
    ayah: 1,
    progressMs: 0,
    durationMs: 0,
  });
  const recordedRef = useRef<Set<string>>(new Set());
  const wasPlayingRef = useRef(false);

  const recordIfComplete = useCallback(
    (ayah: number, snap: { progressMs: number; durationMs: number }) => {
      const key = `${surahNumber}:${ayah}`;
      if (recordedRef.current.has(key)) return;
      const timingAyah = timingRef.current?.ayahs.find((a) => a.ayah === ayah);
      const complete =
        timingAyah !== undefined
          ? snap.progressMs >= timingAyah.toMs - 500
          : snap.durationMs > 0 && snap.progressMs >= 0.9 * snap.durationMs;
      if (!complete) return;
      recordedRef.current.add(key);
      void recordChildrenListen(surahNumber, ayah).catch(() => {
        // Guest or offline — the listen simply isn't recorded.
        recordedRef.current.delete(key);
      });
    },
    [surahNumber],
  );

  const [currentWord, setCurrentWord] = useState<{
    ayah: number;
    word: number;
  } | null>(null);

  const listen = useQuranListen({
    reciter,
    surah: surahNumber,
    ayahTexts: initialTexts,
    ayahAudioUrls,
    ayahCount,
    audioRef,
    onAyahChange: (ayah) => {
      const snap = lastProgressRef.current;
      if (ayah === snap.ayah + 1) recordIfComplete(snap.ayah, snap);
      setStudyAyah(ayah);
      setPageOverride(null);
    },
    onWordChange: (ayah, word) => {
      setCurrentWord(word === null ? null : { ayah, word });
    },
  });

  // Last rendered playback position (the completion check reads this).
  useEffect(() => {
    lastProgressRef.current = {
      ayah: listen.currentAyah,
      progressMs: listen.progressMs,
      durationMs: listen.durationMs,
    };
  }, [listen.currentAyah, listen.progressMs, listen.durationMs]);

  // Surah finished: the last ayah never advances, so record it here.
  useEffect(() => {
    const was = wasPlayingRef.current;
    wasPlayingRef.current = listen.isPlaying;
    if (was && !listen.isPlaying && listen.currentAyah === ayahCount) {
      recordIfComplete(ayahCount, lastProgressRef.current);
    }
  }, [listen.isPlaying, listen.currentAyah, ayahCount, recordIfComplete]);

  // The component's own timing copy (completion check + cache).
  useEffect(() => {
    let cancelled = false;
    timingRef.current = null;
    fetchRecitationTiming(reciter, surahNumber)
      .then((t) => {
        if (!cancelled) timingRef.current = t;
      })
      .catch(() => {
        /* null = interpolated mode; the hook already handles it */
      });
    return () => {
      cancelled = true;
    };
  }, [reciter, surahNumber]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    try {
      window.localStorage.setItem('children-volume', String(volume));
    } catch {
      /* ignore */
    }
  }, [volume]);

  // --- V2 mushaf page (1421) -------------------------------------------
  const [v2Index, setV2Index] = useState<V2MushafIndex | null | undefined>(
    undefined,
  );
  const [neighborTexts, setNeighborTexts] = useState<
    Record<number, Record<number, string>>
  >({});
  useEffect(() => {
    let cancelled = false;
    loadV2Index().then((index) => {
      if (!cancelled) setV2Index(index ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const surahRange = useMemo(
    () =>
      v2Index
        ? v2SurahPageRange(v2Index, surahNumber, ayahCount)
        : null,
    [v2Index, surahNumber, ayahCount],
  );
  const firstPageNum = surahRange ? surahRange.firstPage + 1 : null;
  const lastPageNum = surahRange ? surahRange.lastPage + 1 : null;

  const pageOfAyah = useCallback(
    (ayah: number): number | null => {
      if (!v2Index) return null;
      const idx = v2PageIndexForAyah(v2Index, surahNumber, ayah);
      return idx === null ? null : idx + 1;
    },
    [v2Index, surahNumber],
  );
  const pageNumber =
    pageOverride ?? pageOfAyah(studyAyah) ?? firstPageNum ?? 1;

  const [v2Page, setV2Page] = useState<V2Page | null | undefined>(undefined);
  const [v2Glyphs, setV2Glyphs] = useState<V2PageGlyphs | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let cancelled = false;
    setV2Page(undefined);
    setV2Glyphs(undefined);
    loadV2Page(pageNumber).then((page) => {
      if (!cancelled) setV2Page(page);
    });
    loadV2PageGlyphs(pageNumber).then((glyphs) => {
      if (!cancelled) setV2Glyphs(glyphs);
    });
    return () => {
      cancelled = true;
    };
  }, [pageNumber]);

  // Neighbour surahs on this page (the strict expansion needs every
  // ayah's tokens on the page — short Juz-30 surahs share pages).
  useEffect(() => {
    if (!v2Page) return;
    const needed = new Set<number>();
    for (const ref of v2PageAyahs(v2Page)) {
      const n = Number(ref.split(':')[0]);
      if (n !== surahNumber) needed.add(n);
    }
    for (const n of needed) {
      if (neighborTexts[n]) continue;
      fetchSurahAyahTexts(n)
        .then((texts) =>
          setNeighborTexts((prev) =>
            prev[n] ? prev : { ...prev, [n]: texts },
          ),
        )
        .catch(() => {
          /* expansion falls back to the text view below */
        });
    }
  }, [v2Page, surahNumber, neighborTexts]);

  const tokens = useMemo(() => {
    const map = new Map<string, readonly string[]>();
    const put = (surah: number, ayah: number, text: string) => {
      const toks = text.split(/\s+/).filter(Boolean);
      if (toks.length > 0) map.set(`${surah}:${ayah}`, toks);
    };
    for (const [num, text] of Object.entries(initialTexts)) {
      put(surahNumber, Number(num), text);
    }
    for (const [surah, ayahs] of Object.entries(neighborTexts)) {
      for (const [num, text] of Object.entries(ayahs)) {
        put(Number(surah), Number(num), text);
      }
    }
    return map;
  }, [initialTexts, neighborTexts, surahNumber]);

  const v2Expansion: V2Expansion | null = useMemo(() => {
    if (!v2Index || !v2Page) return null;
    return expandV2Page(v2Index, v2Page, tokens, v2Glyphs ?? undefined);
  }, [v2Index, v2Page, tokens, v2Glyphs]);

  const wordViews: MushafWordViews = useMemo(() => {
    if (!currentWord) return {};
    const key = `${surahNumber}:${currentWord.ayah}:${currentWord.word - 1}`;
    return { [key]: { state: 'recent' } };
  }, [currentWord, surahNumber]);

  const gotoPage = useCallback(
    (dir: -1 | 1) => {
      if (firstPageNum === null || lastPageNum === null) return;
      setPageOverride((p) => {
        const cur = p ?? pageOfAyah(studyAyah) ?? firstPageNum;
        return Math.min(lastPageNum, Math.max(firstPageNum, cur + dir));
      });
    },
    [firstPageNum, lastPageNum, pageOfAyah, studyAyah],
  );

  const playFrom = useCallback(
    (ayah: number) => {
      const clamped = Math.min(ayahCount, Math.max(1, ayah));
      setStudyAyah(clamped);
      setPageOverride(null);
      if (listen.isPlaying || listen.currentAyah !== clamped) {
        listen.playAyah(clamped);
      }
    },
    [ayahCount, listen],
  );

  const onPlayToggle = useCallback(() => {
    if (listen.isPlaying) {
      listen.pause();
      return;
    }
    if (listen.currentAyah !== studyAyah) listen.playAyah(studyAyah);
    else listen.play();
  }, [listen, studyAyah]);

  const cycleRepeat = useCallback(() => {
    const order = ['off', 'ayah', 'surah'] as const;
    const next = order[(order.indexOf(listen.repeatMode as (typeof order)[number]) + 1) % order.length] ?? 'off';
    listen.setRepeatMode(next);
  }, [listen]);

  const repeatLabel =
    listen.repeatMode === 'ayah'
      ? labels.repeatAyah
      : listen.repeatMode === 'surah'
        ? labels.repeatSurah
        : labels.repeatOff;

  const reciterName =
    labels.reciterNames.find((r) => r.id === reciter)?.label ?? reciter;
  const reciterPhoto = listenReciterPhotoUrl(reciter, reciterPhotos);

  // --- Videos + offline --------------------------------------------------
  const [videos, setVideos] = useState<ChildrenVideo[] | null>(null);
  const [videosFailed, setVideosFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setVideos(null);
    setVideosFailed(false);
    fetchChildrenVideos(surahNumber)
      .then((v) => {
        if (!cancelled) setVideos(v);
      })
      .catch(() => {
        if (!cancelled) setVideosFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [surahNumber]);

  const [packAudioUrl, setPackAudioUrl] = useState<string | null>(null);
  const [packDownloaded, setPackDownloaded] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [packNotice, setPackNotice] = useState<string | null>(null);
  const [wholeProgress, setWholeProgress] =
    useState<WholeQuranDownloadProgress | null>(null);
  const wholeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPackAudioUrl(null);
    setPackDownloaded(false);
    setPackNotice(null);
    fetchChildrenOfflinePack(surahNumber, reciter)
      .then(async (pack) => {
        if (cancelled) return;
        setPackAudioUrl(pack.audio_url);
        if (pack.audio_url) {
          setPackDownloaded(await isAudioCached(pack.audio_url));
        }
      })
      .catch(() => {
        /* download stays unavailable; the note explains it */
      });
    return () => {
      cancelled = true;
    };
  }, [surahNumber, reciter]);

  const onDownloadSurah = useCallback(async () => {
    setPackBusy(true);
    setPackNotice(null);
    try {
      const { ok, audioUrl } = await downloadSurahPack(surahNumber, reciter);
      if (ok && audioUrl) {
        setPackDownloaded(true);
        setPackNotice(labels.offlineDone);
      } else {
        setPackNotice(labels.offlineFailed);
      }
    } catch {
      setPackNotice(labels.offlineFailed);
    } finally {
      setPackBusy(false);
    }
  }, [surahNumber, reciter, labels]);

  const onDownloadWhole = useCallback(async () => {
    if (wholeProgress) return;
    setPackNotice(null);
    const ctrl = new AbortController();
    wholeAbortRef.current = ctrl;
    setWholeProgress({ done: 0, total: 114, failed: 0 });
    try {
      const final = await downloadWholeQuranPack(
        reciter,
        (p) => setWholeProgress(p),
        ctrl.signal,
      );
      setPackNotice(
        final.failed === 0
          ? labels.offlineDone
          : `${labels.offlineDone} — ${formatNum(final.failed, locale)}`,
      );
    } catch {
      setPackNotice(labels.offlineFailed);
    } finally {
      wholeAbortRef.current = null;
      setWholeProgress(null);
    }
  }, [wholeProgress, reciter, labels, locale]);

  const progressPct =
    listen.durationMs > 0
      ? Math.min(100, (listen.progressMs / listen.durationMs) * 100)
      : 0;

  const seekFromBar = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (listen.durationMs <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      // RTL: the bar fills from the right.
      const ratio = Math.min(1, Math.max(0, (rect.right - e.clientX) / rect.width));
      listen.seek(ratio * listen.durationMs);
    },
    [listen],
  );

  const pageAyahRefs = v2Page ? v2PageAyahs(v2Page) : [`${surahNumber}:${studyAyah}`];

  return (
    <section className="quran-children-study">
      <audio ref={audioRef} preload="metadata" aria-hidden="true" />

      <header className="quran-children-surahbar">
        <h2>{surahNameAr}</h2>
        <span>{labels.surahNumber.replace('%n%', formatNum(surahNumber, locale))}</span>
        <span>
          {labels.pageLabel.replace('%n%', formatNum(pageNumber, locale))}
        </span>
      </header>

      <div className="quran-children-mushaf">
        {v2Expansion?.ok && v2Page ? (
          <QuranMushafV2Page
            page={v2Page}
            expansion={v2Expansion}
            bismillah={bismillah}
            pageCurrent={labels.pageLabel}
            wordViews={wordViews}
            onSelectWord={(key) => {
              const parts = key.split(':');
              const ayah = Number(parts[1]);
              if (Number.isInteger(ayah) && ayah >= 1 && ayah <= ayahCount) {
                playFrom(ayah);
              }
            }}
            linesClickable={false}
            showNav={false}
            hideMeta
          />
        ) : (
          <div className="quran-children-fallback" role="note">
            {v2Page === undefined || v2Index === undefined ? (
              <p>{labels.audioLoading}</p>
            ) : (
              <>
                <p>{labels.pageFailed}</p>
                <div className="quran-children-fallback-text">
                  {pageAyahRefs.map((ref) => {
                    const [s, a] = ref.split(':').map(Number);
                    const text =
                      s === surahNumber
                        ? initialTexts[a]
                        : neighborTexts[s]?.[a];
                    if (!text) return null;
                    const words = text.split(/\s+/).filter(Boolean);
                    return (
                      <p key={ref} className="quran-children-fallback-ayah">
                        {words.map((w, i) => {
                          const isNow =
                            currentWord !== null &&
                            currentWord.ayah === a &&
                            currentWord.word - 1 === i &&
                            s === surahNumber;
                          return (
                            <span
                              key={i}
                              className={
                                isNow ? 'quran-children-word-now' : undefined
                              }
                            >
                              {w}{' '}
                            </span>
                          );
                        })}
                        <span className="quran-children-fallback-num">
                          ﴿{formatNum(a, locale)}﴾
                        </span>
                      </p>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="quran-children-pagenav">
        <button
          type="button"
          disabled={firstPageNum === null || pageNumber <= firstPageNum}
          onClick={() => gotoPage(-1)}
        >
          {labels.prevPage}
        </button>
        <span>
          {labels.pageLabel.replace('%n%', formatNum(pageNumber, locale))}
        </span>
        <button
          type="button"
          disabled={lastPageNum === null || pageNumber >= lastPageNum}
          onClick={() => gotoPage(1)}
        >
          {labels.nextPage}
        </button>
      </div>

      {/* Player — mirrors the general reader's controls */}
      <div className="quran-children-player">
        <button
          type="button"
          className="quran-children-reciter-btn"
          onClick={onPickReciter}
          aria-label={`${labels.reciter}: ${reciterName}`}
        >
          {reciterPhoto ? (
            <img src={reciterPhoto} alt="" width={48} height={48} />
          ) : (
            <span className="quran-children-reciter-ph" aria-hidden="true">♪</span>
          )}
          <span>{reciterName}</span>
        </button>

        <div
          className="quran-children-progress"
          role="slider"
          aria-label={labels.studyTitle}
          aria-valuemin={0}
          aria-valuemax={Math.round(listen.durationMs)}
          aria-valuenow={Math.round(listen.progressMs)}
          tabIndex={0}
          onClick={seekFromBar}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              // Forward in time is leftward in RTL, rightward in LTR.
              const isRtl =
                typeof document !== 'undefined' &&
                document.documentElement.dir === 'rtl';
              const forward =
                (isRtl && e.key === 'ArrowLeft') ||
                (!isRtl && e.key === 'ArrowRight');
              const step = listen.durationMs * 0.05;
              listen.seek(
                Math.min(
                  listen.durationMs,
                  Math.max(
                    0,
                    listen.progressMs + (forward ? step : -step),
                  ),
                ),
              );
            }
          }}
        >
          <i style={{ width: `${progressPct}%` }} />
        </div>

        <div className="quran-children-controls">
          <button
            type="button"
            disabled={studyAyah <= 1 && !listen.isPlaying}
            onClick={() =>
              listen.isPlaying
                ? listen.prevAyah()
                : playFrom(studyAyah - 1)
            }
            aria-label={labels.prevAyah}
          >
            ‹
          </button>
          <button
            type="button"
            className="quran-children-play"
            onClick={onPlayToggle}
            aria-label={listen.isPlaying ? labels.pause : labels.play}
            disabled={listen.listenStatus === 'loading'}
          >
            {listen.isPlaying ? '❚❚' : '▶'}
          </button>
          <button
            type="button"
            disabled={studyAyah >= ayahCount && !listen.isPlaying}
            onClick={() =>
              listen.isPlaying
                ? listen.nextAyah()
                : playFrom(studyAyah + 1)
            }
            aria-label={labels.nextAyah}
          >
            ›
          </button>
          <button
            type="button"
            className="quran-children-speed"
            onClick={() => listen.cycleSpeed()}
            aria-label={labels.speed}
          >
            {`${listen.speed}×`}
          </button>
          <button
            type="button"
            className="quran-children-repeat"
            onClick={cycleRepeat}
            aria-label={labels.repeat}
            aria-pressed={listen.repeatMode !== 'off'}
          >
            {repeatLabel}
          </button>
        </div>

        <div className="quran-children-volume">
          <label>
            {labels.volume}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
        </div>

        {listen.timingSource === 'interpolated' && listen.isPlaying && (
          <p className="quran-children-hint">{labels.timingEstimated}</p>
        )}
        {listen.listenError && (
          <p role="alert" className="quran-children-error">
            {labels.audioFailed}{' '}
            <button type="button" onClick={() => listen.retry()}>
              {labels.retry}
            </button>
          </p>
        )}
        {listen.listenStatus === 'loading' && (
          <p className="quran-children-hint">{labels.audioLoading}</p>
        )}
        {listen.hasSavedPosition && !listen.isPlaying && (
          <button
            type="button"
            className="quran-children-btn"
            onClick={() => listen.resumeSaved()}
          >
            {labels.resumeFrom.replace(
              '%n%',
              formatNum(listen.savedPosition?.ayah ?? 1, locale),
            )}
          </button>
        )}
      </div>

      {/* Videos */}
      <h3>{labels.videosTitle}</h3>
      {videosFailed ? (
        <p role="alert">{labels.error}</p>
      ) : videos === null ? (
        <p>{labels.audioLoading}</p>
      ) : videos.length === 0 ? (
        <p>{labels.videosEmpty}</p>
      ) : (
        <ul className="quran-children-videos">
          {videos.map((v) => (
            <li key={v.id}>
              {v.embed_url ? (
                <iframe
                  src={v.embed_url}
                  title={pickLocalizedText(v.title, locale)}
                  allowFullScreen
                  loading="lazy"
                />
              ) : v.stream_url ? (
                <video
                  controls
                  preload="metadata"
                  src={v.stream_url}
                  poster={v.cover_url ?? undefined}
                />
              ) : (
                <a href={v.external_url ?? '#'} target="_blank" rel="noreferrer">
                  {labels.videoWatch}
                </a>
              )}
              <p>
                {pickLocalizedText(v.title, locale)}
                <span className="quran-children-source">{v.source_label}</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Offline */}
      <h3>{labels.offlineTitle}</h3>
      <p className="quran-children-hint">{labels.offlineNote}</p>
      <div className="quran-children-offline">
        <button
          type="button"
          className="quran-children-btn"
          disabled={packBusy || !packAudioUrl || packDownloaded}
          onClick={() => void onDownloadSurah()}
        >
          {packDownloaded ? labels.offlineDownloaded : labels.offlineSurah}
        </button>
        <button
          type="button"
          className="quran-children-btn"
          disabled={wholeProgress !== null}
          onClick={() => void onDownloadWhole()}
        >
          {labels.offlineWhole}
        </button>
        {wholeProgress && (
          <>
            <p>
              {labels.offlineDownloading
                .replace('%done%', formatNum(wholeProgress.done, locale))
                .replace('%total%', formatNum(wholeProgress.total, locale))}
            </p>
            <button
              type="button"
              className="quran-children-btn"
              onClick={() => wholeAbortRef.current?.abort()}
            >
              {labels.offlineCancel}
            </button>
          </>
        )}
        {packNotice && <p role="status">{packNotice}</p>}
      </div>
    </section>
  );
}
