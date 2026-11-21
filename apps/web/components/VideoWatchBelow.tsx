'use client';

/**
 * VideoWatchBelow — بخش زیر پلیر در صفحهٔ تماشا (طرح موبایل 3d):
 * کارت ادامهٔ تماشا، عنوان، ردیف متا (مدرس/تاریخ انتشار/مدت/زیرنویس)،
 * توضیح بازشونده، ردیف اکشن جدا (دانلود/اشتراک‌گذاری/ذخیره)، برچسب‌های
 * مینیمال هشتگی و — فقط موبایل — سه تب قسمت‌ها/فهرست پخش/ویدیوهای مشابه.
 * دسکتاپ سایدبار خودش را دارد؛ CSS این تب‌ها را ≥901px پنهان می‌کند.
 *
 * پیشرفت تماشا دقیقاً با همان منطق پلیر خوانده می‌شود (API برای
 * واردشده‌ها، localStorage برای مهمان)؛ کارت فقط وقتی موقعیت معناداری
 * هست رندر می‌شود و دکمه‌اش رویداد پخش پلیر را صدا می‌زند.
 * ذخیره فقط برای واردشده‌هاست؛ مهمان به صفحهٔ ورود با next برمی‌گردد.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authFetch, getAccessToken } from '@/lib/auth-client';
import type { SidebarVideoRow } from './VideoWatchSidebar';

export interface WatchPlaylistTab {
  id: string;
  title: string;
  countLabel: string;
  coverUrl: string | null;
  href: string;
  current: boolean;
}

export interface VideoWatchBelowLabels {
  publishedLabel: string;
  durationLabel: string;
  subtitlesLabel: string;
  download: string;
  watchOnYouTube: string;
  share: string;
  linkCopied: string;
  save: string;
  saved: string;
  tagsLabel: string;
  episodesTab: string;
  playlistsTab: string;
  currentPlaylist: string;
  similarTab: string;
  nowPlaying: string;
  resumeTitle: string;
  /** قالب با جای‌نگهدار __PCT__ — درصد سمت کلاینت پر می‌شود. */
  resumePercentTemplate: string;
  /** قالب با جای‌نگهدار __TIME__ — زمان سمت کلاینت پر می‌شود. */
  resumeFromTemplate: string;
  more: string;
  less: string;
}

const SUBTITLE_AUTONYMS: Record<string, string> = {
  fa: 'فارسی',
  ar: 'العربية',
  en: 'English',
  ur: 'اردو',
  dari: 'دری',
};

type TabKey = 'episodes' | 'playlists' | 'similar';

