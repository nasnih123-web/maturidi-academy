"use client";

/**
 * AnnouncementsBar — global placement announcements as dismissible banners.
 * Dismissal persists per announcement id in localStorage
 * (`ma-announcement-dismissed`: JSON id array). Pure presentation: every
 * string arrives as a prop; the only logic is local UI state.
 */
import { useEffect, useState } from "react";

export interface AnnouncementBarItem {
  id: string;
  message: string;
}

const STORAGE_KEY = "ma-announcement-dismissed";

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function AnnouncementsBar({
  items,
  dismissLabel,
  listAria,
}: {
  items: AnnouncementBarItem[];
  dismissLabel: string;
  listAria: string;
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const visible = items.filter((it) => !dismissed.includes(it.id));
  if (!visible.length) return null;

  const dismiss = (id: string) => {
    const next = [...new Set([...dismissed, id])];
    setDismissed(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — banner stays dismissed for this session */
    }
  };

  return (
    <div className="announcements" role="region" aria-label={listAria}>
      {visible.map((it) => (
        <div key={it.id} className="announcement-bar">
          <p>{it.message}</p>
          <button
            type="button"
            className="announcement-dismiss"
            onClick={() => dismiss(it.id)}
            aria-label={dismissLabel}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
