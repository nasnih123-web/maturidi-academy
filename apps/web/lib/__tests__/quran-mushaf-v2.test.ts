/**
 * Data tests for the real V2 mushaf (phase 3, hifz redesign):
 * the 604-page, 15-line QPC V2 layout rendered with Tanzil words.
 *
 * Data files are read from the repo (paths relative to the repo
 * root, overridable with QURAN_MUSHAF_V2_JSON / TANZIL_TEXT /
 * QURAN_BOUNDARIES_JSON); if a file is missing the data tests skip
 * instead of failing — same pattern as quran-print-lines.test.ts.
 *
 * What is checked:
 * - 604 pages, 15 lines each (pages 1-2 have 8), headers 1..114 in
 *   order, 112 Basmalah lines (surahs 1 and 9 have none);
 * - word-id continuity: every QUL id 1..83668 exactly once, in
 *   order, across pages (f/l of text lines + segment q values);
 * - per-ayah word counts against Tanzil (pauses/sajda/Basmalah
 *   tokens excluded exactly as the generator does);
 * - the 37:130 merge (two Tanzil tokens share one QUL id);
 * - 199 rub el hizb ayahs and 15 sajda words;
 * - page juz/hizb against rangeContaining (last ayah of the page);
 * - strict expansion of pages 1, 2, 604 and a mid page, plus the
 *   R-16 regressions (5:52 = 29 words, 18:1 = 11 words + ۜ).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  expandV2Page,
  v2PageIndexFor,
  type V2MushafData,
  type V2Page,
} from '../quran-mushaf-v2';
import { rangeContaining, type QuranBoundaries } from '../quran-view-modes';

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

function loadV2(): V2MushafData | null {
  const raw = readFirst('QURAN_MUSHAF_V2_JSON', [
    'apps/web/public/quran-mushaf-v2.json',
    'public/quran-mushaf-v2.json',
  ]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as V2MushafData;
  } catch {
    return null;
  }
}

function loadTanzilTokens(): Map<string, readonly string[]> | null {
  const raw = readFirst('TANZIL_TEXT', [
    'apps/api/app/modules/quran/data/tanzil_uthmani.txt',
    '../api/app/modules/quran/data/tanzil_uthmani.txt',
  ]);
  if (!raw) return null;
  const tokens = new Map<string, readonly string[]>();
  for (const line of raw.split('\n')) {
    const [s, a, text] = line.split('|');
    if (!s || !a || !text) continue;
    tokens.set(`${Number(s)}:${Number(a)}`, text.split(/\s+/).filter(Boolean));
  }
  return tokens;
}

function loadBoundaries(): QuranBoundaries | null {
  const raw = readFirst('QURAN_BOUNDARIES_JSON', [
    'apps/web/lib/quran-boundaries.json',
    'lib/quran-boundaries.json',
  ]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QuranBoundaries;
  } catch {
    return null;
  }
}

const PAUSE_SIGNS = new Set(['ۚ', 'ۖ', 'ۗ', 'ۙ', 'ۘ', 'ۛ', 'ۜ']);

/** Tanzil tokens minus standalone pause/sajda marks and minus the
    Basmalah prefix (4 tokens) of ayah 1 in surahs 2..114 except 9. */
function expectedRealWords(
  tokens: Map<string, readonly string[]>,
  ref: string,
): number {
  const toks = tokens.get(ref) ?? [];
  let n = 0;
  for (const tok of toks) {
    if (PAUSE_SIGNS.has(tok) || tok === '۩') continue;
    n += 1;
  }
  const [s, a] = ref.split(':').map(Number);
  if (a === 1 && s !== 1 && s !== 9) n -= 4;
  return n;
}

