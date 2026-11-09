/**
 * Tests for the Phase 4 hifz helpers (apps/web/lib/hifz-phase4.ts):
 * accuracy-pill colour from the Phase 2 video evidence, practice
 * range validation, repeat clamping, stored-settings parsing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HIFZ_SETTINGS_DEFAULTS,
  SURAH_AYAH_COUNTS,
  accuracyPillClass,
  accuracyPillTone,
  clampRepeatCount,
  normalizeNumericInput,
  parseNumericInput,
  parseStoredHifzSettings,
  surahAyahCount,
  toEasternArabicDigitsText,
  validatePracticeRange,
} from '../hifz-phase4';

describe('accuracyPillTone (Phase 2 video evidence, §5.2)', () => {
  it('is green at the observed green values (100, 99.2)', () => {
    assert.equal(accuracyPillTone(100), 'green');
    assert.equal(accuracyPillTone(99.2), 'green');
  });

  it('is lime at the observed lime values (98.6, 98.2, 98)', () => {
    assert.equal(accuracyPillTone(98.6), 'lime');
    assert.equal(accuracyPillTone(98.2), 'lime');
    assert.equal(accuracyPillTone(98), 'lime');
  });

  it('is amber at the observed amber values (96.9, 96.5)', () => {
    assert.equal(accuracyPillTone(96.9), 'amber');
    assert.equal(accuracyPillTone(96.5), 'amber');
  });

  it('is red at the observed red values (92.2, 88.3) — the old >=80 amber guess is refuted', () => {
    assert.equal(accuracyPillTone(92.2), 'red');
    assert.equal(accuracyPillTone(88.3), 'red');
    assert.equal(accuracyPillTone(80), 'red');
  });

  it('maps tones to pill classes', () => {
    assert.equal(accuracyPillClass('lime'), 'hifz-pill-lime');
    assert.equal(accuracyPillClass('red'), 'hifz-pill-red');
  });
});

describe('validatePracticeRange', () => {
  it('accepts a full surah (nulls) and a valid range', () => {
    assert.equal(validatePracticeRange(null, null, 7), null);
    assert.equal(validatePracticeRange(1, 7, 7), null);
    assert.equal(validatePracticeRange(2, 5, 7), null);
    assert.equal(validatePracticeRange(3, null, 7), null);
  });

  it('rejects out-of-range bounds and a reversed range', () => {
    assert.equal(validatePracticeRange(0, null, 7), 'rangeStart');
    assert.equal(validatePracticeRange(8, null, 7), 'rangeStart');
    assert.equal(validatePracticeRange(null, 8, 7), 'rangeEnd');
    assert.equal(validatePracticeRange(5, 2, 7), 'rangeOrder');
  });
});

describe('clampRepeatCount', () => {
  it('clamps to 1–20 and defaults non-finite input to 1', () => {
    assert.equal(clampRepeatCount(3), 3);
    assert.equal(clampRepeatCount(0), 1);
    assert.equal(clampRepeatCount(99), 20);
    assert.equal(clampRepeatCount(Number.NaN), 1);
  });
});

describe('parseStoredHifzSettings', () => {
  it('returns defaults for null/corrupt input and keeps known booleans', () => {
    assert.deepEqual(parseStoredHifzSettings(null), HIFZ_SETTINGS_DEFAULTS);
    assert.deepEqual(parseStoredHifzSettings('not json'), HIFZ_SETTINGS_DEFAULTS);
    const parsed = parseStoredHifzSettings(
      JSON.stringify({ freezeOnError: true, hideAyahMarkers: true, bogus: 1 }),
    );
    assert.equal(parsed.freezeOnError, true);
    assert.equal(parsed.hideAyahMarkers, true);
    assert.equal(parsed.mistakeDetection, true);
    assert.equal(parsed.resumableSessions, false);
  });
});

describe('SURAH_AYAH_COUNTS / surahAyahCount (numeric-input max)', () => {
  it('covers 114 surahs, totals 6236, spot counts match the standard', () => {
    assert.equal(SURAH_AYAH_COUNTS.length, 114);
    assert.equal(
      SURAH_AYAH_COUNTS.reduce((a, b) => a + b, 0),
      6236,
    );
    assert.equal(surahAyahCount(1), 7);
    assert.equal(surahAyahCount(2), 286);
    assert.equal(surahAyahCount(5), 120);
    assert.equal(surahAyahCount(9), 129);
    assert.equal(surahAyahCount(112), 4);
    assert.equal(surahAyahCount(114), 6);
  });

  it('returns null for out-of-range surahs', () => {
    assert.equal(surahAyahCount(0), null);
    assert.equal(surahAyahCount(115), null);
    assert.equal(surahAyahCount(1.5), null);
  });
});

describe('Eastern-Arabic numeric input conversion', () => {
  it('converts Persian and Arabic-Indic digits to Latin', () => {
    assert.equal(normalizeNumericInput('۱۲۳'), '123');
    assert.equal(normalizeNumericInput('١٢٣'), '123');
    assert.equal(normalizeNumericInput('123'), '123');
    assert.equal(normalizeNumericInput('۱٢3'), '123');
  });

  it('drops separators and non-digits, keeps empty empty', () => {
    assert.equal(normalizeNumericInput('۱۲٬۳۴۵'), '12345');
    assert.equal(normalizeNumericInput('١٢٫٣'), '123');
    assert.equal(normalizeNumericInput('12a3'), '123');
    assert.equal(normalizeNumericInput(''), '');
    assert.equal(normalizeNumericInput('abc'), '');
  });

  it('parses all three digit scripts, null when empty or digitless', () => {
    assert.equal(parseNumericInput('۱۲۳'), 123);
    assert.equal(parseNumericInput('١٢٣'), 123);
    assert.equal(parseNumericInput('123'), 123);
    assert.equal(parseNumericInput(''), null);
    assert.equal(parseNumericInput('abc'), null);
    assert.equal(parseNumericInput('۰'), 0);
  });

  it('displays Latin digits as Eastern Arabic', () => {
    assert.equal(toEasternArabicDigitsText('123'), '١٢٣');
    assert.equal(toEasternArabicDigitsText('0'), '٠');
    assert.equal(toEasternArabicDigitsText(''), '');
    assert.equal(toEasternArabicDigitsText('12/75'), '١٢/٧٥');
  });
});
