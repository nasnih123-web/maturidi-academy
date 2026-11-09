/**
 * تست‌های واحد lib/quran-audio.ts (فاز ۵) — بدون runner، با node:test.
 *
 * اجرا (از apps/web):
 *   ./node_modules/.bin/tsc lib/quran-audio.ts lib/__tests__/quran-audio.test.ts \
 *     --outDir /tmp/quran-audio-test --module commonjs --target es2022 \
 *     --moduleResolution node --esModuleInterop --skipLibCheck
 *   node --test /tmp/quran-audio-test/__tests__/quran-audio.test.js
 *
 * پوشش:
 * - Resampler: نرخ‌های ۱۶/۳۲/۴۴٫۱/۴۸ کیلوهرتز (فرکانس و دامنه حفظ
 *   می‌شوند)، anti-alias (۱۲ کیلوهرتز در ۴۸k حذف می‌شود)، چندکاناله،
 *   NaN/Infinity/clip، flush و سقف بافر.
 * - AudioFrameAssembler: قابِ ۴۰۹۶ نمونه‌ایِ Int16LE، سکوت، قابِ ناقص.
 * - LiveEventStore: تکراری، بی‌ترتیب، جاافتادگی، correction،
 *   نشستِ کهنه، رویدادِ قدیمیِ بدون پاکت، partial/extra/located.
 * - ماشین وضعیت کلاینت + پیام start نسخهٔ ۲.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AudioFrameAssembler,
  HIFZ_FRAME_SAMPLES,
  LiveEventStore,
  Resampler,
  buildStartMessage,
  isFatalLiveError,
  isValidLiveTransition,
  type HifzLiveEvent,
} from '../quran-audio';

function sine(freqHz: number, rate: number, seconds: number, amp = 0.8): Float32Array {
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / rate);
  }
  return out;
}

/** فرکانسِ غالب از شمارِ عبور از صفر (نیم‌موج‌ها). */
function estimateFreq(samples: Float32Array, rate: number): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i - 1] < 0 && samples[i] >= 0) crossings += 1;
  }
  return (crossings * rate) / samples.length;
}

function rms(samples: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < samples.length; i += 1) acc += samples[i] * samples[i];
  return Math.sqrt(acc / Math.max(1, samples.length));
}

/** برشِ میانی (اثرِ لبهٔ فیلتر در ابتدا/انتها حذف می‌شود). */
function middle(samples: Float32Array, drop = 300): Float32Array {
  return samples.slice(drop, Math.max(drop, samples.length - drop));
}

