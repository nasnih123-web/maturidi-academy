/**
 * Tests for the Phase 5 hifz player helpers (apps/web/lib/hifz-player.ts):
 * Tarteel speeds, repeat/next-ayah decisions, position + speed
 * persistence, reciter-photo mapping.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LISTEN_SPEEDS,
  clampListenRepeatCount,
  clearListenPosition,
  listenReciterPhotoUrl,
  listenRepeatNext,
  listenRepeatRemaining,
  loadListenPosition,
  nextListenRepeatMode,
  nextListenSpeed,
  normalizeListenSpeed,
  parseStoredListenSpeed,
  saveListenPosition,
  saveListenSpeed,
  type ListenPosition,
  type ListenRepeatInput,
} from '../hifz-player';

/** Minimal in-memory Storage for the persistence tests. */
function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    _store: store,
  };
}

describe('normalizeListenSpeed (Tarteel §11.2: 0.5–1.75)', () => {
  it('keeps all six observed speeds', () => {
    for (const s of LISTEN_SPEEDS) assert.equal(normalizeListenSpeed(s), s);
  });
  it('rejects 2× (not in the observed list) and other values', () => {
    assert.equal(normalizeListenSpeed(2), 1);
    assert.equal(normalizeListenSpeed(0.6), 1);
    assert.equal(normalizeListenSpeed('1.5'), 1);
    assert.equal(normalizeListenSpeed(undefined), 1);
    assert.equal(normalizeListenSpeed(Number.NaN), 1);
  });
  it('cycles 1 → 1.25 → 1.5 → 1.75 → 0.5', () => {
    assert.equal(nextListenSpeed(1), 1.25);
    assert.equal(nextListenSpeed(1.5), 1.75);
    assert.equal(nextListenSpeed(1.75), 0.5);
    assert.equal(nextListenSpeed(2), 1.25);
  });
});

describe('listenRepeatNext', () => {
  const base: ListenRepeatInput = {
    currentAyah: 2,
    ayahCount: 7,
    mode: 'off',
    ayahRepeatCount: 1,
    range: null,
    ayahPlays: 1,
    rangePlays: 1,
  };

  it('off: advances, and stops at the surah end', () => {
    assert.deepEqual(listenRepeatNext(base), {
      action: 'goto',
      ayah: 3,
      ayahPlays: 1,
      rangePlays: 1,
    });
    assert.equal(listenRepeatNext({ ...base, currentAyah: 7 }).action, 'stop');
  });
  it('off ignores the ayah repeat count', () => {
    assert.deepEqual(listenRepeatNext({ ...base, ayahRepeatCount: 3 }).action, 'goto');
  });
  it('ayah: replays the count, then advances, then stops at the end', () => {
    const input = { ...base, mode: 'ayah' as const, ayahRepeatCount: 3 };
    assert.deepEqual(listenRepeatNext({ ...input, ayahPlays: 1 }), {
      action: 'replay',
      ayah: 2,
      ayahPlays: 2,
      rangePlays: 1,
    });
    assert.deepEqual(listenRepeatNext({ ...input, ayahPlays: 2 }), {
      action: 'replay',
      ayah: 2,
      ayahPlays: 3,
      rangePlays: 1,
    });
    assert.deepEqual(listenRepeatNext({ ...input, ayahPlays: 3 }), {
      action: 'goto',
      ayah: 3,
      ayahPlays: 1,
      rangePlays: 1,
    });
    assert.equal(listenRepeatNext({ ...input, currentAyah: 7, ayahPlays: 3 }).action, 'stop');
  });
  it('range: plays the range N times, then continues after it', () => {
    const range = { start: 2, end: 4, count: 2 };
    const input = { ...base, mode: 'range' as const, range };
    assert.deepEqual(listenRepeatNext({ ...input, currentAyah: 3 }), {
      action: 'goto',
      ayah: 4,
      ayahPlays: 1,
      rangePlays: 1,
    });
    assert.deepEqual(listenRepeatNext({ ...input, currentAyah: 4, rangePlays: 1 }), {
      action: 'goto',
      ayah: 2,
      ayahPlays: 1,
      rangePlays: 2,
    });
    assert.deepEqual(listenRepeatNext({ ...input, currentAyah: 4, rangePlays: 2 }), {
      action: 'goto',
      ayah: 5,
      ayahPlays: 1,
      rangePlays: 2,
    });
  });
  it('range ending at the surah end stops after the last pass', () => {
    const range = { start: 6, end: 7, count: 1 };
    const input = { ...base, mode: 'range' as const, range, currentAyah: 7 };
    assert.equal(listenRepeatNext(input).action, 'stop');
  });
  it('range with an ayah repeat count replays inside each pass', () => {
    const range = { start: 2, end: 3, count: 1 };
    const input = { ...base, mode: 'range' as const, range, ayahRepeatCount: 2, currentAyah: 2, ayahPlays: 1 };
    assert.equal(listenRepeatNext(input).action, 'replay');
    assert.equal(listenRepeatNext({ ...input, ayahPlays: 2 }).action, 'goto');
  });
  it('surah: restarts at ayah 1 after the last ayah (infinite, as before)', () => {
    const input = { ...base, mode: 'surah' as const, currentAyah: 7 };
    assert.deepEqual(listenRepeatNext(input), {
      action: 'goto',
      ayah: 1,
      ayahPlays: 1,
      rangePlays: 1,
    });
  });
  it('range without a range config behaves like straight-through', () => {
    assert.equal(listenRepeatNext({ ...base, mode: 'range' }).action, 'goto');
  });
  it('remaining: ayah plays left, range passes left, null for off/surah', () => {
    assert.equal(
      listenRepeatRemaining({ ...base, mode: 'ayah', ayahRepeatCount: 3, ayahPlays: 2 }),
      2,
    );
    assert.equal(
      listenRepeatRemaining({
        ...base,
        mode: 'range',
        range: { start: 2, end: 4, count: 3 },
        rangePlays: 2,
      }),
      2,
    );
    assert.equal(listenRepeatRemaining(base), null);
    assert.equal(listenRepeatRemaining({ ...base, mode: 'surah' }), null);
  });
  it('repeat mode cycles off → ayah → range → surah → off', () => {
    assert.equal(nextListenRepeatMode('off'), 'ayah');
    assert.equal(nextListenRepeatMode('ayah'), 'range');
    assert.equal(nextListenRepeatMode('range'), 'surah');
    assert.equal(nextListenRepeatMode('surah'), 'off');
  });
  it('clamps repeat counts to 1–20', () => {
    assert.equal(clampListenRepeatCount(0), 1);
    assert.equal(clampListenRepeatCount(99), 20);
    assert.equal(clampListenRepeatCount(Number.NaN), 1);
    assert.equal(clampListenRepeatCount(3.7), 3);
  });
});

