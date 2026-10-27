'use client';

/**
 * FatwaHistoryPanel — past assistant conversations on the listing page.
 *
 * Reads the exact store the fatwa chat writes (useFatwaHistory — same
 * localStorage key, same auth-aware identity), so the listing never keeps
 * a second copy of history. Each entry deep-links to the assistant
 * (`/{locale}/fatwa?session={id}`), which reopens that conversation.
 * History lives on this device only: there is no backend fatwa-history
 * endpoint, so nothing here is a server record.
 */
import { useFatwaHistory } from '@/lib/hooks/useFatwaChat';

export function FatwaHistoryPanel({
  locale,
  labels,
}: {
  locale: string;
  labels: { title: string; empty: string; hint: string };
}) {
  const { history, loaded } = useFatwaHistory();
  if (!loaded) return null;
  return (
    <section className="ftw-list-history" aria-label={labels.title}>
      <h2>{labels.title}</h2>
      {history.length === 0 ? (
        <>
          <p className="ftw-muted">{labels.empty}</p>
          <p className="ftw-muted">{labels.hint}</p>
        </>
      ) : (
        <>
          <ul>
            {history.map((s) => (
              <li key={s.id}>
                <a href={`/${locale}/fatwa?session=${encodeURIComponent(s.id)}`}>
                  {s.title || s.id}
                </a>
              </li>
            ))}
          </ul>
          <p className="ftw-muted">{labels.hint}</p>
        </>
      )}
    </section>
  );
}