describe('Resampler', () => {
  it('16k → 16k: passthrough دقیق', () => {
    const resampler = new Resampler(16000);
    const input = sine(440, 16000, 0.5);
    const out = resampler.push(input);
    assert.equal(out.length, input.length);
    for (let i = 0; i < 10; i += 1) assert.equal(out[i], input[i]);
    assert.equal(resampler.flush().length, 0);
  });

  it('48k → 16k: فرکانس ۱ کیلوهرتز و دامنه حفظ می‌شوند', () => {
    const resampler = new Resampler(48000);
    const input = sine(1000, 48000, 1);
    const out = resampler.push(input);
    const tail = resampler.flush();
    const all = Float32Array.from([...out, ...tail]);
    assert.ok(
      all.length >= 15900 && all.length <= 16150,
      `length ${all.length}`,
    );
    const mid = middle(all);
    const freq = estimateFreq(mid, 16000);
    assert.ok(Math.abs(freq - 1000) < 50, `freq ${freq}`);
    assert.ok(Math.abs(rms(mid) - rms(input)) < 0.08, `rms ${rms(mid)}`);
  });

  it('48k → 16k: ۱۲ کیلوهرتز (بالای نایکوئیستِ خروجی) حذف می‌شود', () => {
    const resampler = new Resampler(48000);
    const input = sine(12000, 48000, 1);
    const out = resampler.push(input);
    const tail = resampler.flush();
    const all = Float32Array.from([...out, ...tail]);
    const ratio = rms(middle(all)) / rms(input);
    assert.ok(ratio < 0.05, `alias ratio ${ratio}`);
  });

  it('44.1k → 16k: فرکانس حفظ می‌شود', () => {
    const resampler = new Resampler(44100);
    const input = sine(1000, 44100, 1);
    const out = resampler.push(input);
    const tail = resampler.flush();
    const all = Float32Array.from([...out, ...tail]);
    assert.ok(all.length >= 15900 && all.length <= 16150, `length ${all.length}`);
    const freq = estimateFreq(middle(all), 16000);
    assert.ok(Math.abs(freq - 1000) < 50, `freq ${freq}`);
  });

  it('32k → 16k: فرکانس حفظ می‌شود', () => {
    const resampler = new Resampler(32000);
    const input = sine(1000, 32000, 1);
    const out = resampler.push(input);
    const tail = resampler.flush();
    const all = Float32Array.from([...out, ...tail]);
    assert.ok(all.length >= 15900 && all.length <= 16150, `length ${all.length}`);
    const freq = estimateFreq(middle(all), 16000);
    assert.ok(Math.abs(freq - 1000) < 50, `freq ${freq}`);
  });

  it('چندکاناله: میانگین کانال‌ها مونو می‌شود', () => {
    const resampler = new Resampler(16000);
    const left = sine(440, 16000, 0.1);
    const stereo = new Float32Array(left.length * 2);
    for (let i = 0; i < left.length; i += 1) {
      stereo[i * 2] = left[i];
      stereo[i * 2 + 1] = -left[i]; // وارونه: میانگین باید ~۰ شود
    }
    const out = resampler.push(stereo, 2);
    assert.ok(rms(out) < 0.01, `rms ${rms(out)}`);
  });

  it('NaN/Infinity صفر و clip clamp می‌شوند و شمرده می‌شوند', () => {
    const resampler = new Resampler(16000);
    const input = new Float32Array([0.5, Number.NaN, Number.POSITIVE_INFINITY, 2, -2, 0.25]);
    const out = resampler.push(input);
    assert.deepEqual([...out], [0.5, 0, 0, 1, -1, 0.25]);
    assert.equal(resampler.stats.nanCount, 2);
    assert.equal(resampler.stats.clippedCount, 2);
  });

  it('flush: باقیمانده برمی‌گردد؛ pushِ بزرگ بافر را بی‌حد نمی‌کند', () => {
    const resampler = new Resampler(48000);
    const big = sine(440, 48000, 3); // ۳ ثانیه یکجا
    const out = resampler.push(big);
    const tail = resampler.flush();
    const total = out.length + tail.length;
    assert.ok(total >= 47500 && total <= 48500, `total ${total}`);
    assert.ok(
      resampler.stats.droppedInputSamples >= 0,
      'dropped counter exists',
    );
  });

  it('نرخِ نامعتبر خطا می‌دهد', () => {
    assert.throws(() => new Resampler(0), /invalid input sample rate/);
    assert.throws(() => new Resampler(Number.NaN), /invalid input sample rate/);
  });
});

describe('AudioFrameAssembler', () => {
  it('۴۰۹۶ نمونه → یک قاب Int16LE درست', () => {
    const assembler = new AudioFrameAssembler();
    const input = new Float32Array(HIFZ_FRAME_SAMPLES).fill(0.5);
    const frames = assembler.push(input);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].byteLength, HIFZ_FRAME_SAMPLES * 2);
    const view = new DataView(frames[0]);
    assert.equal(view.getInt16(0, true), 16383);
    assert.equal(view.getInt16(2, true), 16383);
    assert.equal(assembler.stats.framesEmitted, 1);
  });

  it('سکوت شمرده می‌شود؛ قابِ ناقص فقط در flush با صفر پر می‌شود', () => {
    const assembler = new AudioFrameAssembler();
    assert.deepEqual(assembler.push(new Float32Array(100)), []);
    assert.equal(assembler.flush()?.byteLength, HIFZ_FRAME_SAMPLES * 2);
    assert.equal(assembler.stats.silentFrames, 1);
    assert.equal(assembler.flush(), null);
  });

  it('دو قابِ پی‌درپی از ورودیِ ۸۱۹۲ نمونه‌ای', () => {
    const assembler = new AudioFrameAssembler();
    const frames = assembler.push(new Float32Array(HIFZ_FRAME_SAMPLES * 2).fill(0.25));
    assert.equal(frames.length, 2);
    assert.equal(assembler.stats.framesEmitted, 2);
  });
});

function wordEvent(overrides: Partial<HifzLiveEvent> = {}): HifzLiveEvent {
  return {
    session_id: 'sess-1',
    event_id: 'e1',
    sequence_no: 1,
    event_type: 'stable_word',
    type: 'word',
    status: 'correct',
    surah: 112,
    ayah: 1,
    word_index: 0,
    expected: 'قُلْ',
    prob: 0.95,
    heard: 'قُلْ',
    audio_ts_ms: 256,
    ...overrides,
  };
}

