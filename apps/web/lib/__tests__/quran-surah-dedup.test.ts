/**
 * getSurah dedup (proposal 4): concurrent calls for the same surah +
 * options share one in-flight promise — the neighbour effect and the
 * preload loop fetched Surah 2 twice, 20ms apart.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getSurah } from '../quran';

const BODY = {
  surah: 2,
  name_ar: 'البقرة',
  name_en: 'Al-Baqara',
  ayahs: [
    {
      ayah: 1,
      editions: [{ edition: 'quran-uthmani', text: 'الٓمٓ' }],
    },
  ],
};

describe('getSurah dedup (پیشنهاد ۴)', () => {
  it('two concurrent identical calls share one fetch', async () => {
    const origFetch = globalThis.fetch;
    let calls = 0;
    let release!: (v: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    try {
      (globalThis as unknown as { fetch: unknown }).fetch = async () => {
        calls += 1;
        await gate;
        return { ok: true, json: async () => BODY };
      };
      const p1 = getSurah(2);
      const p2 = getSurah(2);
      // Both are in flight before either resolves: only one fetch.
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(calls, 1);
      release(null);
      const [v1, v2] = await Promise.all([p1, p2]);
      assert.equal(v1.ayahs[0].text, 'الٓمٓ');
      assert.equal(v2.ayahs[0].text, 'الٓمٓ');
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
    }
  });

  it('different options do not share a fetch', async () => {
    const origFetch = globalThis.fetch;
    let calls = 0;
    try {
      (globalThis as unknown as { fetch: unknown }).fetch = async () => {
        calls += 1;
        return { ok: true, json: async () => BODY };
      };
      await Promise.all([getSurah(2), getSurah(2, { light: true })]);
      assert.equal(calls, 2);
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
    }
  });

  it('a settled call refetches (no stale cache)', async () => {
    const origFetch = globalThis.fetch;
    let calls = 0;
    try {
      (globalThis as unknown as { fetch: unknown }).fetch = async () => {
        calls += 1;
        return { ok: true, json: async () => BODY };
      };
      await getSurah(2);
      await getSurah(2);
      assert.equal(calls, 2);
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
    }
  });

  it('a failed fetch is not cached: the retry refetches', async () => {
    const origFetch = globalThis.fetch;
    let calls = 0;
    try {
      (globalThis as unknown as { fetch: unknown }).fetch = async () => {
        calls += 1;
        if (calls === 1) return { ok: false, status: 500, json: async () => null };
        return { ok: true, json: async () => BODY };
      };
      await assert.rejects(() => getSurah(2));
      const view = await getSurah(2);
      assert.equal(view.ayahs[0].text, 'الٓمٓ');
      assert.equal(calls, 2);
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
    }
  });
});
