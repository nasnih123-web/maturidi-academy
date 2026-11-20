'use client';

/**
 * ProVideoPlayer — پلیر حرفه‌ای صفحهٔ تماشای ویدیوها (فاز ۲).
 *
 * کنترل‌های سفارشی روی <video> بومی: نوار پیشرفت طلایی با نشانگر
 * بافر، سرعت پخش و «پخش خودکار بعدی» در منوی تنظیمات (طبق سوییچ‌های
 * CRM در settings)، تصویر در تصویر، تمام‌صفحه، میانبرهای صفحه‌کلید،
 * دابل‌تپ برای جلو/عقب ۱۰ ثانیه، شمارش معکوس ویدیوی بعدی و ادامهٔ
 * تماشا (resume) — برای کاربر واردشده از endpoint پیشرفت سرور و برای
 * مهمان از localStorage. گزارش فعالیت (media_play/media_progress)
 * دقیقاً هم‌معنای LibraryVideoViewer است تا خط زمانی CRM نشکند.
 * زیرنویس عمداً این‌جا نیست — فاز ۳ ترک‌های واقعی را اضافه می‌کند.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { resolveStreamUrl } from '@/lib/library-client';
import { formatDuration } from '@/lib/library';
import { reportActivity } from '@/lib/activity';
import { authFetch, isLoggedIn } from '@/lib/auth-client';

export interface ProVideoPlayerLabels {
  play: string;
  pause: string;
  mute: string;
  unmute: string;
  volume: string;
  seek: string;
  settings: string;
  speed: string;
  autoplayNext: string;
  pip: string;
  fullscreen: string;
  exitFullscreen: string;
  loading: string;
  failed: string;
  retry: string;
  resumeFrom: string;
  nextUp: string;
  startsIn: string;
  playNow: string;
  cancel: string;
  rewind: string;
  forward: string;
}

export interface ProVideoPlayerSettings {
  playerSpeed: boolean;
  playerPip: boolean;
  autoplayNext: boolean;
  resumePlayback: boolean;
}

interface Props {
  itemId: string;
  title: string;
  /** Signed stream URL from the watch API; null → resolved client-side. */
  streamUrl: string | null;
  posterUrl: string | null;
  locale: string;
  settings: ProVideoPlayerSettings;
  nextUrl: string | null;
  nextTitle: string | null;
  labels: ProVideoPlayerLabels;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const NEXT_COUNTDOWN_SECONDS = 5;

function Icon({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} />
    </svg>
  );
}

const PATHS = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  volume:
    'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4zM15.5 9.2a4 4 0 010 5.6M18.2 6.8a7.4 7.4 0 010 10.4',
  muted: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4zM16 9.5l5 5m0-5l-5 5',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09A1.7 1.7 0 005.64 8.9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h.09A1.7 1.7 0 0011 3.09V3a2 2 0 114 0v.09c0 .68.4 1.3 1 1.55.61.26 1.32.1 1.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v.09c.26.6.87 1 1.55 1H22a2 2 0 110 4h-.09c-.68 0-1.3.4-1.51 1z',
  pip: 'M3 5.5A1.5 1.5 0 014.5 4h15A1.5 1.5 0 0121 5.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 14.5v-9zM11 11.5h7.5v4H11z',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  exitFullscreen: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  check: 'M4.5 12.5l5 5L19.5 7',
};

