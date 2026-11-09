/**
 * quran-audio.ts — مسیر صوت زندهٔ حفاظ (فاز ۵: برابری با ترتیل).
 *
 * این فایل فقط منطقِ خالص است (بدون DOM): وب‌کامپوننت آن را به
 * AudioWorklet / ScriptProcessor و WebSocket وصل می‌کند.
 *
 * چرا این فایل هست (R-01): مرورگرها نرخِ درخواستیِ ۱۶ کیلوهرتز را
 * تضمین نمی‌کنند — گوشی معمولاً ۴۸ کیلوهرتز می‌دهد. پیش از این،
 * قاب‌ها با همان نرخِ واقعی فرستاده می‌شدند و سرور آن‌ها را ۱۶
 * کیلوهرتز فرض می‌کرد (صوت با سرعت ۳ برابر به مدل می‌رسید، بی‌هیچ
 * خطایی). حالا:
 * - نرخِ واقعیِ سخت‌افزار (`AudioContext.sampleRate`) خوانده می‌شود؛
 * - `Resampler` با فیلترِ anti-alias (windowed-sinc) واقعاً به
 *   ۱۶ کیلوهرتزِ مونو resample می‌کند — نه با تغییرِ metadata؛
 * - قاب‌ها همیشه ۴۰۹۶ نمونه (۲۵۶ میلی‌ثانیه) Int16LE تک‌کاناله‌اند؛
 * - NaN/Infinity، clip، سکوت، قابِ ناقص و payloadِ بیش‌ازحد
 *   اعتبارسنجی و شمرده می‌شوند؛ بافرها سقف دارند (بدون رشدِ بی‌حد).
 *
 * قرارداد WebSocket نسخهٔ ۲ هم این‌جاست: `LiveEventStore` رویدادها
 * را با `event_id`/`sequence_no` dedup و مرتب می‌کند و `correction`
 * را روی همان خانه اعمال می‌کند (نه الحاق کورکورانه).
 */

export const HIFZ_TARGET_SAMPLE_RATE = 16000;
export const HIFZ_FRAME_SAMPLES = 4096;
export const HIFZ_FRAME_MS = 256;
export const HIFZ_WS_PROTOCOL_VERSION = 2;

/** بزرگ‌ترین ورودیِ نگه‌داشته‌شده در resampler: ۱ ثانیه صوت. */
export const MAX_RESAMPLER_BUFFERED_SAMPLES = 48000;

// ---------------------------------------------------------------------------
// Resampler — windowed-sinc با فیلتر anti-alias
// ---------------------------------------------------------------------------

export interface ResamplerStats {
  inputSamples: number;
  outputSamples: number;
  /** NaN/Infinity که با ۰ جایگزین شدند. */
  nanCount: number;
  /** نمونه‌های |x| > 1 که clamp شدند. */
  clippedCount: number;
  /** نمونه‌های ورودیِ دورریخته‌شده پس از پر شدن بافر (۱ ثانیه). */
  droppedInputSamples: number;
}

/** نیمه‌پهنای فیلتر (نمونهٔ ورودی در هر سو) — ۱۲۹ tap. */
const RESAMPLE_HALF = 64;
/** وضوح جدول sinc: ۲۵۶ نقطه در هر نمونه. */
const RESAMPLE_TABLE_OVERSAMPLE = 256;

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function blackman(u: number): number {
  // پنجرهٔ Blackman روی [-1, 1]: در ۰ برابر ۱، در ±۱ برابر ۰.
  return 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
}

export class Resampler {
  readonly inputRate: number;
  readonly outputRate: number = HIFZ_TARGET_SAMPLE_RATE;
  readonly stats: ResamplerStats = {
    inputSamples: 0,
    outputSamples: 0,
    nanCount: 0,
    clippedCount: 0,
    droppedInputSamples: 0,
  };

