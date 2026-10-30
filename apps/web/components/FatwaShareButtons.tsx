'use client';

/**
 * Share buttons for a published fatwa — Telegram, WhatsApp, copy link.
 *
 * Every click counts one share on the API first (POST
 * /api/v1/fatwa/topics/{id}/share), then opens the share target. A failed
 * count request never blocks sharing; the shown count only advances when
 * the API confirms the new total.
 */
import { useState } from 'react';
import { apiBaseUrl } from '@/lib/api-base';
import { TelegramIcon, WhatsappIcon } from '@/components/ShareIcons';

export interface FatwaShareLabels {
  share: string;
  telegram: string;
  whatsapp: string;
  copyLink: string;
  copied: string;
  shares: string;
}

export function FatwaShareButtons({
  topicId,
  title,
  initialCount,
  labels,
}: {
  topicId: string;
  title: string;
  initialCount: number;
  labels: FatwaShareLabels;
}): React.ReactElement {
  const [count, setCount] = useState(initialCount);
  const [copied, setCopied] = useState(false);

  async function countShare(): Promise<void> {
    try {
      const res = await fetch(
        `${apiBaseUrl()}/api/v1/fatwa/topics/${encodeURIComponent(topicId)}/share`,
        { method: 'POST', headers: { Accept: 'application/json' } },
      );
      if (res.ok) {
        const o = (await res.json()) as Record<string, unknown>;
        if (typeof o.share_count === 'number') setCount(o.share_count);
      }
    } catch {
      /* sharing still proceeds; the count just stays stale */
    }
  }

  function pageUrl(): string {
    try {
      return window.location.href;
    } catch {
      return '';
    }
  }

  async function onTelegram(): Promise<void> {
    const url = pageUrl();
    await countShare();
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
      '_blank',
      'noopener',
    );
  }

  async function onWhatsapp(): Promise<void> {
    const url = pageUrl();
    await countShare();
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
      '_blank',
      'noopener',
    );
  }

  async function onCopy(): Promise<void> {
    const url = pageUrl();
    await countShare();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* clipboard unavailable — the link is still in the address bar */
    }
  }

  return (
    <div className="ftw-share">
      <span className="ftw-share-count">
        {labels.shares}: {count}
      </span>
      <div className="ftw-share-row">
        <span>{labels.share}</span>
        <button type="button" className="ftw-share-btn" onClick={onTelegram}>
          <TelegramIcon />
          {labels.telegram}
        </button>
        <button type="button" className="ftw-share-btn" onClick={onWhatsapp}>
          <WhatsappIcon />
          {labels.whatsapp}
        </button>
        <button type="button" className="ftw-share-btn" onClick={onCopy}>
          {copied ? labels.copied : labels.copyLink}
        </button>
      </div>
    </div>
  );
}