describe('quran-mushaf-v2: structure (۶۰۴ صفحه)', () => {
  it('۶۰۴ صفحه؛ صفحه‌های ۱ و ۲ هشت‌خطه، بقیه ۱۵خطه', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    assert.equal(data.pages.length, 604);
    assert.equal(data.version, 1);
    data.pages.forEach((page, i) => {
      assert.equal(page.n, i + 1, `page number at index ${i}`);
      assert.equal(
        page.lines.length,
        i < 2 ? 8 : 15,
        `line count on page ${page.n}`,
      );
    });
  });

  it('۱۱۴ سربرگ به‌ترتیب ۱ تا ۱۱۴؛ ۱۱۲ بسمله (سوره‌های ۱ و ۹ ندارند)', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    const headers: number[] = [];
    let basmalas = 0;
    for (const page of data.pages) {
      for (const line of page.lines) {
        if (line.t === 'h') headers.push(line.s);
        if (line.t === 'b') basmalas += 1;
      }
    }
    assert.equal(headers.length, 114);
    assert.deepEqual(headers, Array.from({ length: 114 }, (_, i) => i + 1));
    assert.equal(basmalas, 112);
    // Surah 9 starts without a Basmalah line; surah 1 has none.
    const p9 = data.pages[v2PageIndexFor(data.pages, 9, 1) ?? -1];
    assert.ok(p9);
    assert.equal(
      p9.lines.filter((l) => l.t === 'b').length,
      0,
      'surah 9 has no basmala line',
    );
  });

  it('هر خط متنی f/l دارد؛ ۳۰ خط وسط‌چین؛ ۵۷۳ خط با نشانِ پیش‌رو', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    let centered = 0;
    let lead = 0;
    for (const page of data.pages) {
      for (const line of page.lines) {
        if (line.t !== 'x') continue;
        assert.ok(line.f >= 1 && line.l >= line.f, `f/l on page ${page.n}`);
        assert.ok(line.seg.length > 0, `segments on page ${page.n}`);
        if (line.c === 1) centered += 1;
        if (line.lead) lead += 1;
      }
    }
    assert.equal(centered, 30);
    assert.equal(lead, 573);
  });
});

describe('quran-mushaf-v2: word-id continuity (۱ تا ۸۳٬۶۶۸)', () => {
  it('هر شناسه دقیقاً یک بار، به‌ترتیب، بدون گپ یا هم‌پوشانی', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    let expectedNext = 1;
    for (const page of data.pages) {
      for (const line of page.lines) {
        if (line.t !== 'x') continue;
        assert.equal(line.f, expectedNext, `first id on page ${page.n}`);
        // Segments + ayah-end tokens reconstruct f..l exactly, with
        // two documented exceptions: a `lead` line spends its first
        // id (f) on the ayah-end number carried from the previous
        // line, and the 37:130 merge spends one id for two words
        // (إِلْ يَاسِينَ is one printed word).
        let q = line.f + (line.lead ? 1 : 0);
        for (const seg of line.seg) {
          assert.equal(seg.q, q, `segment q on page ${page.n}`);
          const distinct = seg.s === 37 && seg.a === 130 ? seg.n - 1 : seg.n;
          q += distinct + (seg.e === 1 ? 1 : 0);
        }
        assert.equal(q, line.l + 1, `last id on page ${page.n}`);
        expectedNext = line.l + 1;
      }
    }
    assert.equal(expectedNext, 83669, 'last id is 83668');
  });
});

describe('quran-mushaf-v2: per-ayah word counts vs Tanzil', () => {
  it('شمار هر آیه با تنزیل می‌خواند (با حذف نشانه‌های وقف/سجده/بسمله)', (t) => {
    const data = loadV2();
    const tokens = loadTanzilTokens();
    if (!data || !tokens) {
      t.skip('quran-mushaf-v2.json یا tanzil_uthmani.txt در دسترس نیست');
      return;
    }
    const counts = new Map<string, number>();
    for (const page of data.pages) {
      for (const line of page.lines) {
        if (line.t !== 'x') continue;
        for (const seg of line.seg) {
          const ref = `${seg.s}:${seg.a}`;
          counts.set(ref, (counts.get(ref) ?? 0) + seg.n);
        }
      }
    }
    assert.equal(counts.size, 6236, 'all 6236 ayahs covered');
    const mismatches: string[] = [];
    for (const [ref, n] of counts) {
      const expected = expectedRealWords(tokens, ref);
      if (n !== expected) mismatches.push(`${ref}: layout ${n} vs tanzil ${expected}`);
    }
    assert.deepEqual(mismatches, []);
  });

  it('ادغام ۳۷:۱۳۰: دو توکن تنزیل یک شناسهٔ QUL مشترک دارند', (t) => {
    const data = loadV2();
    const tokens = loadTanzilTokens();
    if (!data || !tokens) {
      t.skip('quran-mushaf-v2.json یا tanzil_uthmani.txt در دسترس نیست');
      return;
    }
    const pIdx = v2PageIndexFor(data.pages, 37, 130);
    assert.notEqual(pIdx, null);
    const page = data.pages[pIdx as number];
    const expansion = expandV2Page(data, page, tokens);
    assert.equal(expansion.ok, true, expansion.problems.join('; '));
    const words = expansion.lines
      .filter((l) => l.kind === 'text')
      .flatMap((l) => (l.kind === 'text' ? l.words : []))
      .filter((w) => w.surah === 37 && w.ayah === 130);
    assert.equal(words.length, 4, '37:130 has 4 Tanzil tokens');
    assert.equal(words[2].text, 'إِلْ');
    assert.equal(words[3].text, 'يَاسِينَ');
    assert.equal(words[2].qulId, words[3].qulId, 'merged words share one QUL id');
    assert.notEqual(words[1].qulId, words[2].qulId);
  });
});

