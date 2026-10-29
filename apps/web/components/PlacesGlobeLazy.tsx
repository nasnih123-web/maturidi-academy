'use client';

import dynamic from 'next/dynamic';

// Same code-split pattern as before: `ssr: false` is only allowed in a
// client wrapper, and the MapLibre globe must never enter the server
// bundle or the homepage bundle.
export const PlacesGlobe = dynamic(
  () => import('@/components/PlacesGlobe').then((m) => m.PlacesGlobe),
  {
    ssr: false,
    loading: () => <p className="places-status">…</p>,
  },
);
