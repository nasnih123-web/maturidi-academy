'use client';

/**
 * Site-wide audio player (Phase 9 mini-player).
 *
 * Thin context shell — deliberately small because it mounts in the locale
 * layout (every page's bundle). All playback logic lives in
 * lib/hooks/useAudioEngine; the MiniPlayer UI itself is code-split via
 * React.lazy and only loads once a track is active, so the homepage
 * First Load JS budget is untouched.
 */
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAudioEngine, type AudioEngineState } from './hooks/useAudioEngine';
import { reportActivity } from './activity';

export interface AudioTrack {
  id: string;
  title: string;
  coverUrl: string | null;
  scholarName: string;
  streamUrl: string;
}

export interface MiniPlayerLabels {
  nowPlaying: string;
  play: string;
  pause: string;
  close: string;
  expandAria: string;
  collapseAria: string;
  audioFailed: string;
}

interface AudioPlayerContextValue {
  track: AudioTrack | null;
  engine: AudioEngineState;
  /** Load a track (buffering only) and show the mini-player. */
  loadTrack: (track: AudioTrack) => void;
  /** Load + start playback. */
  playTrack: (track: AudioTrack) => void;
  close: () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  seekBy: (delta: number) => void;
  setRate: (rate: number) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function useAudioPlayer(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used inside AudioPlayerProvider');
  return ctx;
}

// Code-split via React.lazy + Suspense (NOT next/dynamic): next/dynamic
// with ssr:false inside a *client* component breaks the app-router client
// runtime when the chunk loads. React.lazy keeps the MiniPlayer out of the
// initial bundle — the homepage budget is untouched. MiniPlayer stays
// prop-driven (no context import) to avoid any import cycle.
const MiniPlayer = lazy(() =>
  import('@/components/MiniPlayer').then((m) => ({ default: m.MiniPlayer })),
);

export function AudioPlayerProvider({
  children,
  labels,
}: {
  children: ReactNode;
  labels: MiniPlayerLabels;
}) {
  const [track, setTrack] = useState<AudioTrack | null>(null);
  const engineApi = useAudioEngine();
  const { state, load, play, pause, toggle, seek, seekBy, setRate, unload } = engineApi;

  // Activity tracking for the CRM 360° timeline: one media_play per
  // track load, plus media_progress every ~30 s actually listened.
  const playedKeyRef = useRef<string | null>(null);
  const lastTimeRef = useRef(0);
  const accumRef = useRef(0);
  useEffect(() => {
    if (!track) {
      playedKeyRef.current = null;
      lastTimeRef.current = 0;
      accumRef.current = 0;
      return;
    }
    const key = `${track.id}|${track.streamUrl}`;
    if (state.status === 'playing' && playedKeyRef.current !== key) {
      playedKeyRef.current = key;
      lastTimeRef.current = state.currentTime;
      accumRef.current = 0;
      reportActivity('media_play', {
        title: track.title,
        refId: track.id,
        meta: { media_kind: 'audio' },
      });
      return;
    }
    if (playedKeyRef.current !== key) return;
    const delta = state.currentTime - lastTimeRef.current;
    lastTimeRef.current = state.currentTime;
    if (state.status === 'playing' && delta > 0 && delta < 3) {
      accumRef.current += delta;
      if (accumRef.current >= 30) {
        const seconds = Math.floor(accumRef.current);
        accumRef.current = 0;
        reportActivity('media_progress', {
          title: track.title,
          refId: track.id,
          meta: { media_kind: 'audio', seconds_delta: seconds },
        });
      }
    }
  }, [track, state.status, state.currentTime]);

  const loadTrack = useCallback(
    (t: AudioTrack) => {
      setTrack((prev) => {
        if (prev?.id === t.id && prev.streamUrl === t.streamUrl) return prev;
        return t;
      });
      load(t.streamUrl);
    },
    [load],
  );

  const playTrack = useCallback(
    (t: AudioTrack) => {
      loadTrack(t);
      // play after the element picks up the new src
      requestAnimationFrame(() => play());
    },
    [loadTrack, play],
  );

  const close = useCallback(() => {
    unload();
    setTrack(null);
  }, [unload]);

  const value = useMemo<AudioPlayerContextValue>(
    () => ({
      track,
      engine: state,
      loadTrack,
      playTrack,
      close,
      play,
      pause,
      toggle,
      seek,
      seekBy,
      setRate,
    }),
    [track, state, loadTrack, playTrack, close, play, pause, toggle, seek, seekBy, setRate],
  );

  return (
    <AudioPlayerContext.Provider value={value}>
      {children}
      {/* Single global audio element — never visible, never duplicated. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={engineApi.attach} preload="none" aria-hidden="true" />
      {track ? (
        <Suspense fallback={null}>
          <MiniPlayer
            track={track}
            engine={state}
            labels={labels}
            onToggle={toggle}
            onClose={close}
            onSeek={seek}
          />
        </Suspense>
      ) : null}
    </AudioPlayerContext.Provider>
  );
}
