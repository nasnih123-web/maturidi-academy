/**
 * Tests for the 8-color Tarteel tajweed palette (phase 7).
 *
 * All words are real Uthmani (Tanzil) words, copied from
 * apps/api/app/modules/quran/data/tanzil_uthmani.txt with their
 * ayah reference in the comment — no invented strings. The
 * per-character expectation reads:
 *   '.' black · 'D' madd laazim (dark red) · 'O' madd muttasil
 *   (orange-red) · 'L' madd 'aarid (light orange) · 'Y' madd
 *   tabee'i (yellow) · 'G' ghunna (green) · 'B' qalqalah (light
 *   blue) · 'd' tafkhim (dark blue) · 'g' silent (gray).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { colorizeTajweedWord, type TajweedColor } from '../quran-tajweed';

const CODE: Record<TajweedColor | 'plain', string> = {
  plain: '.',
  darkred: 'D',
  orangered: 'O',
  lightorange: 'L',
  yellow: 'Y',
  green: 'G',
  lightblue: 'B',
  darkblue: 'd',
  gray: 'g',
};

/** One letter per character of the word (marks inherit their base). */
function colors(word: string): string {
  let out = '';
  for (const seg of colorizeTajweedWord(word)) {
    out += CODE[seg.color ?? 'plain'].repeat([...seg.text].length);
  }
  return out;
}

describe('tajweed 8-color palette (documented, phase 7)', () => {
  it('ghunna is green: noon/meem with shadda', () => {
    assert.equal(colors('إِنَّ'), '..GGG'); // 2:6
    assert.equal(colors('ٱللَّهِ'), 'gg.....'); // 1:1 — first lam is shamsiyya (gray)
  });

  it('ikhfaa is NOT colored (old green was wrong)', () => {
    // 2:6 — the noon before ذ was green in the old 4-color version.
    const c = colors('ءَأَنذَرْتَهُمْ');
    assert.ok(!c.includes('G'), `ikhfaa must not be green: ${c}`);
    assert.equal(c, '.......dd......');
  });

  it('tafkhim is dark blue: heavy raa + isti\'laa letters', () => {
    assert.equal(colors('ٱلصِّرَٰطَ'), 'ggdddddLdd'); // 1:6
    assert.equal(colors('كَفَرُوا۟'), '....ddYgg'); // 2:6
  });

  it('qalqalah is light blue: sakinah ق ط ب ج د', () => {
    assert.equal(colors('قَدْ'), 'ddBB'); // qaf is tafkhim; dal is qalqalah
  });

  it('madd laazim is dark red: madd + shadda / sakinah / harfi', () => {
    assert.equal(colors('ٱلضَّآلِّينَ'), 'ggdddD...L..'); // 1:7
    assert.equal(colors('الٓمٓ'), '.DDDD'); // disjointed letters
  });

  it('madd muttasil is orange-red: madd + hamza, same word', () => {
    assert.equal(colors('سَوَآءٌ'), '....O..'); // 2:6
    assert.equal(colors('جَآءَ'), '..O..');
  });

  it("madd 'aarid is light orange: madd + one voweled letter, word-final", () => {
    assert.equal(colors('ٱلرَّحْمَـٰنِ'), 'ggddd.....L..'); // 1:1
    assert.equal(colors('ٱلرَّحِيمِ'), 'ggddd..L..'); // 1:1
  });

  it('madd tabee\'i is yellow: any other madd', () => {
    assert.equal(colors('مُوسَىٰ'), '..Y..YY'); // the waw is a madd waw too
    // قَالُوا: the alif is tabee'i (next letter is voweled, not last);
    // the waw is tabee'i too — the silent alif after it is skipped.
    assert.equal(colors('قَالُوا۟'), 'ddY..Ygg');
  });

  it('silent letters are gray: waslah, round zero, shamsiyya lam', () => {
    assert.equal(colors('ٱلْحَمْدُ'), 'g........'); // moon lam stays black
    assert.equal(colors('وَٱلشَّمْسِ'), '..gg.......'); // 91:1 — lam after prefix
    assert.equal(colors('أُو۟لَـٰٓئِكَ'), '..gg...OO....'); // silent waw + muttasil dagger alef
  });

  it('waw carrying a dagger alef is silent; the dagger alef is the madd', () => {
    assert.equal(colors('ٱلصَّلَوٰةَ'), 'ggddd..gL..'); // 2:7
  });

  it('madd silah (small waw/ya) is yellow', () => {
    assert.equal(colors('تَأْخُذُهُۥ'), '....dd....Y'); // 2:255
  });

  it('leen letters are not madd (no color)', () => {
    assert.equal(colors('عَلَيْهِمْ'), '..........');
  });
});

describe('tajweed audit over the whole Tanzil text', () => {
  it('every word colors without crashing; all 8 colors occur', () => {
    const candidates = [
      process.env.TANZIL_TEXT,
      resolve(__dirname, '../../api/app/modules/quran/data/tanzil_uthmani.txt'),
      resolve(process.cwd(), 'apps/api/app/modules/quran/data/tanzil_uthmani.txt'),
    ].filter(Boolean) as string[];
    let text: string | null = null;
    for (const c of candidates) {
      try {
        text = readFileSync(c, 'utf8');
        break;
      } catch {
        /* try next */
      }
    }
    if (text === null) {
      console.log('tanzil text not found — skipping whole-text audit');
      return;
    }
    const counts: Record<string, number> = {};
    let words = 0;
    for (const line of text.split('\n')) {
      const parts = line.split('|');
      if (parts.length < 3) continue;
      for (const w of parts[2].split(/\s+/).filter(Boolean)) {
        words += 1;
        for (const seg of colorizeTajweedWord(w)) {
          if (seg.color) counts[seg.color] = (counts[seg.color] ?? 0) + [...seg.text].length;
        }
      }
    }
    assert.ok(words > 70000, `expected >70000 words, got ${words}`);
    for (const color of [
      'darkred',
      'orangered',
      'lightorange',
      'yellow',
      'green',
      'lightblue',
      'darkblue',
      'gray',
    ] as const) {
      assert.ok((counts[color] ?? 0) > 100, `${color} must occur, got ${counts[color] ?? 0}`);
    }
    // Sanity: gray is dominated by the waslah (13,819) + round zero.
    assert.ok((counts.gray ?? 0) > 13000, `gray=${counts.gray}`);
    console.log('tajweed audit: words=%d counts=%j', words, counts);
  });
});