describe('quran-mushaf-v2: rub el hizb (۞) and sajda (۩)', () => {
  it('۱۹۹ آیهٔ ۞ و ۱۵ کلمهٔ سجده', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    assert.equal(data.rubAyahs.length, 199);
    assert.ok(data.rubAyahs.includes('2:26'));
    assert.equal(data.sajdaWords.length, 15);
    assert.ok(data.sajdaWords.includes('7:206:10'));
    assert.ok(data.sajdaWords.includes('96:19:4'));
  });
});

describe('quran-mushaf-v2: page juz/hizb', () => {
  it('جزء/حزب هر صفحه با rangeContaining (آخرین آیهٔ صفحه) می‌خواند', (t) => {
    const data = loadV2();
    const boundaries = loadBoundaries();
    if (!data || !boundaries) {
      t.skip('quran-mushaf-v2.json یا quran-boundaries.json در دسترس نیست');
      return;
    }
    const mismatches: string[] = [];
    for (const page of data.pages) {
      let last: { s: number; a: number } | null = null;
      for (const line of page.lines) {
        if (line.t !== 'x') continue;
        for (const seg of line.seg) last = { s: seg.s, a: seg.a };
      }
      if (!last) continue;
      const { juz, hizb } = rangeContaining(boundaries, last.s, last.a);
      if (juz !== page.juz || hizb !== page.hizb) {
        mismatches.push(`page ${page.n}: stored ${page.juz}/${page.hizb} vs ${juz}/${hizb}`);
      }
    }
    assert.deepEqual(mismatches, []);
  });
});

