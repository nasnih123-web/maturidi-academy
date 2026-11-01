/**
 * Quran player waveform styles — the equalizer registry.
 *
 * Style ids are stored in the CRM setting `quran.waveform_style` and
 * validated server-side (platform_settings.py) with the same ids.
 * The styles are FAMILIES inspired by the user's neon-equalizer
 * reference image (bars, dots, line, mirror, glow) — not a copy of
 * that image. Every style renders the played portion distinct from
 * the unplayed portion and respects RTL progress direction.
 *
 * Trilingual display names live in messages/{fa,ar,en}.json
 * (waveformBars / waveformDotted / waveformLine / waveformMirrored /
 * waveformNeon) and in the CRM i18n (quran.waveform*).
 */

export const WAVEFORM_STYLES = ['bars', 'dotted', 'line', 'mirrored', 'neon'] as const;

export type WaveformStyleId = (typeof WAVEFORM_STYLES)[number];

/** Default when the setting is unset or holds an unknown id. */
export const DEFAULT_WAVEFORM_STYLE: WaveformStyleId = 'bars';

/** Parse an unknown setting value into a valid style id. */
export function parseWaveformStyle(value: unknown): WaveformStyleId {
  return typeof value === 'string' && (WAVEFORM_STYLES as readonly string[]).includes(value)
    ? (value as WaveformStyleId)
    : DEFAULT_WAVEFORM_STYLE;
}
