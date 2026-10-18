import React from "react";
import { useParticlesConfig } from "../lib/appearance";
import { ParticleField } from "./ParticleField";

/**
 * Login background: ambient orbs + the configurable particle field
 * (gold dust + constellation lines + pointer parallax), driven by the
 * `particles` platform setting. Purely presentational (no backend, no
 * business logic). Honors prefers-reduced-motion and pauses when the
 * tab is hidden (handled inside ParticleField).
 */

const ORBS = [
  { color: "#054432", size: 620, top: "-14%", left: "-10%", phase: 0 },
  { color: "#785412", size: 540, top: "44%", left: "60%", phase: 1.8 },
  { color: "#033036", size: 560, top: "60%", left: "10%", phase: 3.4 },
];

export function LoginParticles(): React.ReactElement {
  const config = useParticlesConfig();

  return (
    <div className="login-atmosphere" aria-hidden="true">
      {ORBS.map((o, i) => (
        <span
          key={i}
          className="orb"
          style={{
            width: o.size,
            height: o.size,
            top: o.top,
            left: o.left,
            background: o.color,
            animationDelay: `${o.phase}s`,
          }}
        />
      ))}
      <ParticleField config={config} className="login-particles-wrap" />
    </div>
  );
}
