// PageFlip — a real 3D page-turn leaf, shared by the hifz study page
// (mushaf mode) and the general Quran reader (user 2026-11-22,
// confirmed: real 3D flip, buttons + finger drag, right-to-left for
// the next page, same flip in both sections).
//
// The scene stacks two layers in one grid cell: the incoming page
// underneath (live render, or blank paper while a drag is still
// fetching it) and the outgoing page on a leaf that rotates around
// the page edge. The leaf has two faces: its front is the frozen
// outgoing page, its back is plain paper, so past 90 degrees the
// viewer sees the back of the turning page, like a real book.
//
// Direction (confirmed by the user): the NEXT page sweeps
// right-to-left — the leaf rotates around its left edge and its
// free right edge swings over to the left. The PREVIOUS page sweeps
// left-to-right, around its right edge.
//
// The component is purely presentational: the parent owns the flip
// state (which pages, which progress) and decides when a flip
// starts, commits, or springs back. `animated` false means the leaf
// follows the finger directly (no transition); true means the leaf
// transitions to the given progress (button flip, settle, spring-back).
import type { ReactNode } from 'react';

export type PageFlipDirection = 'ltr' | 'rtl';

/** Button-flip duration: a real page turn, unhurried but not slow. */
export const FLIP_DURATION_MS = 550;

/** Drag progress past this commits the turn on release. */
export const FLIP_DRAG_COMMIT = 0.3;

/** A finger alone never turns the page fully; the commit animates the rest. */
export const FLIP_DRAG_MAX = 0.9;

/** Drag distance in px before a touch becomes a page-turn drag. */
export const FLIP_DRAG_START_PX = 10;

/** Next page (+1) sweeps right-to-left; previous page (-1) left-to-right. */
export function flipDirectionForDelta(delta: 1 | -1): PageFlipDirection {
  return delta === 1 ? 'rtl' : 'ltr';
}

/** True when the user asked the system to reduce motion: no flip, instant swap. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface PageFlipProps {
  /** Outgoing page, frozen at the moment the flip started. */
  from: ReactNode;
  /** Incoming page (live render), or null while a drag still fetches it (blank paper). */
  to: ReactNode;
  direction: PageFlipDirection;
  /** 0 = closed (old page fully visible), 1 = fully turned. */
  progress: number;
  /** True: transition the leaf to `progress`. False: follow the finger directly. */
  animated: boolean;
  durationMs?: number;
  onTransitionEnd?: () => void;
  className?: string;
  /** Paper colour of the leaf's back (hifz #F9F7F8, reader #f7f1dd). */
  paper?: string;
}

export function PageFlip({
  from,
  to,
  direction,
  progress,
  animated,
  durationMs = FLIP_DURATION_MS,
  onTransitionEnd,
  className,
  paper = '#F9F7F8',
}: PageFlipProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  const angle = direction === 'ltr' ? clamped * 180 : -clamped * 180;
  // The spine shadow on the incoming page: strongest mid-turn, gone at both ends.
  const shadeOpacity = Math.sin(clamped * Math.PI) * 0.35;
  return (
    <div
      className={`page-flip-scene${className ? ` ${className}` : ''}`}
      style={{ '--page-flip-paper': paper } as React.CSSProperties}
    >
      <div className="page-flip-to">{to}</div>
      <div
        className="page-flip-shade"
        data-direction={direction}
        style={{ opacity: shadeOpacity }}
        aria-hidden="true"
      />
      <div
        className="page-flip-leaf"
        data-direction={direction}
        style={{
          transform: `rotateY(${angle}deg)`,
          transitionDuration: animated ? `${durationMs}ms` : '0ms',
        }}
        onTransitionEnd={onTransitionEnd}
      >
        <div className="page-flip-face page-flip-face--front">{from}</div>
        <div className="page-flip-face page-flip-face--back" aria-hidden="true" />
      </div>
    </div>
  );
}