  private readonly ratio: number;
  private readonly passthrough: boolean;
  /** جدول فیلتر: h(t) برای t در [-HALF, HALF] با وضوح ۱/۲۵۶ نمونه. */
  private readonly table: Float32Array;
  private readonly tableCenter: number;
  /** نمونه‌های ورودیِ هنوز مصرف‌نشده (مونو، اعتبارسنجی‌شده). */
  private input: number[] = [];
  /** موضعِ نمونهٔ خروجیِ بعدی، بر حسب نمونهٔ ورودی (اعشاری). */
  private position = 0;
  /** شمار نمونه‌های ورودیِ مصرف‌شده (برای جابه‌جایی بافر). */
  private consumed = 0;

  constructor(inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate <= 0) {
      throw new Error(`invalid input sample rate: ${inputRate}`);
    }
    this.inputRate = inputRate;
    this.ratio = inputRate / HIFZ_TARGET_SAMPLE_RATE;
    this.passthrough = inputRate === HIFZ_TARGET_SAMPLE_RATE;
    // فرکانس قطع: کمترین نایکوئیستِ دو سو (خروجی/ورودی).
    const fc = Math.min(0.5, HIFZ_TARGET_SAMPLE_RATE / (2 * inputRate));
    const size = RESAMPLE_HALF * 2 * RESAMPLE_TABLE_OVERSAMPLE + 1;
    const table = new Float32Array(size);
    this.tableCenter = RESAMPLE_HALF * RESAMPLE_TABLE_OVERSAMPLE;
    for (let i = 0; i < size; i += 1) {
      const t = (i - this.tableCenter) / RESAMPLE_TABLE_OVERSAMPLE;
      table[i] = 2 * fc * sinc(2 * fc * t) * blackman(t / RESAMPLE_HALF);
    }
    // بهرهٔ DC را ۱ کن: مجموعِ h روی جابه‌جایی‌های صحیح باید ۱ شود.
    let dc = 0;
    for (let k = -RESAMPLE_HALF; k <= RESAMPLE_HALF; k += 1) {
      dc += table[this.tableCenter + k * RESAMPLE_TABLE_OVERSAMPLE];
    }
    if (dc !== 0) {
      for (let i = 0; i < size; i += 1) table[i] /= dc;
    }
    this.table = table;
  }

  /** ورودیِ مونو یا چندکانالهٔ درهم‌تنیده (میانگین کانال‌ها = مونو). */
  push(samples: Float32Array, channelCount = 1): Float32Array {
    if (channelCount < 1 || !Number.isInteger(channelCount)) {
      throw new Error(`invalid channel count: ${channelCount}`);
    }
    const frames = Math.floor(samples.length / channelCount);
    for (let f = 0; f < frames; f += 1) {
      let value = 0;
      for (let c = 0; c < channelCount; c += 1) {
        let s = samples[f * channelCount + c];
        if (!Number.isFinite(s)) {
          this.stats.nanCount += 1;
          s = 0;
        } else if (s > 1) {
          this.stats.clippedCount += 1;
          s = 1;
        } else if (s < -1) {
          this.stats.clippedCount += 1;
          s = -1;
        }
        value += s;
      }
      this.input.push(value / channelCount);
    }
    this.stats.inputSamples += frames;
    this.enforceBounds();
    return this.drain(false);
  }

  /** خروجیِ مانده را با zero-padding بگیر و resampler را تهی کن. */
  flush(): Float32Array {
    const out = this.drain(true);
    this.input = [];
    this.position = 0;
    this.consumed = 0;
    return out;
  }

  private enforceBounds(): void {
    // بافرِ ورودی هرگز بیش از ۱ ثانیه نمی‌ماند: فقط نمونه‌هایی دور
    // ریخته می‌شوند که فیلتر دیگر به آن‌ها نیاز ندارد (پیش از
    // موضعِ جاری منهای HALF)؛ بقیه می‌مانند تا drain آن‌ها را
    // جابه‌جا کند (نه رشدِ بی‌حد، نه قفل).
    if (this.input.length <= MAX_RESAMPLER_BUFFERED_SAMPLES) return;
    const droppable = Math.max(
      0,
      Math.floor(this.position) - RESAMPLE_HALF - this.consumed,
    );
    const drop = Math.min(
      this.input.length - MAX_RESAMPLER_BUFFERED_SAMPLES,
      droppable,
    );
    if (drop > 0) {
      this.input.splice(0, drop);
      this.consumed += drop;
      this.stats.droppedInputSamples += drop;
    }
  }

  private drain(final: boolean): Float32Array {
    const out: number[] = [];
    // input فقط نمونه‌های از `consumed` به بعد را دارد؛ پس شمارِ
    // در دسترس، همان طولِ آرایه است.
    const available = this.input.length;
    if (this.passthrough) {
      // نرخ یکی است: بدون فیلتر، فقط نمونه‌ها را جلو ببر.
      for (let i = 0; i < available; i += 1) {
        out.push(this.input[i]);
      }
      this.consumed += available;
      this.position += available;
      this.input = [];
    } else {
      // خروجیِ بعدی زمانی آماده است که HALF نمونهٔ جلوتر هم رسیده
      // باشد (فیلترِ نامتقارن نیست)؛ در flush، صفر فرض می‌شود.
      while (true) {
        const p = this.position;
        const need = Math.floor(p) + RESAMPLE_HALF + 1 - this.consumed;
        if (!final && need > available) break;
        if (final && p >= this.consumed + available + RESAMPLE_HALF) break;
        out.push(this.sampleAt(p));
        this.position += this.ratio;
      }
    }
    // بافر را جابه‌جا کن: فقط HALF نمونهٔ پیش از موضعِ جاری می‌ماند.
    // `consumed` و `position` مطلق‌اند (بر حسب نمونهٔ ورودیِ کل)؛
    // پس از splice، input[0] همان نمونهٔ `consumed` است.
    const keepFrom = Math.max(0, Math.floor(this.position) - RESAMPLE_HALF);
    if (keepFrom > this.consumed) {
      this.input.splice(0, keepFrom - this.consumed);
      this.consumed = keepFrom;
    }
    this.stats.outputSamples += out.length;
    return Float32Array.from(out);
  }

  private sampleAt(p: number): number {
    let acc = 0;
    const j0 = Math.ceil(p - RESAMPLE_HALF);
    const j1 = Math.floor(p + RESAMPLE_HALF);
    for (let j = j0; j <= j1; j += 1) {
      // j مطلق است؛ input[j - consumed] نمونهٔ همان موضع است و
      // بیرونِ بازه، صفر (zero-padding) فرض می‌شود.
      const x =
        j >= this.consumed && j < this.input.length + this.consumed
          ? this.input[j - this.consumed]
          : 0;
      const t = p - j;
      const ti = Math.round(t * RESAMPLE_TABLE_OVERSAMPLE) + this.tableCenter;
      if (ti >= 0 && ti < this.table.length) acc += x * this.table[ti];
    }
    return acc;
  }
}

