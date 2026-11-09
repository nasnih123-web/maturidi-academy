/**
 * Regression test (Phase 7): quranApiBaseUrl must branch on
 * environment. lib/quran.ts is shared by server components and
 * client components; the study page's client-side surah switch calls
 * getSurah() in the browser, where process.env.API_URL is undefined
 * and the server resolver (lib/api.ts) throws in production before
 * any fetch — the page retried 3x and showed only the retry button.
 * The browser branch must use NEXT_PUBLIC_API_URL (lib/api-base);
 * the server branch keeps API_URL.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { quranApiBaseUrl } from '../quran';

describe('quranApiBaseUrl: شاخهٔ مرورگر/سرور (فاز ۷)', () => {
  it('در مرورگر از NEXT_PUBLIC_API_URL استفاده می‌کند، نه API_URL', () => {
    const prevPublic = process.env.NEXT_PUBLIC_API_URL;
    const prevServer = process.env.API_URL;
    try {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.invalid/';
      process.env.API_URL = 'http://internal.example.invalid';
      assert.equal(quranApiBaseUrl(true), 'https://api.example.invalid');
    } finally {
      if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_API_URL;
      else process.env.NEXT_PUBLIC_API_URL = prevPublic;
      if (prevServer === undefined) delete process.env.API_URL;
      else process.env.API_URL = prevServer;
    }
  });

  it('در سرور از API_URL استفاده می‌کند (اسلش پایانی حذف می‌شود)', () => {
    const prevPublic = process.env.NEXT_PUBLIC_API_URL;
    const prevServer = process.env.API_URL;
    try {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.invalid';
      process.env.API_URL = 'http://internal.example.invalid///';
      assert.equal(quranApiBaseUrl(false), 'http://internal.example.invalid');
    } finally {
      if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_API_URL;
      else process.env.NEXT_PUBLIC_API_URL = prevPublic;
      if (prevServer === undefined) delete process.env.API_URL;
      else process.env.API_URL = prevServer;
    }
  });

  it('شاخهٔ مرورگر بدون NEXT_PUBLIC_API_URL در production بلند خطا می‌دهد (نه fallback خاموش)', () => {
    const env = process.env as Record<string, string | undefined>;
    const prevPublic = env.NEXT_PUBLIC_API_URL;
    const prevNodeEnv = env.NODE_ENV;
    try {
      delete env.NEXT_PUBLIC_API_URL;
      env.NODE_ENV = 'production';
      assert.throws(() => quranApiBaseUrl(true), /NEXT_PUBLIC_API_URL is not set/);
    } finally {
      if (prevPublic === undefined) delete env.NEXT_PUBLIC_API_URL;
      else env.NEXT_PUBLIC_API_URL = prevPublic;
      if (prevNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = prevNodeEnv;
    }
  });
});