describe('quran-mushaf-v2: expansion spot checks', () => {
  function expandPage(t: { skip: (msg: string) => void }, n: number): V2Page | null {
    const data = loadV2();
    const tokens = loadTanzilTokens();
    if (!data || !tokens) {
      t.skip('quran-mushaf-v2.json یا tanzil_uthmani.txt در دسترس نیست');
      return null;
    }
    const page = data.pages[n - 1];
    const expansion = expandV2Page(data, page, tokens);
    assert.equal(expansion.ok, true, `page ${n}: ${expansion.problems.join('; ')}`);
    return page;
  }

  it('صفحهٔ ۱: بسمله آیهٔ ۱ است؛ صفحهٔ ۲: سورهٔ ۲ از صفحهٔ ۲ شروع می‌شود', (t) => {
    const data = loadV2();
    const tokens = loadTanzilTokens();
    if (!data || !tokens) {
      t.skip('quran-mushaf-v2.json یا tanzil_uthmani.txt در دسترس نیست');
      return;
    }
    const p1 = expandV2Page(data, data.pages[0], tokens);
    assert.equal(p1.ok, true);
    const first = p1.lines.find((l) => l.kind === 'text');
    assert.ok(first && first.kind === 'text');
    assert.equal(first.words[0].text, 'بِسْمِ');
    assert.equal(first.words[0].key, '1:1:0');
    assert.equal(v2PageIndexFor(data.pages, 2, 1), 1, 'surah 2 starts on printed page 2');
    assert.equal(v2PageIndexFor(data.pages, 114, 1), 603, 'surah 114 starts on page 604');
  });

  it('صفحهٔ ۶۰۴ گسترش می‌یابد؛ آخرین کلمه شناسهٔ ۸۳٬۶۶۷ و عددِ آیه ۸۳٬۶۶۸ است', (t) => {
    const page = expandPage(t, 604);
    if (!page) return;
    const data = loadV2() as V2MushafData;
    const tokens = loadTanzilTokens() as Map<string, readonly string[]>;
    const expansion = expandV2Page(data, page, tokens);
    const lastLine = [...expansion.lines].reverse().find((l) => l.kind === 'text');
    assert.ok(lastLine && lastLine.kind === 'text');
    const lastWord = lastLine.words[lastLine.words.length - 1];
    // 83668 is the final ayah-end NUMBER token, not a word: the
    // last real word (114:6, third word) carries 83667.
    assert.equal(lastWord.qulId, 83667);
    assert.equal(lastWord.endsAyah, true);
    const rawLast = page.lines.filter((l) => l.t === 'x').at(-1);
    assert.equal(rawLast?.l, 83668);
  });

  it('صفحهٔ ۱۲۰ همان صفحهٔ V2 برای ۵:۷۷ است (نه ۱۲۱ِ QPC1)', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    assert.equal(v2PageIndexFor(data.pages, 5, 77), 119);
  });

  it('R-16 رفع شده: ۵:۵۲ دقیقاً ۲۸ کلمه + ۚ؛ ۱۸:۱ دقیقاً ۱۱ کلمه + ۜ', (t) => {
    const data = loadV2();
    const tokens = loadTanzilTokens();
    if (!data || !tokens) {
      t.skip('quran-mushaf-v2.json یا tanzil_uthmani.txt در دسترس نیست');
      return;
    }
    const p117 = expandV2Page(data, data.pages[116], tokens);
    assert.equal(p117.ok, true, p117.problems.join('; '));
    const w52 = p117.lines
      .filter((l) => l.kind === 'text')
      .flatMap((l) => (l.kind === 'text' ? l.words : []))
      .filter((w) => w.surah === 5 && w.ayah === 52);
    // Tanzil 5:52 has 29 whitespace tokens: 28 real words + one
    // standalone ۚ. The old QPC1 file split دَآئِرَةٌ in two (30);
    // V2 has 28 real words, with ۚ as a pause sign after word 11.
    assert.equal(w52.length, 28, '5:52 has 28 real words in V2');
    assert.equal(w52[11].text, 'دَآئِرَةٌ');
    assert.equal(w52[11].pauseAfter, 'ۚ', 'ۚ follows دَآئِرَةٌ in 5:52');
    const p293 = expandV2Page(data, data.pages[292], tokens);
    assert.equal(p293.ok, true, p293.problems.join('; '));
    const w181 = p293.lines
      .filter((l) => l.kind === 'text')
      .flatMap((l) => (l.kind === 'text' ? l.words : []))
      .filter((w) => w.surah === 18 && w.ayah === 1);
    assert.equal(w181.length, 11, '18:1 has 11 words in V2');
    assert.equal(w181[10].pauseAfter, 'ۜ', 'ۜ follows the last word of 18:1');
  });

  it('خطِ دارای نشانِ پیش‌رو (lead) روی صفحهٔ ۷: روزتِ ۲:۴۵ در ابتدای خط', (t) => {
    const data = loadV2();
    const tokens = loadTanzilTokens();
    if (!data || !tokens) {
      t.skip('quran-mushaf-v2.json یا tanzil_uthmani.txt در دسترس نیست');
      return;
    }
    const p7 = expandV2Page(data, data.pages[6], tokens);
    assert.equal(p7.ok, true, p7.problems.join('; '));
    const leadLines = p7.lines.filter((l) => l.kind === 'text' && l.leadAyah !== null);
    assert.equal(leadLines.length, 1);
    assert.equal(leadLines[0].kind === 'text' ? leadLines[0].leadAyah : null, 45);
  });
});

// --- Phase 8 (consolidated pass) ---------------------------------------
// Gaps the earlier phases did not cover as tests: surah start/end
// pages, surah-change pages, Basmalah pages, long ayahs on one page,
// rub/sajda word positions, and strict expansion of surah-change pages.