// ---------------------------------------------------------------------------
// AudioFrameAssembler — ۴۰۹۶ نمونهٔ ۱۶ کیلوهرتز → قاب Int16LE
// ---------------------------------------------------------------------------

export interface FrameAssemblerStats {
  framesEmitted: number;
  silentFrames: number;
  /** نمونه‌های دورریخته‌شده چون قاب، ناقصِ انتهایی بود (فقط در flush صفر). */
  droppedSamples: number;
}

export class AudioFrameAssembler {
  readonly stats: FrameAssemblerStats = {
    framesEmitted: 0,
    silentFrames: 0,
    droppedSamples: 0,
  };

  private pending: number[] = [];

  /** نمونه‌های ۱۶ کیلوهرتز را بده؛ قاب‌های کاملِ Int16LE را بگیر. */
  push(samples: Float32Array): ArrayBuffer[] {
    for (let i = 0; i < samples.length; i += 1) this.pending.push(samples[i]);
    const frames: ArrayBuffer[] = [];
    while (this.pending.length >= HIFZ_FRAME_SAMPLES) {
      frames.push(this.takeFrame());
    }
    return frames;
  }

  /** قابِ ناقصِ انتهایی را با صفر پر کن (پایان جریان)؛ خالی → null. */
  flush(): ArrayBuffer | null {
    if (this.pending.length === 0) return null;
    while (this.pending.length < HIFZ_FRAME_SAMPLES) this.pending.push(0);
    return this.takeFrame();
  }

