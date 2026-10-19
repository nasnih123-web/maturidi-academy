'use client';

/**
 * MunajatGate — night-munajat calm theme.
 *
 * Wraps the site content. Between `startHour` and `endHour` (user-local,
 * settings-driven) the `data-munajat="on"` attribute is set on <html> and
 * the calm theme CSS takes over. A floating toggle lets the user force the
 * theme on/off; the choice persists per browser. Optional ambient audio is
 * strictly opt-in (no autoplay, ever).
 */
import { useRef, useState } from 'react';
import { useMunajat } from '@/lib/hooks/useMunajat';
import type { MunajatSettings } from '@/lib/settings';

export interface MunajatGateLabels {
  toggleOn: string;
  toggleOff: string;
  toggleAuto: string;
  toggleAria: string;
  ambientPlay: string;
  ambientPause: string;
}

export function MunajatGate({
  settings,
  labels,
  children,
}: {
  settings: MunajatSettings;
  labels: MunajatGateLabels;
  children: React.ReactNode;
}) {
  const { active, override, setManual } = useMunajat(settings);
  const [ambientPlaying, setAmbientPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cycleOverride = () => {
    setManual(override === null ? 'on' : override === 'on' ? 'off' : null);
  };

  const toggleAmbient = () => {
    const url = settings.ambientAudioUrl;
    if (!url) return;
    if (!audioRef.current) {
      const el = new Audio(url);
      el.loop = true;
      el.preload = 'none';
      audioRef.current = el;
    }
    const el = audioRef.current;
    if (ambientPlaying) {
      el.pause();
      setAmbientPlaying(false);
    } else {
      void el.play().then(() => setAmbientPlaying(true)).catch(() => setAmbientPlaying(false));
    }
  };

  const overrideLabel =
    override === 'on' ? labels.toggleOn : override === 'off' ? labels.toggleOff : labels.toggleAuto;

  return (
    <>
      {children}
      <div className={`munajat-controls${active ? ' munajat-visible' : ''}`} aria-hidden={!active}>
        <button
          type="button"
          className="munajat-toggle"
          onClick={cycleOverride}
          aria-label={labels.toggleAria}
          title={overrideLabel}
        >
          🌙 {overrideLabel}
        </button>
        {settings.ambientAudioUrl ? (
          <button
            type="button"
            className="munajat-toggle"
            onClick={toggleAmbient}
            aria-pressed={ambientPlaying}
          >
            {ambientPlaying ? labels.ambientPause : labels.ambientPlay}
          </button>
        ) : null}
      </div>
    </>
  );
}