describe('listen position persistence', () => {
  const pos: ListenPosition = {
    surah: 1,
    reciter: 'alafasy',
    ayah: 3,
    progressMs: 12500,
    savedAt: 1234567890,
  };

  it('round-trips a saved position for the same reciter+surah', () => {
    const storage = memoryStorage();
    saveListenPosition(storage, pos);
    assert.deepEqual(loadListenPosition(storage, 'alafasy', 1, 7), pos);
  });
  it('ignores a position saved for another reciter or surah', () => {
    const storage = memoryStorage();
    saveListenPosition(storage, pos);
    assert.equal(loadListenPosition(storage, 'husary', 1, 7), null);
    assert.equal(loadListenPosition(storage, 'alafasy', 2, 286), null);
  });
  it('ignores corrupt data and an ayah outside the surah', () => {
    const storage = memoryStorage();
    saveListenPosition(storage, pos);
    storage.setItem('maturidi-hifz-listen-position-v1', '{not json');
    assert.equal(loadListenPosition(storage, 'alafasy', 1, 7), null);
    saveListenPosition(storage, { ...pos, ayah: 99 });
    assert.equal(loadListenPosition(storage, 'alafasy', 1, 7), null);
  });
  it('clear removes the saved position', () => {
    const storage = memoryStorage();
    saveListenPosition(storage, pos);
    clearListenPosition(storage);
    assert.equal(loadListenPosition(storage, 'alafasy', 1, 7), null);
  });
  it('parses a stored speed, and falls back to 1 when corrupt', () => {
    assert.equal(parseStoredListenSpeed('1.75'), 1.75);
    assert.equal(parseStoredListenSpeed('2'), 1);
    assert.equal(parseStoredListenSpeed('junk'), 1);
    assert.equal(parseStoredListenSpeed(null), 1);
    const storage = memoryStorage();
    saveListenSpeed(storage, 1.5);
    assert.equal(parseStoredListenSpeed(storage.getItem('maturidi-hifz-listen-speed-v1')), 1.5);
  });
});

describe('listenReciterPhotoUrl', () => {
  const photos = { 'ar.alafasy': 'https://example.invalid/alafasy.jpg', 'ar.husary': null };
  it('maps a listen id to its edition photo', () => {
    assert.equal(listenReciterPhotoUrl('alafasy', photos), 'https://example.invalid/alafasy.jpg');
  });
  it('returns null when the edition has no photo or the id is unmapped', () => {
    assert.equal(listenReciterPhotoUrl('husary', photos), null);
    assert.equal(listenReciterPhotoUrl('tablawi', photos), null);
    assert.equal(listenReciterPhotoUrl('unknown', photos), null);
  });
});