  private takeFrame(): ArrayBuffer {
    const buf = new ArrayBuffer(HIFZ_FRAME_SAMPLES * 2);
    const view = new DataView(buf);
    let silent = true;
    for (let i = 0; i < HIFZ_FRAME_SAMPLES; i += 1) {
      const raw = this.pending[i];
      const s = Math.max(-1, Math.min(1, raw));
      if (Math.abs(s) > 0.0001) silent = false;
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    this.pending.splice(0, HIFZ_FRAME_SAMPLES);
    this.stats.framesEmitted += 1;
    if (silent) this.stats.silentFrames += 1;
    return buf;
  }
}

// ---------------------------------------------------------------------------
// قرارداد WebSocket نسخهٔ ۲ — سمت کلاینت
// ---------------------------------------------------------------------------

export interface HifzLiveEvent {
  session_id?: string;
  event_id?: string;
  sequence_no?: number;
  event_type?: string;
  type?: string;
  status?: string;
  surah?: number;
  ayah?: number;
  word_index?: number;
  expected?: string;
  heard?: string | null;
  prob?: number;
  confidence?: number;
  reason?: string;
  audio_ts_ms?: number;
  corrects_event_id?: string;
  /** Retraction of a provisional preview (partial only): the preview
      word at this slot is withdrawn; the committed cursor never
      moves. */
  retracted?: boolean;
  text?: string;
  message?: string;
  code?: string;
  fatal?: boolean;
  dropped?: number;
  words?: number;
  skipped?: number;
  [key: string]: unknown;
}

export interface LiveWordEvent {
  type: 'word';
  surah: number;
  ayah: number;
  word_index: number;
  expected: string;
  status: 'correct' | 'close' | 'wrong' | 'skipped';
  prob: number;
  heard: string | null;
  /** پاکت نسخهٔ ۲ (برای کلاینت قدیمی/رویدادِ بدون پاکت، غایب است). */
  event_id?: string;
  sequence_no?: number;
  event_type?: string;
  confidence?: number;
  reason?: string;
  audio_ts_ms?: number;
}

export type LiveWordStatus = LiveWordEvent['status'];

export function buildStartMessage(
  surah: number,
  ayah: number,
): Record<string, unknown> {
  return {
    type: 'start',
    surah,
    ayah,
    protocol_version: HIFZ_WS_PROTOCOL_VERSION,
    audio: {
      sample_rate: HIFZ_TARGET_SAMPLE_RATE,
      channels: 1,
      format: 'pcm16le',
      frame_samples: HIFZ_FRAME_SAMPLES,
      frame_ms: HIFZ_FRAME_MS,
    },
  };
}

/** خطای رویدادِ سرور، کشنده است یا فقط هشدار (غیرکشنده)؟ */
export function isFatalLiveError(event: HifzLiveEvent): boolean {
  return event.fatal !== false;
}

/**
 * انبارِ رویدادهای زنده: dedup + ordering + correction.
 *
 * - تکراری (همان `event_id`) نادیده گرفته می‌شود؛
 * - بی‌ترتیب (sequence_no کوچک‌تر از موردانتظار) اعمال می‌شود ولی
 *   شمرده می‌شود؛ جاافتادگیِ sequence_no ثبت می‌شود (سرور هرگز
 *   replay نمی‌کند — جاافتاده، جاافتاده می‌ماند و فقط گزارش می‌شود)؛
 * - کلمهٔ دوباره‌رسیده برای همان خانه، جایگزینِ همان خانه می‌شود
 *   (correction)؛
 * - رویدادِ `correction` با `corrects_event_id` (یا خانه‌اش) همان
 *   کلمه را به‌روز می‌کند؛
 * - رویدادِ نشستِ دیگر (session_id متفاوت — مثلاً سوکتِ کهنه پس از
 *   اتصالِ دوباره) نادیده گرفته می‌شود؛
 * - رویدادِ قدیمیِ بدون پاکت (نسخهٔ ۱) با کلیدِ خانه dedup می‌شود.
 */
export interface LivePartial {
  surah: number;
  ayah: number;
  word_index: number;
  expected: string;
}

export class LiveEventStore {
  sessionId: string | null = null;
  duplicates = 0;
  outOfOrder = 0;
  gaps: number[] = [];
  correctionsApplied = 0;
  correctionsForUnknown = 0;
  extras: string[] = [];
  locatedAyah: number | null = null;
  latestPartial: LivePartial | null = null;
  latestProgress: { ayah: number; words: number; skipped: number } | null = null;
  warnings: HifzLiveEvent[] = [];
  /** Repeat / revisit markers (phase 6): counts only, they never
      touch the word slots. */
  repeatCount = 0;
  revisitCount = 0;

