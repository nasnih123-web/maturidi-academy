'use client';

import dynamic from 'next/dynamic';

// Same code-split pattern as PlacesMapLazy: `ssr: false` is only allowed
// in a client wrapper, and the three.js globe must never enter the
// server bundle or the homepage bundle.
export const GlobeExplorer = dynamic(
  () => import('@/components/GlobeExplorer').then((m) => m.GlobeExplorer),
  {
    ssr: false,
    loading: () => <p className="places-status">…</p>,
  },
);
