'use client';

import dynamic from 'next/dynamic';
import type { MosarefLabels } from './MosarefCalculator';

const Inner = dynamic(
  () => import('./MosarefCalculator').then((m) => m.MosarefCalculator),
  { ssr: false, loading: () => <p className="auth-loading">…</p> },
);

export function MosarefCalculator(props: { labels: MosarefLabels; locale: string }) {
  return <Inner {...props} />;
}
