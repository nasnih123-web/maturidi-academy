import React from "react";

/**
 * KPI tile with 3D tilt + cursor-following glow, ported from the turbo CRM
 * visual system. Purely presentational: `label`/`value` are caller-supplied
 * strings (already localized); the optional `spark` series is rendered only
 * when the caller passes real data — never invented here.
 */

/** Miniature sparkline — no dependencies. */
export function Sparkline({
  values,
  color,
}: {
  values: number[];
  color: string;
}): React.ReactElement | null {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (v / max) * 26}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="spark" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

export function KpiTile({
  label,
  value,
  spark,
  accent,
}: {
  label: string;
  value: string;
  spark?: number[];
  accent: string;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent): void => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const rx = ((e.clientY - r.top) / r.height - 0.5) * -7;
    const ry = ((e.clientX - r.left) / r.width - 0.5) * 7;
    el.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    el.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  };

  const onLeave = (): void => {
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} className="kpi-tile">
      <span className="kpi-glow" aria-hidden="true" />
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {spark && spark.length >= 2 && (
        <span style={{ color: accent, display: "block" }}>
          <Sparkline values={spark} color={accent} />
        </span>
      )}
    </div>
  );
}