describe('quran-mushaf-v2 (phase 8): surah start/end pages', () => {
  it('شروع هر سوره روی صفحهٔ سربرگ خودش است؛ پایان هر سوره صفحهٔ قبل از سربرگ بعدی است', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    // Header page per surah, from the 'h' lines themselves.
    const headerPage = new Map<number, number>();
    for (const page of data.pages) {
      for (const line of page.lines) {
        if (line.t === 'h') headerPage.set(line.s, page.n);
      }
    }
    assert.equal(headerPage.size, 114);
    // Spot checks fixed by the phase-3 audit against the glyphs DB.
    assert.deepEqual(
      [1, 2, 3, 4, 5, 36, 114].map((s) => headerPage.get(s)),
      [1, 2, 50, 76, 106, 440, 604],
    );
    // Every surah's first segment is on its header page — except the
    // 18 "spill" pages where the header is the last line and the
    // Basmalah + first words start on the next page (see the
    // Basmalah test below). So the first segment is on the header
    // page or the page after it, never anywhere else.
    for (let s = 1; s <= 114; s++) {
      const first = v2PageIndexFor(data.pages, s, 1);
      const header = headerPage.get(s) as number;
      assert.ok(
        first === header - 1 || first === header,
        `surah ${s} starts on its header page ${header} or the next (got index ${first})`,
      );
      if (first === header) {
        // Spill case: the header must be the last line of its page.
        const hp: V2Page = data.pages[header - 1];
        assert.equal(
          hp.lines[hp.lines.length - 1].t,
          'h',
          `surah ${s} spills only when its header is the last line of page ${header}`,
        );
      }
    }
    // End pages: last segment of surah s is before next header.
    const lastSegPage = new Map<number, number>();
    for (const page of data.pages) {
      for (const line of page.lines) {
        if (line.t !== 'x') continue;
        for (const seg of line.seg) lastSegPage.set(seg.s, page.n);
      }
    }
    for (let s = 1; s < 114; s++) {
      assert.ok(
        (lastSegPage.get(s) as number) <= (headerPage.get(s + 1) as number),
        `surah ${s} ends on or before surah ${s + 1} header page (equal when the next header is the last line of the same page)`,
      );
      assert.ok(
        (lastSegPage.get(s) as number) >= (headerPage.get(s) as number),
        `surah ${s} ends on/after its own header page`,
      );
    }
    assert.equal(lastSegPage.get(114), 604, 'surah 114 ends on page 604');
  });

  it('۷۲ صفحه تغییر سوره در میانهٔ صفحه‌اند؛ صفحهٔ ۷۶ و ۲۹۳ از آن جمله‌اند', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    const mid: number[] = [];
    for (const page of data.pages) {
      if (page.lines.some((l, i) => l.t === 'h' && i > 0)) mid.push(page.n);
    }
    assert.equal(mid.length, 72);
    assert.ok(mid.includes(76), 'page 76: surah 4 starts mid-page');
    assert.ok(mid.includes(293), 'page 293: surah 18 starts mid-page');
    assert.ok(mid.includes(106), 'page 106: surah 5 starts mid-page');
  });
});

