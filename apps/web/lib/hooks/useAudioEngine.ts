'use client';

/**
 * useAudioEngine — a small playback state machine driving ONE
 * HTMLAudioElement owned by the caller (the site-wide audio provider).
 *
 * All timing/position truth comes from the element itself; the hook never
 * fabricates playback state. Keyboard-accessible controls are the caller's
 * job (real <button>s + a range input).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type AudioStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface AudioEngineState {
  status: AudioStatus;
  currentTime: number;
  duration: number;
  rate: number;
  error: string | null;
  /** Currently loaded source URL (signed stream URL), if any. */
  src: string | null;
}

const INITIAL: AudioEngineState = {
  status: 'idle',
  currentTime: 0,
  duration: 0,
  rate: 1,
  error: null,
  src: null,
};

export interface UseAudioEngine {
  state: AudioEngineState;
  /** Ref callback to attach to the single <audio> element. */
  attach: (el: HTMLAudioElement | null) => void;
  load: (src: string) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  seekBy: (deltaSeconds: number) => void;
  setRate: (rate: number) => void;
  unload: () => void;
}

export function useAudioEngine(): UseAudioEngine {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<AudioEngineState>(INITIAL);

  const patch = useCallback((p: Partial<AudioEngineState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  /**
   * Ref callback for the single <audio> element. Detaches listeners from
   * any previous element, then binds to the new one. Safe under React 18
   * (no reliance on ref-cleanup return values).
   */
  const attach = useCallback(
    (el: HTMLAudioElement | null) => {
      detachRef.current?.();
      detachRef.current = null;
      elRef.current = el;
      if (!el) return;
      const onTime = () => patch({ currentTime: el.currentTime });
      const onDur = () => patch({ duration: Number.isFinite(el.duration) ? el.duration : 0 });
      const onPlay = () => patch({ status: 'playing', error: null });
      const onPause = () => patch({ status: el.ended ? 'ended' : 'paused' });
      const onEnded = () => patch({ status: 'ended' });
      const onWaiting = () => patch({ status: 'loading' });
      const onPlaying = () => patch({ status: 'playing' });
      const onRate = () => patch({ rate: el.playbackRate });
      const onError = () => patch({ status: 'error', error: 'playback-error' });
      el.addEventListener('timeupdate', onTime);
      el.addEventListener('durationchange', onDur);
      el.addEventListener('loadedmetadata', onDur);
      el.addEventListener('play', onPlay);
      el.addEventListener('pause', onPause);
      el.addEventListener('ended', onEnded);
      el.addEventListener('waiting', onWaiting);
      el.addEventListener('playing', onPlaying);
      el.addEventListener('ratechange', onRate);
      el.addEventListener('error', onError);
      detachRef.current = () => {
        el.removeEventListener('timeupdate', onTime);
        el.removeEventListener('durationchange', onDur);
        el.removeEventListener('loadedmetadata', onDur);
        el.removeEventListener('play', onPlay);
        el.removeEventListener('pause', onPause);
        el.removeEventListener('ended', onEnded);
        el.removeEventListener('waiting', onWaiting);
        el.removeEventListener('playing', onPlaying);
        el.removeEventListener('ratechange', onRate);
        el.removeEventListener('error', onError);
      };
    },
    [patch],
  );

  const load = useCallback(
    (src: string) => {
      const el = elRef.current;
      setState((s) => (s.src === src ? s : { ...INITIAL, rate: s.rate, src, status: 'loading' }));
      if (el && el.src !== src) {
        el.src = src;
        el.load();
      }
    },
    [],
  );

  const play = useCallback(() => {
    const el = elRef.current;
    if (!el || !el.src) return;
    void el.play().catch(() => patch({ status: 'error', error: 'playback-error' }));
  }, [patch]);

  const pause = useCallback(() => {
    elRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const el = elRef.current;
    if (!el || !el.src) return;
    if (el.paused) void el.play().catch(() => patch({ status: 'error', error: 'playback-error' }));
    else el.pause();
  }, [patch]);

  const seek = useCallback(
    (seconds: number) => {
      const el = elRef.current;
      if (!el || !Number.isFinite(seconds)) return;
      const dur = Number.isFinite(el.duration) ? el.duration : Infinity;
      el.currentTime = Math.min(Math.max(0, seconds), dur);
      patch({ currentTime: el.currentTime });
    },
    [patch],
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const el = elRef.current;
      if (!el) return;
      seek(el.currentTime + deltaSeconds);
    },
    [seek],
  );

  const setRate = useCallback(
    (rate: number) => {
      if (!Number.isFinite(rate) || rate <= 0) return;
      const el = elRef.current;
      if (el) el.playbackRate = rate;
      patch({ rate });
    },
    [patch],
  );

  const unload = useCallback(() => {
    const el = elRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    setState((s) => ({ ...INITIAL, rate: s.rate }));
  }, []);

  // Detach listeners on unmount.
  useEffect(() => {
    return () => {
      detachRef.current?.();
      detachRef.current = null;
      elRef.current = null;
    };
  }, []);

  return { state, attach, load, play, pause, toggle, seek, seekBy, setRate, unload };
}