export function VideoWatchBelow({
  itemId,
  locale,
  title,
  scholarName,
  dateLabel,
  durationLabel,
  durationSeconds,
  subtitleLangs,
  description,
  tags,
  isExternal,
  externalUrl,
  streamUrl,
  resumeEnabled,
  playlistTitle,
  positionLabel,
  playlistItems,
  playlists,
  related,
  labels,
}: {
  itemId: string;
  locale: string;
  title: string;
  scholarName: string | null;
  dateLabel: string;
  durationLabel: string;
  durationSeconds: number | null;
  subtitleLangs: string[];
  description: string;
  tags: string[];
  isExternal: boolean;
  externalUrl: string | null;
  streamUrl: string | null;
  resumeEnabled: boolean;
  playlistTitle: string | null;
  positionLabel: string | null;
  playlistItems: SidebarVideoRow[];
  playlists: WatchPlaylistTab[];
  related: SidebarVideoRow[];
  labels: VideoWatchBelowLabels;
}) {
  const nf = new Intl.NumberFormat(locale, { useGrouping: false });
  const fmtTime = (sec: number): string => {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const p2 = (n: number) => nf.format(n).padStart(2, nf.format(0));
    return h > 0
      ? `${nf.format(h)}:${p2(m)}:${p2(ss)}`
      : `${nf.format(m)}:${p2(ss)}`;
  };

  // ---------------------------------------------------------------
  // پیشرفت تماشا (برای کارت ادامه + نوار قسمت فعلی)
  // ---------------------------------------------------------------
  const [progress, setProgress] = useState<{
    position: number;
    duration: number | null;
  } | null>(null);

  useEffect(() => {
    if (!resumeEnabled) return;
    let cancelled = false;
    (async () => {
      let pos: number | null = null;
      let dur: number | null = durationSeconds;
      try {
        const res = await authFetch(`/api/v1/videos/${itemId}/progress`);
        const j = (await res.json()) as {
          position_seconds?: number | null;
          duration_seconds?: number | null;
        };
        if (typeof j?.position_seconds === 'number') {
          pos = j.position_seconds;
          if (typeof j.duration_seconds === 'number') dur = j.duration_seconds;
        }
      } catch {
        /* مهمان/آفلاین — از localStorage */
      }
      if (pos === null) {
        const raw = window.localStorage.getItem(`vp-progress:${itemId}`);
        const n = raw ? Number(raw) : NaN;
        if (Number.isFinite(n)) pos = n;
      }
      if (!cancelled && pos !== null) {
        setProgress({ position: pos, duration: dur });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, resumeEnabled, durationSeconds]);

  const progressPct =
    progress && progress.duration && progress.duration > 0
      ? Math.min(100, Math.round((progress.position / progress.duration) * 100))
      : null;
  const showResume =
    progress !== null &&
    progress.position >= 5 &&
    (progress.duration === null ||
      progress.duration <= 0 ||
      progress.position < progress.duration * 0.95);

  const onResume = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.dispatchEvent(new CustomEvent('maturidi:video-play'));
  };

  // ---------------------------------------------------------------
  // ذخیره (نشانک)
  // ---------------------------------------------------------------
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/api/v1/videos/${itemId}/saved`);
        const j = (await res.json()) as { saved?: boolean };
        if (!cancelled && typeof j?.saved === 'boolean') setSaved(j.saved);
      } catch {
        /* مهمان/آفلاین — ذخیره‌نشده می‌ماند */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const onToggleSave = async () => {
    if (saveBusy) return;
    if (!getAccessToken()) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = `/${locale}/login?next=${encodeURIComponent(next)}`;
      return;
    }
    const nextSaved = !saved;
    setSaved(nextSaved);
    setSaveBusy(true);
    try {
      await authFetch(`/api/v1/videos/${itemId}/saved`, {
        method: nextSaved ? 'POST' : 'DELETE',
      });
    } catch {
      setSaved(!nextSaved);
    }
    setSaveBusy(false);
  };

  // ---------------------------------------------------------------
  // اشتراک‌گذاری
  // ---------------------------------------------------------------
  const [copied, setCopied] = useState(false);
  const onShare = async () => {
    const url = window.location.href;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
      } catch {
        /* لغو کاربر */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* کلیپ‌بورد در دسترس نیست */
    }
  };

  // ---------------------------------------------------------------
  // توضیح + تب‌ها
  // ---------------------------------------------------------------
  const [expanded, setExpanded] = useState(false);
  const descLong = description.length > 140;

  const hasEpisodes = playlistItems.length > 0;
  const hasPlaylists = playlists.length > 0;
  const hasSimilar = related.length > 0;
  const [tab, setTab] = useState<TabKey>(
    hasEpisodes ? 'episodes' : hasPlaylists ? 'playlists' : 'similar',
  );

  const subtitleText = subtitleLangs
    .map((l) => SUBTITLE_AUTONYMS[l] ?? l)
    .join('، ');

  return (
    <div className="vid-below">
      {showResume && progress ? (
        <div className="vid-resume">
          <div className="vid-resume-info">
            <span className="vid-resume-title">
              {labels.resumeTitle}
              {progressPct !== null
                ? ` — ${labels.resumePercentTemplate.replace(
                    '__PCT__',
                    nf.format(progressPct),
                  )}`
                : ''}
            </span>
            <span className="vid-resume-bar">
              <span
                className="vid-resume-fill"
                style={{ width: `${progressPct ?? 0}%` }}
              />
            </span>
          </div>
          <button type="button" className="vid-resume-btn" onClick={onResume}>
            {labels.resumeFromTemplate.replace(
              '__TIME__',
              fmtTime(progress.position),
            )}
          </button>
        </div>
      ) : null}

      <h1 className="vid-watch-title">{title}</h1>

      <div className="vid-watch-meta">
        {scholarName ? (
          <span className="vid-meta-scholar">{scholarName}</span>
        ) : null}
        {dateLabel ? (
          <span>
            {labels.publishedLabel}: <b>{dateLabel}</b>
          </span>
        ) : null}
        {durationLabel ? (
          <span>
            {labels.durationLabel}: <b dir="ltr">{durationLabel}</b>
          </span>
        ) : null}
        {subtitleLangs.length > 0 ? (
          <span>
            <span className="vid-cc-badge">CC</span> {labels.subtitlesLabel}:{' '}
            <b>{subtitleText}</b>
          </span>
        ) : null}
      </div>

      {description ? (
        <div className="vid-desc-wrap">
          <p className={`vid-watch-desc${expanded ? '' : ' clamped'}`}>
            {description}
          </p>
          {descLong ? (
            <button
              type="button"
              className="vid-desc-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? labels.less : `... ${labels.more}`}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="vid-actions">
        {isExternal && externalUrl ? (
          <a
            className="vid-action primary"
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
          >
            ▶ {labels.watchOnYouTube}
          </a>
        ) : streamUrl ? (
          <a className="vid-action primary" href={streamUrl} download>
            ⤓ {labels.download}
          </a>
        ) : null}
        <button type="button" className="vid-action" onClick={onShare}>
          ↗ {copied ? labels.linkCopied : labels.share}
        </button>
        <button
          type="button"
          className={`vid-action${saved ? ' on' : ''}`}
          onClick={onToggleSave}
          disabled={saveBusy}
          aria-pressed={saved}
        >
          🔖 {saved ? labels.saved : labels.save}
        </button>
      </div>

      {tags.length > 0 ? (
        <div className="vid-tags">
          <span className="vid-tags-label">{labels.tagsLabel}</span>
          {tags.map((tag) => (
            <span key={tag} className="vid-tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {hasEpisodes || hasPlaylists || hasSimilar ? (
        <div className="vid-tabs-wrap">
          <div className="vid-tabbar" role="tablist">
            {hasEpisodes ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'episodes'}
                className={`vid-tabbtn${tab === 'episodes' ? ' on' : ''}`}
                onClick={() => setTab('episodes')}
              >
                {labels.episodesTab}
              </button>
            ) : null}
            {hasPlaylists ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'playlists'}
                className={`vid-tabbtn${tab === 'playlists' ? ' on' : ''}`}
                onClick={() => setTab('playlists')}
              >
                {labels.playlistsTab}
              </button>
            ) : null}
            {hasSimilar ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'similar'}
                className={`vid-tabbtn${tab === 'similar' ? ' on' : ''}`}
                onClick={() => setTab('similar')}
              >
                {labels.similarTab}
              </button>
            ) : null}
          </div>

          {tab === 'episodes' && hasEpisodes ? (
            <div>
              <div className="vid-ep-head">
                <h3>{playlistTitle}</h3>
                {positionLabel ? (
                  <span className="vid-ep-pos">{positionLabel}</span>
                ) : null}
              </div>
              <ol className="vid-ep-list">
                {playlistItems.map((row, i) => (
                  <EpisodeRow
                    key={row.id}
                    row={row}
                    index={i}
                    nowPlaying={labels.nowPlaying}
                    currentPct={row.current ? progressPct : null}
                    currentWatchedLabel={
                      row.current && progressPct !== null
                        ? labels.resumePercentTemplate.replace(
                            '__PCT__',
                            nf.format(progressPct),
                          )
                        : null
                    }
                    nf={nf}
                  />
                ))}
              </ol>
            </div>
          ) : null}

          {tab === 'playlists' && hasPlaylists ? (
            <ol className="vid-ep-list">
              {playlists.map((pl) => (
                <li
                  key={pl.id}
                  className={`vid-ep-row${pl.current ? ' current' : ''}`}
                >
                  <Link href={pl.href} className="vid-ep-link">
                    <span className="vid-ep-thumb">
                      {pl.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={pl.coverUrl}
                          alt=""
                          loading="lazy"
                          className="vid-thumb-img"
                        />
                      ) : (
                        <span className="vid-ep-thumb-fallback" aria-hidden="true">
                          ▶
                        </span>
                      )}
                    </span>
                    <span className="vid-ep-info">
                      <span className="vid-ep-title">{pl.title}</span>
                      <span className="vid-ep-meta">{pl.countLabel}</span>
                      {pl.current ? (
                        <span className="vid-ep-now">{labels.currentPlaylist}</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : null}

          {tab === 'similar' && hasSimilar ? (
            <ol className="vid-ep-list">
              {related.map((row) => (
                <li key={row.id} className="vid-ep-row">
                  <Link href={row.href} className="vid-ep-link">
                    <span className="vid-ep-thumb">
                      {row.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.coverUrl}
                          alt=""
                          loading="lazy"
                          className="vid-thumb-img"
                        />
                      ) : (
                        <span className="vid-ep-thumb-fallback" aria-hidden="true">
                          ▶
                        </span>
                      )}
                      {row.durationLabel ? (
                        <span className="vid-thumb-dur" dir="ltr">
                          {row.durationLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="vid-ep-info">
                      <span className="vid-ep-title">{row.title}</span>
                      {row.scholarName ? (
                        <span className="vid-ep-meta">{row.scholarName}</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EpisodeRow({
  row,
  index,
  nowPlaying,
  currentPct,
  currentWatchedLabel,
  nf,
}: {
  row: SidebarVideoRow;
  index: number;
  nowPlaying: string;
  currentPct: number | null;
  currentWatchedLabel: string | null;
  nf: Intl.NumberFormat;
}) {
  const body = (
    <>
      <span className="vid-ep-num">{nf.format(index + 1)}</span>
      <span className="vid-ep-thumb">
        {row.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.coverUrl}
            alt=""
            loading="lazy"
            className="vid-thumb-img"
          />
        ) : (
          <span className="vid-ep-thumb-fallback" aria-hidden="true">
            ▶
          </span>
        )}
        {row.durationLabel ? (
          <span className="vid-thumb-dur" dir="ltr">
            {row.durationLabel}
          </span>
        ) : null}
        {row.current && currentPct !== null ? (
          <span className="vid-ep-prog">
            <span
              className="vid-ep-prog-fill"
              style={{ width: `${currentPct}%` }}
            />
          </span>
        ) : null}
      </span>
      <span className="vid-ep-info">
        <span className="vid-ep-title">{row.title}</span>
        {row.current ? (
          <span className="vid-ep-now">
            {nowPlaying}
            {currentWatchedLabel ? ` · ${currentWatchedLabel}` : ''}
          </span>
        ) : row.scholarName ? (
          <span className="vid-ep-meta">{row.scholarName}</span>
        ) : null}
      </span>
      {row.current ? (
        <span className="vid-eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </>
  );
  if (row.current) {
    return (
      <li className="vid-ep-row current" aria-current="true">
        <span className="vid-ep-link">{body}</span>
      </li>
    );
  }
  return (
    <li className="vid-ep-row">
      <Link href={row.href} className="vid-ep-link">
        {body}
      </Link>
    </li>
  );
}
