/**
 * تست‌های واحد تطبیق صوتی تسبیح در lib/tasbih.ts — بدون runner، با node:test.
 *
 * اجرا (از apps/web):
 *   ./node_modules/.bin/tsc lib/tasbih.ts lib/__tests__/tasbih-voice.test.ts \
 *     --outDir /tmp/tasbih-voice-test --module commonjs --target es2022 \
 *     --moduleResolution node --esModuleInterop --skipLibCheck
 *   node --test /tmp/tasbih-voice-test/__tests__/tasbih-voice.test.js
 *
 * پوشش:
 * - normalizeArabicForMatch: حذف اعراب/تطویل/الف خنجری، یکدست‌سازی
 *   خانوادهٔ الف (آ/أ/إ/ٱ)، ی فارسی ← ي عربی، ة ← ه، حذف نشانه‌گذاری.
 * - countDhikrOccurrences: شمارش ناهم‌پوشان، مسیر بدون‌فاصله برای
 *   خروجی چسبیدهٔ ASR، ذکر در میان جمله، عدم تطابق و ورودی خالی.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countDhikrOccurrences, normalizeArabicForMatch } from '../tasbih';

/** «سُبْحَانَ ٱللَّٰهِ» — دقیقاً با همان کدپوینت‌های preset (از messages/fa.json). */
const SUBHAN_VOCALIZED =
  '\u0633\u064F\u0628\u0652\u062D\u064E\u0627\u0646\u064E \u0671\u0644\u0644\u064E\u0651\u0670\u0647\u0650';
/** «ٱللَّٰهُ أَكْبَرُ» — دقیقاً با همان کدپوینت‌های preset. */
const AKBAR_VOCALIZED =
  '\u0671\u0644\u0644\u064E\u0651\u0670\u0647\u064F \u0623\u064E\u0643\u0652\u0628\u064E\u0631\u064F';

describe('normalizeArabicForMatch', () => {
  it('اعراب و الف خنجری را حذف و ٱ را به ا بدل می‌کند', () => {
    assert.equal(normalizeArabicForMatch(SUBHAN_VOCALIZED), 'سبحان الله');
  });

  it('خانوادهٔ الف را یکدست می‌کند (آ/أ/إ/ٱ ← ا)', () => {
    assert.equal(normalizeArabicForMatch('\u0622'), '\u0627'); // آ
    assert.equal(normalizeArabicForMatch('\u0623'), '\u0627'); // أ
    assert.equal(normalizeArabicForMatch('\u0625'), '\u0627'); // إ
    assert.equal(normalizeArabicForMatch('\u0671'), '\u0627'); // ٱ
  });

  it('ی فارسی را به ي عربی و ة را به ه بدل می‌کند', () => {
    assert.equal(normalizeArabicForMatch('\u06CC'), '\u064A'); // ی ← ي
    assert.equal(normalizeArabicForMatch('\u0629'), '\u0647'); // ة ← ه
  });

  it('تطویل و نشانه‌گذاری را حذف و فاصله‌ها را جمع می‌کند', () => {
    assert.equal(normalizeArabicForMatch('\u0633\u0628\u062D\u0640\u0640\u0627\u0646'), 'سبحان');
    assert.equal(normalizeArabicForMatch('  سبحان   الله،  '), 'سبحان الله');
    assert.equal(normalizeArabicForMatch(''), '');
  });
});

describe('countDhikrOccurrences', () => {
  it('ذکر اعراب‌دار در برابر متن سادهٔ ASR — سه تکرار', () => {
    assert.equal(
      countDhikrOccurrences('سبحان الله سبحان الله سبحان الله', SUBHAN_VOCALIZED),
      3,
    );
  });

  it('خروجی چسبیدهٔ ASR با مسیر بدون‌فاصله شمرده می‌شود', () => {
    assert.equal(countDhikrOccurrences('سبحان اللهسبحان الله', SUBHAN_VOCALIZED), 2);
    assert.equal(countDhikrOccurrences('سبحانالله سبحانالله', SUBHAN_VOCALIZED), 2);
  });

  it('ذکر در میان جمله درست شمرده می‌شود', () => {
    assert.equal(countDhikrOccurrences('قال سبحان الله ثم سبحان الله ومضى', SUBHAN_VOCALIZED), 2);
    assert.equal(countDhikrOccurrences('سبحان الله، سبحان الله.', SUBHAN_VOCALIZED), 2);
  });

  it('«الله أكبر» در برابر «الله اكبر» خروجی ASR', () => {
    assert.equal(countDhikrOccurrences('الله اكبر', AKBAR_VOCALIZED), 1);
  });

  it('گونه‌های ی/ي و ة/ه با هم تطبیق می‌کنند', () => {
    // ذکر با ی فارسی («یَا حَیُّ»)، متن با ي عربی («يا حي») — دو تکرار
    const dhikrFaYeh = '\u06CC\u064E\u0627 \u062D\u064E\u06CC\u064F\u0651';
    const heardArYeh = '\u064A\u0627 \u062D\u064A \u064A\u0627 \u062D\u064A';
    assert.equal(countDhikrOccurrences(heardArYeh, dhikrFaYeh), 2);
    // ذکر با ة («بَرَكَة»)، متن با ه
    assert.equal(countDhikrOccurrences('بركه بركه', '\u0628\u064E\u0631\u064E\u0643\u064E\u0629'), 2);
  });

  it('بدون تطابق صفر و شمارش ناهم‌پوشان است', () => {
    assert.equal(countDhikrOccurrences('الحمد لله رب العالمين', SUBHAN_VOCALIZED), 0);
    assert.equal(countDhikrOccurrences('الله الله الله', 'الله الله'), 1);
  });

  it('ورودی خالی صفر می‌دهد', () => {
    assert.equal(countDhikrOccurrences('', SUBHAN_VOCALIZED), 0);
    assert.equal(countDhikrOccurrences('سبحان الله', ''), 0);
    assert.equal(countDhikrOccurrences('', ''), 0);
  });
});
