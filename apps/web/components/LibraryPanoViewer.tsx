'use client';

/**
 * LibraryPanoViewer — lightweight equirectangular 360° viewer.
 *
 * No three.js / photo-sphere-viewer dependency: a <canvas> renders a
 * rectilinear-approximated viewport from the equirectangular source by
 * blitting vertical strips (GPU-accelerated drawImage). Drag to pan,
 * wheel/pinch to zoom, inertia on release. Works with a still panorama
 * image or a 360° video (frames drawn per rAF).
 *
 * Code-split (React.lazy from LibraryItemView) — never in the homepage bundle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveStreamUrl, LibraryClientError } from '@/lib/library-client';

export interface LibraryPanoViewerLabels {
  loading: string;
  failed: string;
  retry: string;
  dragHint: string;
  projectionLabel: string;
  deviceNote: string;
  play: string;
  pause: string;
  videoNote: string;
}

interface Props {
  itemId: string;
  title: string;
  projection: string | null;
  labels: LibraryPanoViewerLabels;
}

const STRIP = 3; // px per blit — smoothness/perf tradeoff
const MIN_FOV = Math.PI / 6;
const MAX_FOV = (Math.PI * 2) / 3;

export function LibraryPanoViewer({ itemId, title, projection, labels }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewRef = useRef({ yaw: 0, pitch: 0, fov: Math.PI / 2.4, vel: 0, dragging: false, lastX: 0, lastY: 0 });
  const rafRef = useRef(0);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [isVideo, setIsVideo] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSrc(null);
    resolveStreamUrl(itemId)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch((err) => {
        if (!cancelled && err instanceof LibraryClientError) setFailed(true);
        else if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // Load the source: try as an image first; fall back to video.
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      setIsVideo(false);
    };
    img.onerror = () => {
      if (cancelled) return;
      // Not an image — treat as a 360° video source.
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.loop = true;
      v.muted = true; // muted until the user opts into sound
      v.playsInline = true;
      v.preload = 'auto';
      v.onloadeddata = () => {
        if (cancelled) return;
        videoRef.current = v;
        setIsVideo(true);
      };
      v.onerror = () => {
        if (!cancelled) setFailed(true);
      };
      v.src = src;
    };
    img.src = src;
    return () => {
      cancelled = true;
      videoRef.current?.pause();
      videoRef.current = null;
      imgRef.current = null;
    };
  }, [src]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const img = imgRef.current;
    const vid = videoRef.current;
    const source: { width: number; height: number } | null =
      img ?? (vid && vid.videoWidth ? { width: vid.videoWidth, height: vid.videoHeight } : null);
    if (!canvas || !wrap || !source) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const v = viewRef.current;
    const drawSource = img ?? vid;
    if (!drawSource) return;

    const srcW = source.width;
    const srcH = source.height;
    // Vertical fov derived from horizontal fov + aspect.
    const vfov = v.fov * (h / w);
    const srcStripH = (vfov / Math.PI) * srcH;
    const srcCenterY = ((0.5 - v.pitch / Math.PI) * srcH - srcStripH / 2 + srcH * 3) % srcH;

    for (let x = 0; x < w; x += STRIP) {
      const angle = v.yaw + (x / w - 0.5) * v.fov;
      const u = (((angle / (2 * Math.PI)) % 1) + 1) % 1;
      const srcX = u * srcW;
      const srcStripW = (STRIP / w) * (v.fov / (2 * Math.PI)) * srcW;
      if (srcX + srcStripW <= srcW) {
        ctx.drawImage(drawSource as CanvasImageSource, srcX, srcCenterY, srcStripW, srcStripH, x, 0, STRIP, h);
      } else {
        // Wrap across the seam.
        const first = srcW - srcX;
        const frac = first / srcStripW;
        ctx.drawImage(drawSource as CanvasImageSource, srcX, srcCenterY, first, srcStripH, x, 0, STRIP * frac, h);
        ctx.drawImage(
          drawSource as CanvasImageSource,
          0, srcCenterY, srcStripW - first, srcStripH,
          x + STRIP * frac, 0, STRIP * (1 - frac), h,
        );
      }
    }
  }, []);

  // Render loop (needed for video frames + inertia).
  useEffect(() => {
    const loop = () => {
      const v = viewRef.current;
      if (!v.dragging && Math.abs(v.vel) > 0.0002) {
        v.yaw += v.vel;
        v.vel *= 0.94;
      }
      render();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    const onResize = () => render();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [render, src]);

  // Pointer: drag to pan.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const v = viewRef.current;
    const down = (e: PointerEvent) => {
      v.dragging = true;
      v.lastX = e.clientX;
      v.lastY = e.clientY;
      v.vel = 0;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!v.dragging) return;
      const dx = e.clientX - v.lastX;
      const dy = e.clientY - v.lastY;
      v.lastX = e.clientX;
      v.lastY = e.clientY;
      const rect = el.getBoundingClientRect();
      const dYaw = -(dx / rect.width) * v.fov;
      const dPitch = -(dy / rect.height) * v.fov * (rect.height / rect.width);
      v.yaw += dYaw;
      v.pitch = Math.max(-1.2, Math.min(1.2, v.pitch + dPitch));
      v.vel = dYaw;
    };
    const up = () => {
      v.dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      v.fov = Math.max(MIN_FOV, Math.min(MAX_FOV, v.fov * (1 + e.deltaY * 0.001)));
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [src]);

  const toggleVideo = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.muted = false;
      void vid.play().then(() => setVideoPlaying(true)).catch(() => setVideoPlaying(false));
    } else {
      vid.pause();
      setVideoPlaying(false);
    }
  };

  if (failed) {
    return (
      <div className="lib-error" role="alert">
        <p>{labels.failed}</p>
        <button
          type="button"
          className="lib-btn"
          onClick={() => {
            setFailed(false);
            setSrc(null);
            resolveStreamUrl(itemId)
              .then(setSrc)
              .catch(() => setFailed(true));
          }}
        >
          {labels.retry}
        </button>
      </div>
    );
  }

  return (
    <div className="lib-pano">
      <div
        ref={wrapRef}
        className="lib-pano-viewport"
        role="application"
        aria-label={`${title} — ${labels.dragHint}`}
        tabIndex={0}
        onKeyDown={(e) => {
          const v = viewRef.current;
          const step = v.fov / 12;
          if (e.key === 'ArrowLeft') v.yaw += step;
          else if (e.key === 'ArrowRight') v.yaw -= step;
          else if (e.key === 'ArrowUp') v.pitch = Math.min(1.2, v.pitch + step / 2);
          else if (e.key === 'ArrowDown') v.pitch = Math.max(-1.2, v.pitch - step / 2);
          else return;
          e.preventDefault();
        }}
      >
        <canvas ref={canvasRef} className="lib-pano-canvas" />
        {!src && (
          <p className="lib-status lib-pano-loading" role="status">
            {labels.loading}
          </p>
        )}
        {isVideo && (
          <button type="button" className="lib-pano-play" onClick={toggleVideo} aria-label={videoPlaying ? labels.pause : labels.play}>
            {videoPlaying ? '❚❚' : '▶'}
          </button>
        )}
      </div>
      <div className="lib-pano-meta">
        <p className="lib-pano-hint">{labels.dragHint}</p>
        <p className="lib-pano-proj">
          {labels.projectionLabel}: <span dir="ltr">{projection || 'equirectangular'}</span>
        </p>
        <p className="lib-pano-note">{isVideo ? labels.videoNote : labels.deviceNote}</p>
      </div>
    </div>
  );
}
