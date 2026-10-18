"use client";

/**
 * ExperienceBackground — چندلایه، زنده (MP v10 §۸).
 * GeometryLayer + AmbientLightLayer + ParticleLayer + MotionLayer.
 * performance-aware: particle count از density؛ prefers-reduced-motion رعایت.
 */
import { useEffect, useMemo, useRef } from "react";
import { GEOMETRY_RENDERERS } from "@maturidi/design-tokens/geometry";

export interface BackgroundConfig {
  geometry_variant?: string;
  pattern_opacity?: number;
  glow_strength?: number;
  particle_density?: number;
  motion_intensity?: number;
}

export function ExperienceBackground({ config = {} }: { config?: BackgroundConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const density = config.particle_density ?? 0.5;
  const intensity = config.motion_intensity ?? 1;
  const geometry = config.geometry_variant ?? "star8";
  const patternOpacity = config.pattern_opacity ?? 0.06;
  const glow = config.glow_strength ?? 0.6;

  const patternSvg = useMemo(() => {
    const fn = GEOMETRY_RENDERERS[geometry] ?? GEOMETRY_RENDERERS.star8;
    return fn({ size: 64, color: "hsl(var(--primary))", opacity: patternOpacity });
  }, [geometry, patternOpacity]);

  const patternUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `url("data:image/svg+xml,${encodeURIComponent(patternSvg)}")`;
  }, [patternSvg]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || intensity === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const count = Math.round(14 + density * 36);
    const particles = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.8,
      vy: (0.02 + Math.random() * 0.08) * intensity,
      vx: (Math.random() - 0.5) * 0.03 * intensity,
      a: 0.15 + Math.random() * 0.35,
    }));
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    const tick = () => {
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.y -= p.vy / 60;
        p.x += p.vx / 60;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        if (p.x < -0.02) p.x = 1.02;
        if (p.x > 1.02) p.x = -0.02;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(var(--accent) / ${p.a * 0.55})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [density, intensity]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
      <span
        className="absolute inset-0"
        style={{ backgroundImage: patternUrl, backgroundSize: "128px 128px" }}
      />
      <span
        className="absolute -top-32 left-1/2 h-64 w-[30rem] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: `radial-gradient(closest-side, hsl(var(--primary) / ${0.08 * glow}), transparent)` }}
      />
      <span
        className="absolute -bottom-40 right-[-6rem] h-72 w-72 rounded-full blur-3xl"
        style={{ background: `radial-gradient(closest-side, hsl(var(--accent) / ${0.07 * glow}), transparent)` }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  );
}