describe('quran-mushaf-v2 (phase 8): basmalah pages and long ayahs', () => {
  it('۱۱۲ خط بسمله روی ۹۶ صفحه‌اند؛ صفحه‌های چندبسمله‌ای دقیقاً صفحه‌های چندسربرگی‌اند', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    // Basmalah-per-page distribution, measured from the data itself:
    // 84 pages x1, 8 pages x2, 4 pages x3 (juz 30: 601-604 hold three
    // short surahs each). Every multi-Basmalah page is exactly a
    // multi-header page (one Basmalah per surah that starts on it).
    const multiBasmalaPages: number[] = [];
    const multiHeaderPages: number[] = [];
    const spillPages: number[] = [];
    let pages = 0;
    for (const page of data.pages) {
      const b = page.lines.filter((l) => l.t === 'b').length;
      const h = page.lines.filter((l) => l.t === 'h').length;
      if (b > 0) pages += 1;
      if (b >= 2) multiBasmalaPages.push(page.n);
      if (h >= 2) multiHeaderPages.push(page.n);
      assert.ok(b <= 3, `page ${page.n} has at most 3 basmala lines`);
      // A Basmalah line normally follows its surah header on the same
      // page — except when the header is the LAST line of the page:
      // then the Basmalah spills to the next page (18 pages).
      if (h === 1 && b === 0 && page.n !== 1 && page.n !== 187) {
        spillPages.push(page.n);
        assert.ok(
          page.lines[page.lines.length - 1].t === 'h',
          `page ${page.n}: spilled header is the last line`,
        );
      }
    }
    assert.equal(pages, 96);
    assert.deepEqual(multiBasmalaPages, multiHeaderPages);
    assert.equal(multiBasmalaPages.length, 12);
    assert.deepEqual(multiBasmalaPages.slice(0, 4), [587, 591, 595, 596]);
    assert.deepEqual(multiBasmalaPages.slice(-4), [601, 602, 603, 604]);
    assert.deepEqual(spillPages, [
      76, 207, 331, 341, 349, 366, 376, 414, 417, 445, 452, 498, 506, 525,
      548, 555, 557, 584,
    ]);
    // Surah 9 (no Basmalah) starts on page 187: it has a header and no 'b'.
    const p187 = data.pages[186];
    assert.ok(p187.lines.some((l) => l.t === 'h' && l.s === 9));
    assert.equal(p187.lines.filter((l) => l.t === 'b').length, 0);
  });

  it('آیه‌های بلند روی یک صفحه‌اند: ۲:۲۸۲ (۱۲۸ کلمه) صفحهٔ ۴۸؛ ۲:۲۵۵ (۵۰ کلمه) صفحهٔ ۴۲', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    for (const [s, a, pageNo, words] of [
      [2, 282, 48, 128],
      [2, 255, 42, 50],
    ] as const) {
      const pages = new Set<number>();
      let n = 0;
      for (const page of data.pages) {
        for (const line of page.lines) {
          if (line.t !== 'x') continue;
          for (const seg of line.seg) {
            if (seg.s === s && seg.a === a) {
              pages.add(page.n);
              n += seg.n;
            }
          }
        }
      }
      assert.deepEqual([...pages], [pageNo], `${s}:${a} is on one page`);
      assert.equal(n, words, `${s}:${a} word count`);
    }
  });
});

describe('quran-mushaf-v2 (phase 8): special signs positions', () => {
  it('هر آیهٔ ۞ با کلمهٔ ۱ شروع می‌شود؛ هر کلمهٔ سجده دقیقاً در قطعه‌ها هست', (t) => {
    const data = loadV2();
    if (!data) {
      t.skip('quran-mushaf-v2.json در دسترس نیست');
      return;
    }
    // First segment word index per ayah.
    const firstWord = new Map<string, number>();
    const segWords = new Set<string>();
    for (const page of data.pages) {
      for (const line of page.lines) {
        if (line.t !== 'x') continue;
        for (const seg of line.seg) {
          const ref = `${seg.s}:${seg.a}`;
          if (!firstWord.has(ref)) firstWord.set(ref, seg.w);
          for (let w = seg.w; w < seg.w + seg.n; w++) segWords.add(`${ref}:${w}`);
        }
      }
    }
    for (const ref of data.rubAyahs) {
      assert.equal(firstWord.get(ref), 0, `rub ayah ${ref} starts at word 0`);
    }
    for (const ref of data.sajdaWords) {
      assert.ok(segWords.has(ref), `sajda word ${ref} exists in segments`);
    }
  });

  it('گسترش strict صفحه‌های تغییر سوره: ۷۶ (شروع نساء) و ۲۹۳ (سجدهٔ ۱۷:۱۰۹ + شروع کهف)', (t) => {
    const data = loadV2();
    const tokens = loadTanzilTokens();
    if (!data || !tokens) {
      t.skip('quran-mushaf-v2.json یا tanzil_uthmani.txt در دسترس نیست');
      return;
    }
    for (const n of [76, 293]) {
      const exp = expandV2Page(data, data.pages[n - 1], tokens);
      assert.equal(exp.ok, true, `page ${n}: ${exp.problems.join('; ')}`);
    }
    const p293 = expandV2Page(data, data.pages[292], tokens);
    const words293 = p293.lines
      .filter((l) => l.kind === 'text')
      .flatMap((l) => (l.kind === 'text' ? l.words : []));
    const sajda = words293.find((w) => w.key === '17:109:4');
    assert.ok(sajda, '17:109 word 4 is on page 293');
    assert.equal(sajda?.text, 'خُشُوعًا');
    const kahf = words293.filter((w) => w.surah === 18);
    assert.ok(kahf.length > 0, 'surah 18 words are on page 293');
  });
});
