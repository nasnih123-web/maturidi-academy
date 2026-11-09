/**
 * hifz-study/HifzStudyHeader: the Tarteel top bar, row 1 (2026-11-08).
 * Presentational only: hamburger + surah card (bookmark + «سُورَةُ»
 * name + page | juz | hizb) + search + settings gear, in RTL order.
 * The eye (hide/show script) and the practice/listen mode toggle
 * lived in row 2, rendered by the parent (QuranHifzStudy) — this
 * file renders row 1 only. Row 2 is gone (2026-11-08): the toggle
 * was removed and the eye moved to the bottom bar, so the icons
 * below are exported for the parent's bottom bar. The old <h2>
 * page title is gone: the surah name on the card is the title now.
 *
 * Props are all plain values/callbacks; the bookmark state, the
 * setup-panel state and the search sheet state live in the parent.
 * `bookmarked === null` means "no page on screen yet" — then the
 * card renders without a bookmark icon (never a dead control).
 */
import { toArabicIndic } from '@/lib/quran-print-lines';
import type { HifzLabels } from '@/lib/hifz-study-types';

/** Page/juz/hizb of the page on screen (null = not known yet). */
export type HifzHeaderMeta = {
  page: number | null;
  juz: number | null;
  hizb: number | null;
} | null;

/** Hide/show-script eye (row 2 lives in the parent, so the icons
    are exported for it). */
export function EyeIcon() {
  return (
    <svg className="hifz-header-action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg className="hifz-header-action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 10 7-.4.7-1 1.6-1.9 2.5M6.6 6.6C4.9 7.9 3.4 9.9 2 12c1.5 2.5 5 7 10 7 1.5 0 2.9-.4 4.1-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg className="hifz-header-action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.9" y1="4.9" x2="7" y2="7" />
        <line x1="17" y1="17" x2="19.1" y2="19.1" />
        <line x1="19.1" y1="4.9" x2="17" y2="7" />
        <line x1="7" y1="17" x2="4.9" y2="19.1" />
      </g>
      <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg className="hifz-header-action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </g>
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="hifz-header-action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg className="hifz-header-bookmark-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 3h12v18l-6-4.5L6 21V3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BookmarkFilledIcon() {
  return (
    <svg className="hifz-header-bookmark-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h12v18l-6-4.5L6 21V3z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function HifzStudyHeader({
  surahName,
  headerMeta,
  liveActive,
  surah,
  ayah,
  labels,
  menuOpen,
  onOpenMenu,
  onOpenSearch,
  bookmarked,
  onToggleBookmark,
  onOpenSettings,
}: {
  surahName: string;
  headerMeta: HifzHeaderMeta;
  liveActive: boolean;
  surah: number;
  ayah: number;
  labels: HifzLabels;
  /** Hamburger toggles the session-setup panel (the old
      «surah · ayah ▾» toggle button is gone). */
  menuOpen: boolean;
  onOpenMenu: () => void;
  /** Opens the Quran search sheet (QuranSearchBox). */
  onOpenSearch: () => void;
  /** Page bookmark, page on screen: true = saved, false = not,
      null = no page known yet (no icon rendered). */
  bookmarked: boolean | null;
  onToggleBookmark: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <header className="hifz-header">
      <div className="hifz-topbar-row">
        <button
          type="button"
          className="hifz-header-action"
          aria-label={labels.menuOpen}
          title={labels.menuOpen}
          aria-expanded={menuOpen}
          onClick={onOpenMenu}
        >
          <HamburgerIcon />
        </button>
        <p className="hifz-header-sub">
          <span className="hifz-header-text">
            <span className="hifz-header-surah">سُورَةُ {surahName}</span>
            {headerMeta &&
              headerMeta.page !== null &&
              headerMeta.juz !== null &&
              headerMeta.hizb !== null && (
                <span className="hifz-header-meta">
                  {labels.headerPage} {toArabicIndic(headerMeta.page)} {' | '}
                  {labels.headerJuz} {toArabicIndic(headerMeta.juz)} {' | '}
                  {labels.headerHizb} {toArabicIndic(headerMeta.hizb)}
                  {liveActive && (
                    <>
                      {' | '}
                      <span className="hifz-header-pos">
                        {toArabicIndic(surah)}:{toArabicIndic(ayah)}
                      </span>
                    </>
                  )}
                </span>
              )}
          </span>
          {bookmarked !== null && (
            <button
              type="button"
              className="hifz-header-bookmark"
              aria-pressed={bookmarked}
              aria-label={bookmarked ? labels.bookmarkRemove : labels.bookmarkAdd}
              title={bookmarked ? labels.bookmarkRemove : labels.bookmarkAdd}
              onClick={onToggleBookmark}
            >
              {bookmarked ? <BookmarkFilledIcon /> : <BookmarkIcon />}
            </button>
          )}
        </p>
        <button
          type="button"
          className="hifz-header-action"
          aria-label={labels.searchOpen}
          title={labels.searchOpen}
          onClick={onOpenSearch}
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className="hifz-header-action"
          aria-label={labels.settingsOpen}
          title={labels.settingsOpen}
          onClick={onOpenSettings}
        >
          <GearIcon />
        </button>
      </div>
    </header>
  );
}