  private words: LiveWordEvent[] = [];
  private bySlot = new Map<string, LiveWordEvent>();
  private byEventId = new Map<string, LiveWordEvent>();
  private seenEventIds = new Set<string>();
  private seenLegacySlots = new Set<string>();
  private expectedSeq: number | null = null;

  reset(sessionId: string | null): void {
    this.sessionId = sessionId;
    this.words = [];
    this.bySlot.clear();
    this.byEventId.clear();
    this.seenEventIds.clear();
    this.seenLegacySlots.clear();
    this.expectedSeq = null;
    this.duplicates = 0;
    this.outOfOrder = 0;
    this.gaps = [];
    this.correctionsApplied = 0;
    this.correctionsForUnknown = 0;
    this.extras = [];
    this.locatedAyah = null;
    this.latestPartial = null;
    this.latestProgress = null;
    this.warnings = [];
    this.repeatCount = 0;
    this.revisitCount = 0;
  }

  snapshot(): LiveWordEvent[] {
    return [...this.words];
  }

  apply(event: HifzLiveEvent): string {
    if (
      event.session_id !== undefined &&
      this.sessionId !== null &&
      event.session_id !== this.sessionId
    ) {
      return 'ignored-stale-session';
    }
    if (event.event_id !== undefined) {
      if (this.seenEventIds.has(event.event_id)) {
        this.duplicates += 1;
        return 'ignored-duplicate';
      }
      this.seenEventIds.add(event.event_id);
    }
    if (typeof event.sequence_no === 'number') {
      const seq = event.sequence_no;
      if (this.expectedSeq === null) {
        this.expectedSeq = seq + 1;
      } else if (seq < this.expectedSeq) {
        this.outOfOrder += 1;
      } else if (seq > this.expectedSeq) {
        for (let missing = this.expectedSeq; missing < seq; missing += 1) {
          this.gaps.push(missing);
        }
        this.expectedSeq = seq + 1;
      } else {
        this.expectedSeq = seq + 1;
      }
    }
    const eventType = event.event_type ?? event.type ?? '';
    switch (eventType) {
      case 'stable_word':
      case 'final_word':
      case 'wrong':
      case 'skipped':
      case 'word':
        return this.applyWord(event);
      case 'correction':
        return this.applyCorrection(event);
      case 'partial':
        if (
          typeof event.surah === 'number' &&
          typeof event.ayah === 'number' &&
          typeof event.word_index === 'number' &&
          typeof event.expected === 'string'
        ) {
          if (event.retracted === true) {
            // پس‌گرفتنِ پیش‌نمایشِ کهنه: فقط اگر همان خانه هنوز
            // پیش‌نمایشِ جاری است، آن را null کن.
            const cur = this.latestPartial;
            if (
              cur &&
              cur.surah === event.surah &&
              cur.ayah === event.ayah &&
              cur.word_index === event.word_index
            ) {
              this.latestPartial = null;
            }
            return 'partial-retracted';
          }
          this.latestPartial = {
            surah: event.surah,
            ayah: event.ayah,
            word_index: event.word_index,
            expected: event.expected,
          };
        }
        return 'partial';
      case 'repeat':
        this.repeatCount += 1;
        return 'repeat';
      case 'revisit':
        this.revisitCount += 1;
        return 'revisit';
      case 'extra':
        if (typeof event.text === 'string' && event.text) {
          this.extras.push(event.text);
        }
        return 'extra';
      case 'located':
        if (typeof event.ayah === 'number') this.locatedAyah = event.ayah;
        return 'located';
      case 'progress':
        if (
          typeof event.ayah === 'number' &&
          typeof event.words === 'number' &&
          typeof event.skipped === 'number'
        ) {
          this.latestProgress = {
            ayah: event.ayah,
            words: event.words,
            skipped: event.skipped,
          };
        }
        return 'progress';
      case 'warning':
        this.warnings.push(event);
        return 'warning';
      default:
        return eventType || 'other';
    }
  }

