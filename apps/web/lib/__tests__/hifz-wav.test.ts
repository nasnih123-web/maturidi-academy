/**
 * Tests for the canonical WAV encoder (lib/hifz-wav.ts, hifz-completion
 * refactor step 2): the single implementation that replaced the
 * duplicate encodeWav (QuranHifzStudy) / encodeWav16kMono
 * (hifz-record-wav) pair. Header bytes, sample rates, clamping and
 * buffer length are asserted byte-for-byte.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { encodeWav } from '../hifz-wav';

async function bytes(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

function str(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

describe('encodeWav: RIFF header (16-bit PCM mono)', () => {
  it('writes RIFF/WAVE/fmt/data chunks with the right sizes at 16 kHz', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const blob = encodeWav(samples, 16000);
    assert.equal(blob.type, 'audio/wav');
    assert.equal(blob.size, 44 + 2 * samples.length);
    const v = await bytes(blob);
    assert.equal(str(v, 0, 4), 'RIFF');
    assert.equal(v.getUint32(4, true), 36 + 2 * samples.length);
    assert.equal(str(v, 8, 4), 'WAVE');
    assert.equal(str(v, 12, 4), 'fmt ');
    assert.equal(v.getUint32(16, true), 16); // PCM chunk size
    assert.equal(v.getUint16(20, true), 1); // PCM format
    assert.equal(v.getUint16(22, true), 1); // mono
    assert.equal(v.getUint32(24, true), 16000); // sample rate
    assert.equal(v.getUint32(28, true), 32000); // byte rate
    assert.equal(v.getUint16(32, true), 2); // block align
    assert.equal(v.getUint16(34, true), 16); // bits per sample
    assert.equal(str(v, 36, 4), 'data');
    assert.equal(v.getUint32(40, true), 2 * samples.length);
  });

  it('honours a 48 kHz sample rate (byte rate scales with it)', async () => {
    const blob = encodeWav(new Float32Array([0, 0]), 48000);
    const v = await bytes(blob);
    assert.equal(v.getUint32(24, true), 48000);
    assert.equal(v.getUint32(28, true), 96000);
    assert.equal(blob.size, 48);
  });

  it('clamps out-of-range samples to [-1, 1] before int16 conversion', async () => {
    const blob = encodeWav(new Float32Array([-2, -1, 0, 0.5, 1, 2]), 16000);
    const v = await bytes(blob);
    // -1 -> -32768, +1 -> +32767; 0.5 * 0x7fff truncates to 16383.
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true)),
      [-32768, -32768, 0, 16383, 32767, 32767],
    );
  });

  it('encodes an empty sample array as a 44-byte header-only file', async () => {
    const blob = encodeWav(new Float32Array(0), 16000);
    assert.equal(blob.size, 44);
    const v = await bytes(blob);
    assert.equal(v.getUint32(4, true), 36);
    assert.equal(v.getUint32(40, true), 0);
  });

  it('matches the old 16 kHz constants (byte-identical to encodeWav16kMono)', async () => {
    // The retired encodeWav16kMono hardcoded 16000 Hz / 32000 byte rate;
    // encodeWav(samples, 16000) must produce exactly those header words.
    const samples = new Float32Array([0.25, -0.75, 0.999]);
    const v = await bytes(encodeWav(samples, 16000));
    assert.equal(v.getUint32(24, true), 16000);
    assert.equal(v.getUint32(28, true), 32000);
    assert.deepEqual(
      [0, 1, 2].map((i) => v.getInt16(44 + i * 2, true)),
      [Math.trunc(0.25 * 0x7fff), Math.trunc(-0.75 * 0x8000), Math.trunc(0.999 * 0x7fff)],
    );
  });
});
