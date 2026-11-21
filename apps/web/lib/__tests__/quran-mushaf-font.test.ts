/**
 * Tests for the per-page mushaf font loader (lib/quran-mushaf-font.ts):
 * a timed-out or failed load must NOT stick — the cached promise is
 * evicted so a later call retries (and finds the background load once
 * it lands). Regression tests for 2026-11-16: the first page showed
 * glyphs while later pages stayed text after peeking across a page
 * turn, because one slow fetch pinned the page to Tanzil text.
 *
 * The loader runs in the browser (document.fonts + FontFace); here
 * both are stubbed on globalThis and restored afterwards. Real
 * timers are used with a short race timeout so the tests stay fast.
 *
 * Run via the documented web-test harness (tsc to /tmp + node --test)
 * with cwd = repo root.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureMushafFontFor,
  loadedMushafV4FontCount,
  protectMushafFontFamily,
  qcfV4Provider,
  unprotectMushafFontFamily,
} from '../quran-mushaf-font';

/** Minimal FontFace stub: load() resolves only when the test says so. */
class FakeFontFace {
  family: string;
  status = 'unloaded';
  static instances: FakeFontFace[] = [];
  private resolveLoad: (() => void) | null = null;
  private rejectLoad: ((reason?: unknown) => void) | null = null;
  private loadPromise: Promise<void>;
  constructor(family: string, _source: string, _opts?: unknown) {
    this.family = family;
    this.loadPromise = new Promise<void>((resolve, reject) => {
      this.resolveLoad = resolve;
      this.rejectLoad = reject;
    });
    FakeFontFace.instances.push(this);
  }
  load(): Promise<void> {
    return this.loadPromise;
  }
  succeed(): void {
    this.status = 'loaded';
    this.resolveLoad?.();
  }
  fail(): void {
    this.rejectLoad?.(new Error('font load failed'));
  }
}

function installStubs(): () => void {
  const prev = {
    document: (globalThis as unknown as { document?: unknown }).document,
    window: (globalThis as unknown as { window?: unknown }).window,
    FontFace: (globalThis as unknown as { FontFace?: unknown }).FontFace,
  };
  const fonts = new Set<FakeFontFace>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = {
    fonts,
    createElement: () => ({
      setAttribute: () => undefined,
      textContent: '',
    }),
    head: { appendChild: () => undefined },
  };
  g.window = { setTimeout, clearTimeout };
  g.FontFace = FakeFontFace;
  FakeFontFace.instances = [];
  return () => {
    const gg = globalThis as unknown as Record<string, unknown>;
    if (prev.document === undefined) delete gg.document;
    else gg.document = prev.document;
    if (prev.window === undefined) delete gg.window;
    else gg.window = prev.window;
    if (prev.FontFace === undefined) delete gg.FontFace;
    else gg.FontFace = prev.FontFace;
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('ensureMushafFontFor: a timed-out load does not stick', () => {
  it('times out false, then succeeds on retry once the background load lands', async () => {
    const restore = installStubs();
    try {
      const first = await ensureMushafFontFor(qcfV4Provider, 601, 10);
      assert.equal(first, false);
      // The failed race evicted the cache entry: nothing is tracked.
      assert.equal(loadedMushafV4FontCount(), 0);
      // The background load lands after the timeout and adds the face.
      const face = FakeFontFace.instances.find((f) => f.family === 'QCF4601_COLOR');
      assert.ok(face, 'one FontFace was created for p601');
      face.succeed();
      await tick();
      const second = await ensureMushafFontFor(qcfV4Provider, 601, 10);
      assert.equal(second, true);
      // No second FontFace was needed: the retry found it ready.
      assert.equal(
        FakeFontFace.instances.filter((f) => f.family === 'QCF4601_COLOR').length,
        1,
      );
    } finally {
      restore();
    }
  });

  it('a genuinely failed load retries with a fresh FontFace', async () => {
    const restore = installStubs();
    try {
      const pending = ensureMushafFontFor(qcfV4Provider, 602, 50);
      const firstFace = FakeFontFace.instances.find((f) => f.family === 'QCF4602_COLOR');
      assert.ok(firstFace, 'one FontFace was created for p602');
      firstFace.fail();
      assert.equal(await pending, false);
      const secondPending = ensureMushafFontFor(qcfV4Provider, 602, 50);
      const faces = FakeFontFace.instances.filter((f) => f.family === 'QCF4602_COLOR');
      assert.equal(faces.length, 2, 'the retry built a fresh FontFace');
      faces[1].succeed();
      assert.equal(await secondPending, true);
    } finally {
      restore();
    }
  });
});

describe('protectMushafFontFamily: the active page font survives the cap', () => {
  it('a pinned family is skipped by eviction and may be evicted once released', async () => {
    const restore = installStubs();
    try {
      const load = async (page: number) => {
        const pending = ensureMushafFontFor(qcfV4Provider, page, 1000);
        const family = `QCF4${String(page).padStart(3, '0')}_COLOR`;
        const face = FakeFontFace.instances.find((f) => f.family === family);
        assert.ok(face, `one FontFace was created for p${page}`);
        face.succeed();
        assert.equal(await pending, true);
      };
      const countFor = (family: string) =>
        FakeFontFace.instances.filter((f) => f.family === family).length;
      // Page 590 is the "active" page: pin it, then load eight more
      // families past the 8-family cap.
      await load(590);
      protectMushafFontFamily('QCF4590_COLOR');
      for (const p of [591, 592, 593, 594, 595, 596, 597, 598]) await load(p);
      assert.equal(loadedMushafV4FontCount(), 8);
      // The pinned family survived: no fresh FontFace on re-ensure.
      const again590 = ensureMushafFontFor(qcfV4Provider, 590, 1000);
      assert.equal(countFor('QCF4590_COLOR'), 1, 'the pinned family was not evicted');
      assert.equal(await again590, true);
      // The oldest UNPROTECTED family (591) was evicted instead.
      const again591 = ensureMushafFontFor(qcfV4Provider, 591, 1000);
      assert.equal(countFor('QCF4591_COLOR'), 2, 'the oldest unprotected family was evicted');
      FakeFontFace.instances.filter((f) => f.family === 'QCF4591_COLOR')[1].succeed();
      assert.equal(await again591, true);
      // Once released, the old pin is evicted like any other.
      unprotectMushafFontFamily('QCF4590_COLOR');
      await load(599);
      assert.equal(loadedMushafV4FontCount(), 8);
      const after599 = ensureMushafFontFor(qcfV4Provider, 590, 1000);
      assert.equal(countFor('QCF4590_COLOR'), 2, 'the released family was evicted next');
      FakeFontFace.instances.filter((f) => f.family === 'QCF4590_COLOR')[1].succeed();
      assert.equal(await after599, true);
    } finally {
      unprotectMushafFontFamily('QCF4590_COLOR');
      restore();
    }
  });
});
