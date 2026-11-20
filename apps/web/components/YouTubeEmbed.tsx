'use client';

/**
 * YouTubeEmbed — watch-page player for external (YouTube) videos.
 *
 * Renders the youtube-nocookie embed in the same brand frame as
 * ProVideoPlayer (.vp-frame). Playback, captions and quality live
 * inside YouTube's own iframe UI — there is deliberately no custom
 * control layer, no resume (the API rejects progress for external
 * items) and no autoplay-next (an embed exposes no ended event).
 * The one behaviour shared with the native players is activity:
 * media_play is reported once on mount, with the same payload shape.
 */
import { useEffect, useRef } from 'react';
import { reportActivity } from '@/lib/activity';

export function YouTubeEmbed({
  itemId,
  title,
  embedUrl,
}: {
  itemId: string;
  title: string;
  embedUrl: string;
}) {
  const reported = useRef(false);

  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    reportActivity('media_play', {
      title,
      refId: itemId,
      meta: { media_kind: 'video' },
    });
  }, [itemId, title]);

  return (
    <div className="vp-frame yt-frame">
      <iframe
        src={embedUrl}
        title={title}
        loading="lazy"
        allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
