'use client';

import dynamic from 'next/dynamic';
import type { MirasLabels } from './MirasCalculator';

const Inner = dynamic(
  () => import('./MirasCalculator').then((m) => m.MirasCalculator),
  { ssr: false, loading: () => <p className="auth-loading">…</p> },
);

export function MirasCalculator(props: { labels: MirasLabels; locale: string }) {
  return <Inner {...props} />;
}
