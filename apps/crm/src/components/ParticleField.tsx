import React from "react";
import type { ParticlesConfig } from "../lib/appearance";

/**
 * ParticleField — configurable parallax particle layer (gold dust +
 * constellation lines), adapted from the web's AtmosphericEngine and the
 * CRM's LoginParticles.
 *
 * Driven by the `particles` platform setting ({enabled, count, speed,
 * parallax, lines}). Purely presentational: no backend calls, no business
 * logic. Honors prefers-reduced-motion (renders nothing) and pauses when
 * the tab is hidden. Non-interactive: pointer-events are disabled so it
 * never steals clicks.
 */
export function ParticleField({
  config,
  className,
  density = 1,
}: {
  config: ParticlesConfig;
  className?: string;
  /** Scale the particle count (e.g. 0.5 for a subtle shell background). */
  density?: number;
}): React.ReactElement | null {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const cfgRef = React.useRef({ config, density });
  cfgRef.current = { config, density };

  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  React.useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(canvas.offsetWidth * dpr);
      canvas.height = Math.floor(canvas.offsetHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const spawn = () => ({
      x: Math.random(),
      y: Math.random(),
      depth: 0.25 + Math.random() * 0.75,
      vx: (Math.random() - 0.5) * 0.0004,
      vy: -0.0002 - Math.random() * 0.0004,
      r: 0.7 + Math.random() * 1.9,
      a: 0.22 + Math.random() * 0.5,
    });

    let particles = Array.from({ length: count() }, spawn);

    function count(): number {
      const c = cfgRef.current;
      return Math.max(
        0,
        Math.min(400, Math.round(c.config.count * c.density)),
      );
    }

    const onMove = (e: PointerEvent): void => {
      mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    const onVis = (): void => {
      running = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);

    const tick = (): void => {
      if (!running) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const { config: cfg } = cfgRef.current;
      const want = count();
      if (particles.length !== want) {
        particles =
          particles.length < want
            ? particles.concat(Array.from({ length: want - particles.length }, spawn))
            : particles.slice(0, want);
      }

      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;
      const PARALLAX = cfg.parallax;
      const SPEED = cfg.speed;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx * SPEED;
        p.y += p.vy * SPEED;
        if (p.y < -0.02) {
          p.y = 1.02;
          p.x = Math.random();
        }
        if (p.x < -0.02) p.x = 1.02;
        if (p.x > 1.02) p.x = -0.02;
        const px = (p.x + mouse.x * PARALLAX * p.depth) * w;
        const py = (p.y + mouse.y * PARALLAX * p.depth) * h;
        ctx.beginPath();
        ctx.arc(px, py, p.r * (0.55 + p.depth), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(229, 192, 123, ${(p.a * (0.4 + p.depth * 0.6)).toFixed(2)})`;
        ctx.fill();
      }

      if (cfg.lines) {
        ctx.lineWidth = 0.6;
        for (let i = 0; i < particles.length; i++) {
          const a = particles[i];
          const ax = (a.x + mouse.x * PARALLAX * a.depth) * w;
          const ay = (a.y + mouse.y * PARALLAX * a.depth) * h;
          for (let j = i + 1; j < particles.length; j++) {
            const b = particles[j];
            const bx = (b.x + mouse.x * PARALLAX * b.depth) * w;
            const by = (b.y + mouse.y * PARALLAX * b.depth) * h;
            const dx = ax - bx;
            const dy = ay - by;
            const d2 = dx * dx + dy * dy;
            if (d2 < 16900) {
              const o = 0.15 * (1 - Math.sqrt(d2) / 130);
              ctx.strokeStyle = `rgba(212, 175, 55, ${o.toFixed(3)})`;
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.stroke();
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reducedMotion]);

  if (reducedMotion || !config.enabled) return null;

  return (
    <div className={className ?? "particle-field"} aria-hidden="true">
      <canvas ref={canvasRef} className="particle-canvas" />
    </div>
  );
}