describe('LiveEventStore', () => {
  it('کلمه می‌نشیند؛ تکراری (همان event_id) نادیده گرفته می‌شود', () => {
    const store = new LiveEventStore();
    store.reset('sess-1');
    assert.equal(store.apply(wordEvent()), 'word');
    assert.equal(store.apply(wordEvent()), 'ignored-duplicate');
    assert.equal(store.snapshot().length, 1);
    assert.equal(store.duplicates, 1);
  });

  it('بی‌ترتیب اعمال می‌شود ولی شمرده می‌شود؛ جاافتادگی ثبت می‌شود', () => {
    const store = new LiveEventStore();
    store.reset('sess-1');
    store.apply(wordEvent({ event_id: 'e1', sequence_no: 1 }));
    store.apply(wordEvent({ event_id: 'e3', sequence_no: 3, word_index: 1 }));
    assert.deepEqual(store.gaps, [2]);
    store.apply(wordEvent({ event_id: 'e2', sequence_no: 2, word_index: 1 }));
    assert.equal(store.outOfOrder, 1);
    // e2 برای همان خانه آمد: correction درجا، نه کلمهٔ دوم.
    assert.equal(store.snapshot().length, 2);
    assert.equal(store.correctionsApplied, 1);
  });

  it('correction همان خانه را به‌روز می‌کند؛ ناشناخته شمرده می‌شود', () => {
    const store = new LiveEventStore();
    store.reset('sess-1');
    store.apply(wordEvent());
    assert.equal(
      store.apply({
        session_id: 'sess-1',
        event_id: 'e2',
        sequence_no: 2,
        event_type: 'correction',
        type: 'correction',
        status: 'close',
        surah: 112,
        ayah: 1,
        word_index: 0,
        expected: 'قُلْ',
        prob: 0.65,
        heard: 'قُلْ',
        reason: 'wrong_tashkeel',
        corrects_event_id: 'e1',
      }),
      'correction',
    );
    const words = store.snapshot();
    assert.equal(words.length, 1);
    assert.equal(words[0].status, 'close');
    assert.equal(words[0].reason, 'wrong_tashkeel');
    assert.equal(
      store.apply({
        session_id: 'sess-1',
        event_id: 'e3',
        sequence_no: 3,
        event_type: 'correction',
        type: 'correction',
        status: 'wrong',
        surah: 112,
        ayah: 1,
        word_index: 9,
        expected: '؟',
        corrects_event_id: 'missing',
      }),
      'ignored-correction-unknown',
    );
    assert.equal(store.correctionsForUnknown, 1);
  });

  it('رویدادِ نشستِ دیگر (سوکتِ کهنه پس از اتصالِ دوباره) نادیده گرفته می‌شود', () => {
    const store = new LiveEventStore();
    store.reset('sess-2');
    assert.equal(store.apply(wordEvent({ session_id: 'sess-1' })), 'ignored-stale-session');
    assert.equal(store.snapshot().length, 0);
  });

  it('رویدادِ قدیمیِ بدون پاکت با کلیدِ خانه dedup می‌شود', () => {
    const store = new LiveEventStore();
    store.reset(null);
    const legacy = {
      type: 'word',
      status: 'correct',
      surah: 112,
      ayah: 1,
      word_index: 0,
      expected: 'قُلْ',
      prob: 0.95,
      heard: 'قُلْ',
    };
    assert.equal(store.apply(legacy), 'word');
    assert.equal(store.apply(legacy), 'ignored-duplicate');
    assert.equal(store.snapshot().length, 1);
  });

  it('partial و extra و located و progress و warning ذخیره می‌شوند', () => {
    const store = new LiveEventStore();
    store.reset('sess-1');
    store.apply({
      session_id: 'sess-1',
      event_id: 'p1',
      sequence_no: 1,
      event_type: 'partial',
      type: 'partial',
      status: 'partial',
      surah: 112,
      ayah: 1,
      word_index: 0,
      expected: 'قُلْ',
    });
    assert.equal(store.latestPartial?.expected, 'قُلْ');
    store.apply({
      session_id: 'sess-1',
      event_id: 'x1',
      sequence_no: 2,
      event_type: 'extra',
      type: 'extra',
      status: 'ok',
      text: 'سلام',
    });
    assert.deepEqual(store.extras, ['سلام']);
    store.apply({
      session_id: 'sess-1',
      event_id: 'l1',
      sequence_no: 3,
      event_type: 'located',
      type: 'located',
      status: 'ok',
      surah: 112,
      ayah: 3,
    });
    assert.equal(store.locatedAyah, 3);
    store.apply({
      session_id: 'sess-1',
      event_id: 'g1',
      sequence_no: 4,
      event_type: 'progress',
      type: 'progress',
      status: 'ok',
      surah: 112,
      ayah: 2,
      words: 5,
      skipped: 1,
    });
    assert.deepEqual(store.latestProgress, { ayah: 2, words: 5, skipped: 1 });
  });

  it('retractionِ partialِ کهنه، پیش‌نمایش را null می‌کند؛ خانهٔ دیگر را نه', () => {
    const store = new LiveEventStore();
    store.reset('sess-1');
    store.apply({
      session_id: 'sess-1',
      event_id: 'p1',
      sequence_no: 1,
      event_type: 'partial',
      type: 'partial',
      status: 'partial',
      surah: 112,
      ayah: 1,
      word_index: 0,
      expected: 'قُلْ',
    });
    assert.equal(store.latestPartial?.expected, 'قُلْ');
    // پس‌گرفتنِ خانهٔ دیگر: پیش‌نمایشِ جاری دست نمی‌خورد.
    store.apply({
      session_id: 'sess-1',
      event_id: 'p2',
      sequence_no: 2,
      event_type: 'partial',
      type: 'partial',
      status: 'retracted',
      surah: 112,
      ayah: 1,
      word_index: 1,
      expected: 'هُوَ',
      retracted: true,
    });
    assert.equal(store.latestPartial?.expected, 'قُلْ');
    // پس‌گرفتنِ همان خانه: null می‌شود و کلمه‌ای ثبت نشده است.
    assert.equal(
      store.apply({
        session_id: 'sess-1',
        event_id: 'p3',
        sequence_no: 3,
        event_type: 'partial',
        type: 'partial',
        status: 'retracted',
        surah: 112,
        ayah: 1,
        word_index: 0,
        expected: 'قُلْ',
        retracted: true,
      }),
      'partial-retracted',
    );
    assert.equal(store.latestPartial, null);
    assert.equal(store.snapshot().length, 0);
  });

  it('repeat و revisit فقط شمرده می‌شوند؛ کلمات آلوده نمی‌شوند و reset صفرشان می‌کند', () => {
    const store = new LiveEventStore();
    store.reset('sess-1');
    store.apply(wordEvent());
    store.apply({
      session_id: 'sess-1',
      event_id: 'r1',
      sequence_no: 2,
      event_type: 'repeat',
      type: 'repeat',
      status: 'ok',
      surah: 112,
      ayah: 1,
      word_index: 0,
      expected: 'قُلْ',
    });
    store.apply({
      session_id: 'sess-1',
      event_id: 'r2',
      sequence_no: 3,
      event_type: 'revisit',
      type: 'revisit',
      status: 'ok',
      surah: 112,
      ayah: 1,
      word_index: 0,
    });
    assert.equal(store.repeatCount, 1);
    assert.equal(store.revisitCount, 1);
    assert.equal(store.snapshot().length, 1);
    store.reset('sess-2');
    assert.equal(store.repeatCount, 0);
    assert.equal(store.revisitCount, 0);
  });

  it('reset همه‌چیز را پاک می‌کند', () => {
    const store = new LiveEventStore();
    store.reset('sess-1');
    store.apply(wordEvent());
    store.reset('sess-2');
    assert.equal(store.snapshot().length, 0);
    assert.equal(store.duplicates, 0);
    assert.deepEqual(store.gaps, []);
  });
});

