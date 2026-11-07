/**
 * hifz-study/HifzRosette: pure SVG presentational components moved
 * verbatim from components/QuranHifzStudy.tsx (hifz-completion
 * refactor step 3) — no behavioral or visual change.
 *
 * NOT unified with AyahRosette (QuranMushafPage) / V2Rosette
 * (QuranMushafV2Page): those are a double-ring + rotated square on a
 * 40x40 viewBox, while HifzRosette is an 8-petal ring on a 48x48
 * viewBox with different stroke/text metrics. Unifying them would be
 * a visible mushaf change, not a move — a separate decision with
 * user-confirmed pixel comparison.
 */

/** Simple microphone glyph for the floating 3D record button. */
export function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="hifz-mic-icon">
      <rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5 10a7 7 0 0 0 14 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 17v3M8.5 20.5h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Ayah-end marker as an ornate rosette (own SVG, like the printed
    mushaf): an 8-petal ring with a small knob on top and the ayah
    number inside. Replaces the old plain double-ring circle. */
export function HifzRosette({ digit }: { digit: string }) {
  return (
    <span className="hifz-line-marker" aria-hidden="true">
      <svg viewBox="0 0 48 48" role="presentation" focusable="false">
        <g fill="none" stroke="#8a8378" strokeWidth="1.6">
          <circle cx="24" cy="24" r="14" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path
              key={a}
              d="M24 4.5 L26.8 9.5 L24 12.5 L21.2 9.5 Z"
              transform={`rotate(${a} 24 24)`}
            />
          ))}
          <circle cx="24" cy="2.5" r="1.4" />
        </g>
        <text x="24" y="29.5" textAnchor="middle" fontSize="15" fill="#57534e">
          {digit}
        </text>
      </svg>
    </span>
  );
}
