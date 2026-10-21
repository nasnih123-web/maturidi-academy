'use client';

import dynamic from 'next/dynamic';
import type { ZakatExtendedLabels } from './ZakatExtendedCalculator';

const Inner = dynamic(
  () => import('./ZakatExtendedCalculator').then((m) => m.ZakatExtendedCalculator),
  { ssr: false, loading: () => <p className="auth-loading">…</p> },
);

export function ZakatExtendedCalculator(props: {
  labels: ZakatExtendedLabels;
  locale: string;
}) {
  return <Inner {...props} />;
}