  private applyWord(event: HifzLiveEvent): string {
    if (
      typeof event.surah !== 'number' ||
      typeof event.ayah !== 'number' ||
      typeof event.word_index !== 'number' ||
      typeof event.expected !== 'string' ||
      typeof event.status !== 'string'
    ) {
      return 'ignored-malformed';
    }
    const status = event.status as LiveWordStatus;
    if (!['correct', 'close', 'wrong', 'skipped'].includes(status)) {
      return 'ignored-malformed';
    }
    const word: LiveWordEvent = {
      type: 'word',
      surah: event.surah,
      ayah: event.ayah,
      word_index: event.word_index,
      expected: event.expected,
      status,
      prob: typeof event.prob === 'number' ? event.prob : 0,
      heard: typeof event.heard === 'string' ? event.heard : null,
      event_id: event.event_id,
      sequence_no: event.sequence_no,
      event_type: event.event_type,
      confidence:
        typeof event.confidence === 'number' ? event.confidence : undefined,
      reason: typeof event.reason === 'string' ? event.reason : undefined,
      audio_ts_ms:
        typeof event.audio_ts_ms === 'number' ? event.audio_ts_ms : undefined,
    };
    const slot = `${word.ayah}:${word.word_index}`;
    if (event.event_id === undefined) {
      // رویدادِ قدیمیِ بدون پاکت: نخست dedup با کلیدِ خانه + وضعیت
      // (تکرارِ همان کلمه = تکراری)؛ بعد، اگر همان خانه با وضعیتِ
      // دیگر آمد، اصلاحِ درجا.
      const legacyKey = `${slot}:${status}:${word.expected}`;
      if (this.seenLegacySlots.has(legacyKey)) {
        this.duplicates += 1;
        return 'ignored-duplicate';
      }
      this.seenLegacySlots.add(legacyKey);
    }
    const existing = this.bySlot.get(slot);
    if (existing) {
      // همان خانه دوباره رسید: اصلاحِ درجا، نه الحاقِ دوم.
      const index = this.words.indexOf(existing);
      if (index >= 0) this.words[index] = word;
      this.bySlot.set(slot, word);
      if (existing.event_id) this.byEventId.delete(existing.event_id);
      if (word.event_id) this.byEventId.set(word.event_id, word);
      this.correctionsApplied += 1;
      return 'correction';
    }
    this.words.push(word);
    this.bySlot.set(slot, word);
    if (word.event_id) this.byEventId.set(word.event_id, word);
    return 'word';
  }

