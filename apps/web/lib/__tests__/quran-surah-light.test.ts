/**
 * getSurah({ light: true }) (proposal 2): the nass preload loop only
 * needs the Uthmani text, so the request must carry
 * `editions=quran-uthmani` and the full bundle must NOT be fetched.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getSurah } from '../quran';

const LIGHT_BODY = {
  surah: 112,
  name_ar: 'الإخلاص',
  name_en: 'Al-Ikhlas',
  ayahs: [
    {
      ayah: 1,
      editions: [{ edition: 'quran-uthmani', text: 'قُلْ هُوَ اللَّهُ أَحَدٌ' }],
    },
  ],
};

describe('getSurah light bundle (پیشنهاد ۲)', () => {
  it('light:true adds editions=quran-uthmani to the request URL', async () => {
    const origFetch = globalThis.fetch;
    const urls: string[] = [];
    try {
      (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
        urls.push(String(input));
        return { ok: true, json: async () => LIGHT_BODY };
      };
      const view = await getSurah(112, { light: true });
      assert.equal(urls.length, 1);
      assert.ok(urls[0].includes('/api/v1/quran/surah/112?editions=quran-uthmani'));
      assert.equal(view.ayahs[0].text, 'قُلْ هُوَ اللَّهُ أَحَدٌ');
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
    }
  });

  it('without light, no editions param is sent (full bundle)', async () => {
    const origFetch = globalThis.fetch;
    const urls: string[] = [];
    try {
      (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
        urls.push(String(input));
        return { ok: true, json: async () => LIGHT_BODY };
      };
      await getSurah(112);
      assert.equal(urls.length, 1);
      assert.ok(!urls[0].includes('editions='));
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
    }
  });
});
