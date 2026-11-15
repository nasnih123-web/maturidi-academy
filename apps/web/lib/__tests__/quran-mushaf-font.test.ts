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
  qcfV4Provider,
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
