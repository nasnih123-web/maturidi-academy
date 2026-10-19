'use client';

/**
 * LibraryAccessGate — honest 404 handling for library items.
 *
 * A 404 from GET /api/v1/library/items/{id} means "not found OR not
 * visible anonymously" (e.g. scholars_only). If the visitor is logged in,
 * retry with the auth-aware client — scholars then get the real item.
 * Otherwise render the login-required state; never fake the content.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchLibraryItem, isLoggedIn, LibraryClientError } from '@/lib/library-client';
import type { LibraryItemDetail } from '@/lib/library';
import { LibraryItemView, type LibraryItemViewLabels } from './LibraryItemView';

export interface LibraryAccessGateLabels {
  checking: string;
  loginRequiredTitle: string;
  loginRequiredBody: string;
  loginCta: string;
  notFoundTitle: string;
  notFoundBody: string;
  backToLibrary: string;
}

interface Props {
  itemId: string;
  locale: string;
  viewLabels: LibraryItemViewLabels;
  labels: LibraryAccessGateLabels;
}

export function LibraryAccessGate({ itemId, locale, viewLabels, labels }: Props) {
  const [state, setState] = useState<
    | { kind: 'checking' }
    | { kind: 'login' }
    | { kind: 'notfound' }
    | { kind: 'ready'; item: LibraryItemDetail }
  >({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;
    if (!isLoggedIn()) {
      setState({ kind: 'login' });
      return;
    }
    fetchLibraryItem(itemId)
      .then((item) => {
        if (!cancelled) setState({ kind: 'ready', item });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof LibraryClientError && err.status === 404) setState({ kind: 'notfound' });
        else setState({ kind: 'notfound' });
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (state.kind === 'checking') {
    return (
      <p className="lib-status" role="status">
        {labels.checking}
      </p>
    );
  }

  if (state.kind === 'ready') {
    return <LibraryItemView item={state.item} locale={locale} labels={viewLabels} />;
  }

  if (state.kind === 'login') {
    return (
      <div className="lib-gate" role="alert">
        <h2 className="lib-gate-title">{labels.loginRequiredTitle}</h2>
        <p>{labels.loginRequiredBody}</p>
        <div className="lib-gate-actions">
          <Link href={`/${locale}/login`} className="lib-btn">
            {labels.loginCta}
          </Link>
          <Link href={`/${locale}/library`} className="lib-btn lib-btn-ghost">
            {labels.backToLibrary}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="lib-gate" role="alert">
      <h2 className="lib-gate-title">{labels.notFoundTitle}</h2>
      <p>{labels.notFoundBody}</p>
      <div className="lib-gate-actions">
        <Link href={`/${locale}/library`} className="lib-btn lib-btn-ghost">
          {labels.backToLibrary}
        </Link>
      </div>
    </div>
  );
}
