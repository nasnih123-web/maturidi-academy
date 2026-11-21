'use client';

/**
 * FatwaSaveButton — دکمهٔ «ذخیره» در صفحهٔ جزئیات فتوا.
 *
 * هم‌الگوی ذخیرهٔ صفحهٔ تماشای ویدیو: وضعیت از GET
 * /api/v1/fatwas/{id}/saved خوانده می‌شود و POST/DELETE همان مسیر آن
 * را عوض می‌کند. ذخیره فقط برای واردشده‌هاست؛ مهمان به صفحهٔ ورود با
 * next برمی‌گردد.
 */
import { useEffect, useState } from 'react';
import { authFetch, getAccessToken } from '@/lib/auth-client';

export interface FatwaSaveLabels {
  save: string;
  saved: string;
}

export function FatwaSaveButton({
  fatwaId,
  locale,
  labels,
}: {
  fatwaId: string;
  locale: string;
  labels: FatwaSaveLabels;
}): React.ReactElement {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(
          `/api/v1/fatwas/${encodeURIComponent(fatwaId)}/saved`,
        );
        const j = (await res.json()) as { saved?: boolean };
        if (!cancelled && typeof j?.saved === 'boolean') setSaved(j.saved);
      } catch {
        /* مهمان/آفلاین — ذخیره‌نشده می‌ماند */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fatwaId]);

  const onToggle = async () => {
    if (busy) return;
    if (!getAccessToken()) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = `/${locale}/login?next=${encodeURIComponent(next)}`;
      return;
    }
    const nextSaved = !saved;
    setSaved(nextSaved);
    setBusy(true);
    try {
      await authFetch(`/api/v1/fatwas/${encodeURIComponent(fatwaId)}/saved`, {
        method: nextSaved ? 'POST' : 'DELETE',
      });
    } catch {
      setSaved(!nextSaved);
    }
    setBusy(false);
  };

  return (
    <div className="ftw-save">
      <button
        type="button"
        className={`ftw-share-btn ftw-save-btn${saved ? ' on' : ''}`}
        onClick={onToggle}
        disabled={busy}
        aria-pressed={saved}
      >
        🔖 {saved ? labels.saved : labels.save}
      </button>
    </div>
  );
}