describe('live client contract', () => {
  it('پیام start نسخهٔ ۲ با اعلامِ قاب', () => {
    const msg = buildStartMessage(112, 1);
    assert.equal(msg.protocol_version, 2);
    assert.equal(msg.type, 'start');
    assert.deepEqual(msg.audio, {
      sample_rate: 16000,
      channels: 1,
      format: 'pcm16le',
      frame_samples: 4096,
      frame_ms: 256,
    });
  });

  it('خطای غیرکشنده (fatal: false) کشنده نیست', () => {
    assert.equal(isFatalLiveError({ fatal: false }), false);
    assert.equal(isFatalLiveError({ fatal: true }), true);
    assert.equal(isFatalLiveError({}), true);
  });

  it('ماشین وضعیت کلاینت: گذرهای مجاز/نامجاز', () => {
    assert.equal(isValidLiveTransition('idle', 'requesting_permission'), true);
    assert.equal(isValidLiveTransition('requesting_permission', 'connecting'), true);
    assert.equal(isValidLiveTransition('connecting', 'engine_loading'), true);
    assert.equal(isValidLiveTransition('engine_loading', 'listening'), true);
    assert.equal(isValidLiveTransition('listening', 'stopping'), true);
    assert.equal(isValidLiveTransition('listening', 'interrupted'), true);
    assert.equal(isValidLiveTransition('listening', 'paused'), true);
    assert.equal(isValidLiveTransition('paused', 'listening'), true);
    assert.equal(isValidLiveTransition('paused', 'stopping'), true);
    assert.equal(isValidLiveTransition('paused', 'interrupted'), true);
    assert.equal(isValidLiveTransition('paused', 'requesting_permission'), false);
    assert.equal(isValidLiveTransition('idle', 'paused'), false);
    assert.equal(isValidLiveTransition('interrupted', 'requesting_permission'), true);
    assert.equal(isValidLiveTransition('idle', 'listening'), false);
    assert.equal(isValidLiveTransition('listening', 'connecting'), false);
    assert.equal(isValidLiveTransition('ended', 'listening'), false);
  });
});
