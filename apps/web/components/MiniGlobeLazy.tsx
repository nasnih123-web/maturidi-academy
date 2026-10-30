'use client';

import dynamic from 'next/dynamic';

// Same code-split pattern as the full globe: `ssr: false` is only
// allowed in a client wrapper, and MapLibre must never enter the
// server bundle. The homepage loads this chunk lazily, after first
// paint, instead of on the server.
export const MiniGlobe = dynamic(() => import('@/components/MiniGlobe').then((m) => m.MiniGlobe), {
  ssr: false,
  loading: () => <div className="mini-globe-placeholder" aria-hidden />,
});
