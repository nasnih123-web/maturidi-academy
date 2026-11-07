/**
 * Regression tests for the printed-line parser (phase 6, R-03):
 * the rub el hizb ornament (۞) is NOT a word and must never shift
 * the print→provider word mapping.
 *
 * Data files are read from the repo (paths relative to this file,
 * overridable with QURAN_PRINT_LINES_JSON / TANZIL_TEXT); if either
 * file is missing the data tests skip instead of failing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  auditPrintedAyatCounts,
  parseTextLine,
} from '../quran-print-lines';
import type { MushafExactLine } from '../quran-mushaf-lines';

/** First existing candidate wins (repo root or apps/web cwd). */
function readFirst(envName: string, candidates: string[]): string | null {
  const env = process.env[envName];
  if (env) {
    try {
      return readFileSync(env, 'utf8');
    } catch {
      return null;
    }
  }
  for (const rel of candidates) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function loadJsonLines(): MushafExactLine[][] | null {
  const raw = readFirst('QURAN_PRINT_LINES_JSON', [
    'apps/web/lib/quran-mushaf-lines.json',
    'lib/quran-mushaf-lines.json',
  ]);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { pages: MushafExactLine[][] }).pages;
  } catch {
    return null;
  }
}

function loadTanzilCounts(): Map<string, number> | null {
  const raw = readFirst('TANZIL_TEXT', [
    'apps/api/app/modules/quran/data/tanzil_uthmani.txt',
    '../api/app/modules/quran/data/tanzil_uthmani.txt',
  ]);
  if (!raw) return null;
  const counts = new Map<string, number>();
  for (const line of raw.split('\n')) {
    const [s, a, text] = line.split('|');
    if (!s || !a || !text) continue;
    counts.set(
      `${Number(s)}:${Number(a)}`,
      text.split(/\s+/).filter(Boolean).length,
    );
  }
  return counts;
}

describe('parseTextLine: rub el hizb (۞)', () => {
  it('صفحهٔ ۵، سطرِ اولِ ۲:۲۶: ۞ در آفستِ ۰، نه در کلمات', (t) => {
    const pages = loadJsonLines();
    if (!pages) {
      t.skip('quran-mushaf-lines.json در دسترس نیست');
      return;
    }
    const line = pages[4].find(
      (l) => l.t === 'text' && l.v === '2:26' && (l.x ?? '').startsWith('۞'),
    );
    assert.ok(line, 'expected a printed line starting with ۞ on page 5');
    const parsed = parseTextLine(line);
    assert.ok(parsed);
    assert.equal(parsed.surah, 2);
    assert.equal(parsed.segments.length, 1);
    const seg = parsed.segments[0];
    assert.equal(seg.ayah, 26);
    assert.equal(seg.marker, null);
    assert.deepEqual(seg.ornaments, [0]);
    assert.equal(seg.words.length, 10);
    assert.ok(!seg.words.includes('۞'));
  });

  it('صفحهٔ ۷، ۲:۴۳→۲:۴۴: ۞ پیش از کلماتِ آیهٔ ۴۴، در قطعهٔ خودش', (t) => {
    const pages = loadJsonLines();
    if (!pages) {
      t.skip('quran-mushaf-lines.json در دسترس نیست');
      return;
    }
    const line = pages[6].find(
      (l) => l.t === 'text' && l.v === '2:43' && (l.x ?? '').includes('۞'),
    );
    assert.ok(line, 'expected a printed line with ۞ on page 7');
    const parsed = parseTextLine(line);
    assert.ok(parsed);
    assert.equal(parsed.segments.length, 2);
    assert.equal(parsed.segments[0].ayah, 43);
    assert.equal(parsed.segments[0].marker, '٤٣');
    assert.deepEqual(parsed.segments[0].ornaments, []);
    assert.equal(parsed.segments[1].ayah, 44);
    assert.deepEqual(parsed.segments[1].ornaments, [0]);
    assert.equal(parsed.segments[1].words.length, 3);
  });
});

describe('auditPrintedAyatCounts: ۶۰۴ صفحه', () => {
  it('هر آیه به‌جز دو اختلافِ شناخته‌شدهٔ R-16 با تنزیل برابر است؛ ۞ دقیقاً ۱۹۹ توکن', (t) => {
    const pages = loadJsonLines();
    const counts = loadTanzilCounts();
    if (!pages || !counts) {
      t.skip('فایل‌های داده در دسترس نیستند');
      return;
    }
    assert.equal(pages.length, 604);
    const audit = auditPrintedAyatCounts(pages, counts);
    assert.equal(audit.rubElHizbTokens, 199);
    // دو اختلافِ شناخته‌شدهٔ داده‌ای (R-16، خارج از فاز ۶):
    // (۵،۵۲) چاپ «دَآئِرَةٌ» را به دو توکن شکسته؛ (۱۸،۱) ۜ در
    // تنزیل توکنِ جداست و در چاپ چسبیدهٔ «عِوَجَاۜ». اگر اختلافِ
    // تازه‌ای آمد، یعنی رگرسیون (مثلاً ۞ دوباره شمرده شده).
    assert.deepEqual(audit.mismatches, [
      { surah: 5, ayah: 52, printed: 30, expected: 29 },
      { surah: 18, ayah: 1, printed: 11, expected: 12 },
    ]);
  });
});