  private applyCorrection(event: HifzLiveEvent): string {
    let target: LiveWordEvent | undefined;
    if (
      typeof event.corrects_event_id === 'string' &&
      event.corrects_event_id
    ) {
      target = this.byEventId.get(event.corrects_event_id);
    }
    if (
      !target &&
      typeof event.ayah === 'number' &&
      typeof event.word_index === 'number'
    ) {
      target = this.bySlot.get(`${event.ayah}:${event.word_index}`);
    }
    if (!target) {
      this.correctionsForUnknown += 1;
      return 'ignored-correction-unknown';
    }
    const status = event.status as LiveWordStatus;
    if (!['correct', 'close', 'wrong', 'skipped'].includes(status)) {
      return 'ignored-malformed';
    }
    const index = this.words.indexOf(target);
    const updated: LiveWordEvent = {
      ...target,
      status,
      prob: typeof event.prob === 'number' ? event.prob : target.prob,
      heard:
        event.heard === null
          ? null
          : typeof event.heard === 'string'
            ? event.heard
            : target.heard,
      reason:
        typeof event.reason === 'string' ? event.reason : target.reason,
      event_id: event.event_id ?? target.event_id,
      sequence_no: event.sequence_no ?? target.sequence_no,
      event_type: 'correction',
    };
    if (index >= 0) this.words[index] = updated;
    this.bySlot.set(`${updated.ayah}:${updated.word_index}`, updated);
    if (target.event_id) this.byEventId.delete(target.event_id);
    if (updated.event_id) this.byEventId.set(updated.event_id, updated);
    this.correctionsApplied += 1;
    return 'correction';
  }
}

// ---------------------------------------------------------------------------
// ماشین وضعیت کلاینت (نمایش)
// ---------------------------------------------------------------------------

export type LiveClientState =
  | 'idle'
  | 'requesting_permission'
  | 'connecting'
  | 'engine_loading'
  | 'listening'
  | 'paused'
  | 'stopping'
  | 'ended'
  | 'interrupted';

/**
 * گذرهای مجازِ حالتِ کلاینت. نگاشت به ماشین سرور:
 * requesting_permission فقط کلاینت است (پنجرهٔ اجازهٔ میکروفون)؛
 * engine_loading یعنی در انتظارِ `engine_ready`/`audio_ready`؛
 * processingِ سرور روی کلاینت همان `listening` نشان داده می‌شود؛
 * reconnectingِ سرور وجود ندارد — اتصالِ دوباره یعنی نشستِ تازه
 * (session_id تازه) و `interrupted` فقط حالتِ نمایشِ قطعِ
 * ناخواسته است تا کاربر خودش دوباره شروع کند.
 * paused فقط کلاینت است (توقفِ موقتِ جلسه): ضبط (AudioContext)
 * معلق می‌شود و سوکت باز می‌ماند؛ تایمر نمی‌شمارد. سرور هیچ
 * حالتی برای مکث ندارد، پس مکثِ طولانی ممکن است با قطعِ سرور
 * به interrupted برسد — این محدودیتِ صادقانه است، نه خطا.
 */
export const LIVE_CLIENT_TRANSITIONS: Record<LiveClientState, LiveClientState[]> = {
  idle: ['requesting_permission'],
  requesting_permission: ['connecting', 'idle'],
  connecting: ['engine_loading', 'idle', 'interrupted'],
  engine_loading: ['listening', 'idle', 'interrupted'],
  listening: ['paused', 'stopping', 'idle', 'interrupted', 'ended'],
  paused: ['listening', 'stopping', 'idle', 'interrupted'],
  stopping: ['ended', 'idle'],
  ended: ['idle', 'requesting_permission'],
  interrupted: ['idle', 'requesting_permission'],
};

export function isValidLiveTransition(
  from: LiveClientState,
  to: LiveClientState,
): boolean {
  return LIVE_CLIENT_TRANSITIONS[from].includes(to);
}
