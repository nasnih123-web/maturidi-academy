/**
 * hifz-study/HifzErrorsIcon: the errors feature icon (2026-11-08) —
 * Tarteel's green head-with-check (the errors sheet empty state,
 * user reference image 1000143367_0_yhbp.jpg). A green circle with
 * a white head-and-shoulders silhouette and a dark-green check
 * badge. Single source for the bottom-bar errors button and the
 * errors sheet empty state, so both stay identical. Drawn as plain
 * SVG (no asset) so it renders at any size, 20px button to 120px
 * empty-state illustration.
 */
export function ErrorsHeadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#22c55e" />
      <circle cx="10.5" cy="9.5" r="3.5" fill="#ffffff" />
      <path d="M4 19.5c.7-3.2 3.1-5 6.5-5s5.8 1.8 6.5 5z" fill="#ffffff" />
      <circle cx="17.2" cy="16.8" r="4" fill="#15803d" />
      <path
        d="M15.4 16.8l1.3 1.3 2.4-2.7"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
