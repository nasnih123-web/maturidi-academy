'use client';

/**
 * LibrarySaveButton — دکمهٔ «ذخیره» در صفحهٔ جزئیات آیتم کتابخانه.
 *
 * ذخیرهٔ کتابخانه روی endpointهای /api/v1/videos/{id}/saved سوار است
 * (جدول user_saved_videos همهٔ kindهای کتابخانه را می‌پذیرد) — همان
 * الگوی دکمهٔ ذخیرهٔ صفحهٔ تماشا: وضعیت با GET، تغییر با POST/DELETE،
 * و مهمان به صفحهٔ ورود با next هدایت می‌شود.
 */
import { useEffect, useState } from 'react';
import { authFetch, getAccessToken } from '@/lib/auth-client';

export interface LibrarySaveLabels {
  save: string;
  saved: string;
}

export function LibrarySaveButton({
  itemId,
  locale,
  labels,
}: {
  itemId: string;
  locale: string;
  labels: LibrarySaveLabels;
}): React.ReactElement {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(
          `/api/v1/videos/${encodeURIComponent(itemId)}/saved`,
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
  }, [itemId]);

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
      await authFetch(`/api/v1/videos/${encodeURIComponent(itemId)}/saved`, {
        method: nextSaved ? 'POST' : 'DELETE',
      });
    } catch {
      setSaved(!nextSaved);
    }
    setBusy(false);
  };

  return (
    <button
      type="button"
      className={`lib-save-btn${saved ? ' on' : ''}`}
      onClick={onToggle}
      disabled={busy}
      aria-pressed={saved}
    >
      🔖 {saved ? labels.saved : labels.save}
    </button>
  );
}
