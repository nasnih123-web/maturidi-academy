import React from "react";

/**
 * Interactive UI sounds (synthesized via WebAudio — no audio files) and the
 * persisted sound toggle. Ported from the turbo CRM visual system.
 * Pure utility logic; pages opt in explicitly.
 */

let audioCtx: AudioContext | null = null;

export function playChime(enabled: boolean): void {
  if (!enabled) return;
  try {
    audioCtx = audioCtx ?? new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.09);
    g.gain.setValueAtTime(0.06, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.24);
  } catch {
    // Audio unavailable — stay silent.
  }
}

const STORAGE_KEY = "crm-sound";

export function useSoundToggle(): { sound: boolean; toggle: () => void } {
  const [sound, setSound] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggle = React.useCallback(() => {
    setSound((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      playChime(next);
      return next;
    });
  }, []);

  return { sound, toggle };
}

/** Plays a chime when the newest feed event changes (opt-in per page).
 *  Reads the toggle from localStorage at event time so the sidebar toggle
 *  and the pages stay in sync without shared React state. */
export function useEventChime<T extends { event_id: string }>(events: T[]): void {
  const firstId = events.length > 0 ? events[0].event_id : null;
  const prevRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (firstId && prevRef.current && firstId !== prevRef.current) {
      let enabled = false;
      try {
        enabled = localStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        enabled = false;
      }
      playChime(enabled);
    }
    prevRef.current = firstId;
  }, [firstId]);
}
