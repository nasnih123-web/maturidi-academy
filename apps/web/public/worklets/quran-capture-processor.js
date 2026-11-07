/**
 * Quran live capture AudioWorklet processor (phase 5).
 *
 * Only captures: accumulates mic input into 4096-sample mono chunks
 * and posts them to the main thread (transferable). Resampling to
 * 16 kHz happens on the main thread (lib/quran-audio.ts Resampler)
 * so the logic stays unit-testable; this processor only captures.
 * Channels are mixed down to mono here (average).
 *
 * No hidden fallback lives here: if this module fails to load, the
 * component uses the legacy ScriptProcessor path explicitly and says
 * so in the UI (R-01).
 */
class QuranCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.length = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const frames = input[0].length;
    for (let i = 0; i < frames; i += 1) {
      let s = 0;
      for (let c = 0; c < input.length; c += 1) {
        s += input[c][i];
      }
      this.buffer[this.length] = s / input.length;
      this.length += 1;
      if (this.length === 4096) {
        this.port.postMessage(
          { type: 'chunk', samples: this.buffer },
          [this.buffer.buffer],
        );
        this.buffer = new Float32Array(4096);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('quran-capture-processor', QuranCaptureProcessor);