export function ProVideoPlayer({
  itemId,
  title,
  streamUrl,
  posterUrl,
  locale,
  settings,
  nextUrl,
  nextTitle,
  labels,
}: Props) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [autoplayOn, setAutoplayOn] = useState(settings.autoplayNext);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ripple, setRipple] = useState<{ id: number; side: 'back' | 'fwd' } | null>(null);

  const hideTimer = useRef<number | null>(null);
  const clickTimer = useRef<number | null>(null);
  const lastTap = useRef<{ t: number; side: 'l' | 'c' | 'r' } | null>(null);
  const lastSaveAt = useRef(0);
  const pendingResume = useRef<number | null>(null);
  const resumeDone = useRef(false);
  // مقادیر زنده برای handlerهای رویداد ویدیو — بدون re-attach شدن listenerها
  const autoplayOnRef = useRef(settings.autoplayNext);
  const nextUrlRef = useRef(nextUrl);

  useEffect(() => {
    autoplayOnRef.current = autoplayOn;
  }, [autoplayOn]);
  useEffect(() => {
    nextUrlRef.current = nextUrl;
  }, [nextUrl]);

  const nf = new Intl.NumberFormat(locale, { useGrouping: false });
  const pct = (v: number) =>
    duration > 0 ? Math.min(100, Math.max(0, (v / duration) * 100)) : 0;

  // ------------------------------------------------------------------
  // ذخیره/بازیابی پیشرفت (resume)
  // ------------------------------------------------------------------

  const saveProgressFor = useCallback(
    (id: string, position: number, dur: number | null) => {
      if (!settings.resumePlayback) return;
      if (!Number.isFinite(position) || position <= 0) return;
      if (isLoggedIn()) {
        void authFetch(`/api/v1/videos/${id}/progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_seconds: position,
            duration_seconds: dur != null && Number.isFinite(dur) ? dur : null,
          }),
        }).catch(() => undefined);
      } else {
        try {
          window.localStorage.setItem(`vp-progress:${id}`, String(position));
        } catch {
          /* private mode etc. — resume is best-effort */
        }
      }
    },
    [settings.resumePlayback],
  );

  const clearProgressFor = useCallback(
    (id: string) => {
      if (!settings.resumePlayback) return;
      if (isLoggedIn()) {
        void authFetch(`/api/v1/videos/${id}/progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position_seconds: 0, duration_seconds: null }),
        }).catch(() => undefined);
      } else {
        try {
          window.localStorage.removeItem(`vp-progress:${id}`);
        } catch {
          /* ignore */
        }
      }
    },
    [settings.resumePlayback],
  );

  const loadSavedPosition = useCallback(
    async (id: string): Promise<number | null> => {
      if (isLoggedIn()) {
        try {
          const res = await authFetch(`/api/v1/videos/${id}/progress`);
          if (!res.ok) return null;
          const data: unknown = await res.json();
          const pos = (data as { position_seconds?: unknown })?.position_seconds;
          return typeof pos === 'number' && Number.isFinite(pos) ? pos : null;
        } catch {
          return null;
        }
      }
      try {
        const raw = window.localStorage.getItem(`vp-progress:${id}`);
        const n = raw ? Number.parseFloat(raw) : Number.NaN;
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    },
    [],
  );

  // ------------------------------------------------------------------
  // حل URL پخش
  // ------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSrc(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setCountdown(null);
    setToast(null);
    pendingResume.current = null;
    resumeDone.current = false;
    lastSaveAt.current = 0;
    if (streamUrl) {
      setSrc(streamUrl);
      return;
    }
    resolveStreamUrl(itemId)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, streamUrl]);

  useEffect(() => {
    setPipSupported(
      typeof document !== 'undefined' && Boolean(document.pictureInPictureEnabled),
    );
  }, []);

  // ------------------------------------------------------------------
  // رویدادهای ویدیو: وضعیت، فعالیت، resume و ذخیرهٔ دوره‌ای
  // ------------------------------------------------------------------

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src) return;
    let played = false;
    let last = el.currentTime;
    let accum = 0;

    const tryApplyResume = () => {
      const pos = pendingResume.current;
      if (pos == null || resumeDone.current) return;
      const dur = el.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      resumeDone.current = true;
      if (pos > 5 && pos < dur - 10) {
        el.currentTime = pos;
        setToast(labels.resumeFrom.replace('{time}', formatDuration(pos, locale)));
        window.setTimeout(() => setToast(null), 4500);
      }
    };

    if (settings.resumePlayback) {
      void loadSavedPosition(itemId).then((pos) => {
        pendingResume.current = pos;
        tryApplyResume();
      });
    }

    const saveNow = () => {
      if (!el.ended) {
        saveProgressFor(
          itemId,
          el.currentTime,
          Number.isFinite(el.duration) ? el.duration : null,
        );
      }
    };

    const onPlay = () => {
      setPlaying(true);
      setCountdown(null);
      last = el.currentTime;
      if (!played) {
        played = true;
        reportActivity('media_play', {
          title,
          refId: itemId,
          meta: { media_kind: 'video' },
        });
      }
    };
    const onPause = () => {
      setPlaying(false);
      saveNow();
    };
    const onTime = () => {
      setCurrentTime(el.currentTime);
      const delta = el.currentTime - last;
      last = el.currentTime;
      if (!el.paused && delta > 0 && delta < 3) {
        accum += delta;
        if (accum >= 30) {
          const seconds = Math.floor(accum);
          accum = 0;
          reportActivity('media_progress', {
            title,
            refId: itemId,
            meta: { media_kind: 'video', seconds_delta: seconds },
          });
        }
      }
      if (!el.paused && Date.now() - lastSaveAt.current >= 10_000) {
        lastSaveAt.current = Date.now();
        saveNow();
      }
    };
    const onMeta = () => {
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      tryApplyResume();
    };
    const onProgress = () => {
      try {
        const b = el.buffered;
        let end = 0;
        for (let i = 0; i < b.length; i += 1) {
          if (b.start(i) <= el.currentTime && el.currentTime <= b.end(i)) {
            end = b.end(i);
            break;
          }
          end = Math.max(end, b.end(i));
        }
        setBufferedEnd(end);
      } catch {
        /* buffered may be unavailable mid-seek */
      }
    };
    const onEnded = () => {
      setPlaying(false);
      clearProgressFor(itemId);
      if (autoplayOnRef.current && nextUrlRef.current) {
        setCountdown(NEXT_COUNTDOWN_SECONDS);
      }
    };
    const onVolume = () => {
      setVolume(el.volume);
      setMuted(el.muted || el.volume === 0);
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('progress', onProgress);
    el.addEventListener('ended', onEnded);
    el.addEventListener('volumechange', onVolume);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      saveNow();
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('progress', onProgress);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('volumechange', onVolume);
      document.removeEventListener('visibilitychange', onVis);
    };
    // labels.resumeFrom/locale فقط برای toast لحظه‌ای خوانده می‌شوند؛
    // وابستگی عمداً محدود است تا با هر رندر صفحه listenerها نسازند.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, itemId, title, settings.resumePlayback, loadSavedPosition, saveProgressFor, clearProgressFor]);

  // ------------------------------------------------------------------
  // شمارش معکوس ویدیوی بعدی
  // ------------------------------------------------------------------

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      if (nextUrl) router.push(nextUrl);
      setCountdown(null);
      return;
    }
    const t = window.setTimeout(
      () => setCountdown((c) => (c === null ? null : c - 1)),
      1000,
    );
    return () => window.clearTimeout(t);
  }, [countdown, nextUrl, router]);

  // ------------------------------------------------------------------
  // تمام‌صفحه
  // ------------------------------------------------------------------

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ------------------------------------------------------------------
  // کنترل‌ها
  // ------------------------------------------------------------------

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused || el.ended) {
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, []);

  const seekBy = useCallback((delta: number) => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = Math.min(
      Math.max(0, el.currentTime + delta),
      Math.max(0, el.duration - 0.1),
    );
  }, []);

  const changeVolume = useCallback((delta: number) => {
    const el = videoRef.current;
    if (!el) return;
    const v = Math.min(1, Math.max(0, el.volume + delta));
    el.volume = v;
    el.muted = v === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (el) el.muted = !el.muted;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void wrapRef.current?.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  const togglePip = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => undefined);
    } else {
      void el.requestPictureInPicture().catch(() => undefined);
    }
  }, []);

  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2600);
  }, []);

  useEffect(
    () => () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (clickTimer.current) window.clearTimeout(clickTimer.current);
    },
    [],
  );

  const onFrameClick = (e: React.MouseEvent) => {
    const el = videoRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const side: 'l' | 'c' | 'r' =
      x < rect.width / 3 ? 'l' : x > (rect.width * 2) / 3 ? 'r' : 'c';
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < 320 && prev.side === side && side !== 'c') {
      // دابل‌تپ: جلو/عقب ۱۰ ثانیه
      if (clickTimer.current) window.clearTimeout(clickTimer.current);
      lastTap.current = null;
      seekBy(side === 'l' ? -10 : 10);
      setRipple({ id: now, side: side === 'l' ? 'back' : 'fwd' });
      window.setTimeout(() => setRipple(null), 650);
      return;
    }
    lastTap.current = { t: now, side };
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      lastTap.current = null;
      togglePlay();
    }, 260);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        seekBy(5);
        break;
      case 'ArrowLeft':
        seekBy(-5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        changeVolume(0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        changeVolume(-0.1);
        break;
      case 'f':
        toggleFullscreen();
        break;
      case 'm':
        toggleMute();
        break;
      default:
        break;
    }
  };

  const showControls = controlsVisible || !playing;
  const ringC = 2 * Math.PI * 26;

  return (
    <div
      ref={wrapRef}
      className={`vp-frame${showControls ? '' : ' vp-hide'}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={pokeControls}
      aria-label={title}
    >
      {failed ? (
        <div className="vp-status" role="alert">
          <p>{labels.failed}</p>
          <button
            type="button"
            className="vp-retry"
            onClick={() => {
              setFailed(false);
              setSrc(null);
              if (streamUrl) setSrc(streamUrl);
              else {
                resolveStreamUrl(itemId)
                  .then(setSrc)
                  .catch(() => setFailed(true));
              }
            }}
          >
            {labels.retry}
          </button>
        </div>
      ) : src ? (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            className="vp-el"
            src={src}
            poster={posterUrl ?? undefined}
            preload="metadata"
            playsInline
            aria-label={title}
            onClick={onFrameClick}
          />

          {!playing && countdown === null && (
            <button
              type="button"
              className="vp-center"
              aria-label={labels.play}
              onClick={togglePlay}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5z" fill="#e5c07b" />
              </svg>
            </button>
          )}

          {ripple && (
            <div
              key={ripple.id}
              className={`vp-ripple vp-ripple-${ripple.side}`}
              aria-hidden="true"
            >
              <span>{ripple.side === 'back' ? labels.rewind : labels.forward}</span>
            </div>
          )}

          {toast && (
            <div className="vp-toast" role="status">
              {toast}
            </div>
          )}

          {countdown !== null && nextUrl && (
            <div className="vp-next">
              <p className="vp-next-label">{labels.nextUp}</p>
              {nextTitle ? <p className="vp-next-title">{nextTitle}</p> : null}
              <div className="vp-next-ring" aria-hidden="true">
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="26" className="vp-ring-bg" />
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    className="vp-ring-fg"
                    strokeDasharray={ringC}
                    strokeDashoffset={ringC * (1 - countdown / NEXT_COUNTDOWN_SECONDS)}
                  />
                </svg>
                <span>{nf.format(countdown)}</span>
              </div>
              <p className="vp-next-in">
                {labels.startsIn.replace('{seconds}', nf.format(countdown))}
              </p>
              <div className="vp-next-actions">
                <button
                  type="button"
                  className="vp-next-btn"
                  onClick={() => setCountdown(null)}
                >
                  {labels.cancel}
                </button>
                <button
                  type="button"
                  className="vp-next-btn vp-next-btn-gold"
                  onClick={() => {
                    setCountdown(null);
                    router.push(nextUrl);
                  }}
                >
                  {labels.playNow}
                </button>
              </div>
            </div>
          )}

          <div className="vp-controls">
            <div className="vp-seek" dir="ltr">
              <div className="vp-seek-track" />
              <div
                className="vp-seek-buffered"
                style={{ width: `${pct(bufferedEnd)}%` }}
              />
              <div
                className="vp-seek-played"
                style={{ width: `${pct(currentTime)}%` }}
              />
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                aria-label={labels.seek}
                onChange={(e) => {
                  const el = videoRef.current;
                  const v = Number(e.target.value);
                  if (el) el.currentTime = v;
                  setCurrentTime(v);
                }}
              />
            </div>
            <div className="vp-row">
              <button
                type="button"
                className="vp-btn"
                aria-label={playing ? labels.pause : labels.play}
                onMouseDown={(e) => e.preventDefault()}
                onClick={togglePlay}
              >
                <Icon d={playing ? PATHS.pause : PATHS.play} filled />
              </button>
              <div className="vp-vol">
                <button
                  type="button"
                  className="vp-btn"
                  aria-label={muted ? labels.unmute : labels.mute}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggleMute}
                >
                  <Icon d={muted ? PATHS.muted : PATHS.volume} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  aria-label={labels.volume}
                  dir="ltr"
                  onChange={(e) => {
                    const el = videoRef.current;
                    const v = Number(e.target.value);
                    if (el) {
                      el.volume = v;
                      el.muted = v === 0;
                    }
                  }}
                />
              </div>
              <span className="vp-time" dir="ltr">
                {formatDuration(currentTime, locale)} / {formatDuration(duration, locale)}
              </span>
              <span className="vp-spacer" />
              <div className="vp-menu-wrap">
                <button
                  type="button"
                  className="vp-btn"
                  aria-label={labels.settings}
                  aria-expanded={menuOpen}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <Icon d={PATHS.gear} />
                </button>
                {menuOpen && (
                  <>
                    <div
                      className="vp-menu-backdrop"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="vp-menu" role="menu">
                      {settings.playerSpeed && (
                        <>
                          <p className="vp-menu-head">{labels.speed}</p>
                          {SPEEDS.map((s) => (
                            <button
                              key={s}
                              type="button"
                              role="menuitemradio"
                              aria-checked={s === rate}
                              className={`vp-mi${s === rate ? ' vp-on' : ''}`}
                              onClick={() => {
                                const el = videoRef.current;
                                if (el) el.playbackRate = s;
                                setRate(s);
                                setMenuOpen(false);
                              }}
                            >
                              <span dir="ltr">
                                {nf.format(s)}×
                              </span>
                              {s === rate ? <Icon d={PATHS.check} /> : null}
                            </button>
                          ))}
                        </>
                      )}
                      {settings.playerSpeed && nextUrl ? (
                        <div className="vp-menu-sep" />
                      ) : null}
                      {nextUrl && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={autoplayOn}
                          className="vp-mi vp-mi-switch"
                          onClick={() => setAutoplayOn((v) => !v)}
                        >
                          <span>{labels.autoplayNext}</span>
                          <span
                            className={`vp-switch${autoplayOn ? ' vp-on' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
              {settings.playerPip && pipSupported && (
                <button
                  type="button"
                  className="vp-btn"
                  aria-label={labels.pip}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={togglePip}
                >
                  <Icon d={PATHS.pip} />
                </button>
              )}
              <button
                type="button"
                className="vp-btn"
                aria-label={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleFullscreen}
              >
                <Icon d={isFullscreen ? PATHS.exitFullscreen : PATHS.fullscreen} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="vp-status" role="status">
          {labels.loading}
        </p>
      )}
    </div>
  );
}
