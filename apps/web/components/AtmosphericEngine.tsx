"use client";

/**
 * Atmospheric Engine v2 — الحاقیهٔ سیستم بصری §۲.
 * ۳ گوی محیطی (blur 140px، پالس فازدار) + موتور ذرات (غبار نورانی،
 * دافعهٔ آنتی‌گریویتی نشانگر + خطوط صورت‌فلکی طلایی <120px).
 * Perf: 60fps rAF، pause-on-hidden، کاهش در موبایل، reduced-motion خاموش.
 *
 * The particle system is driven by the `particles` platform_settings key
 * (issue #7): `enabled` / `count` / `speed` / `parallax` / `lines` arrive
 * from the layout via props (settings are fetched per request, so a CRM
 * change is visible on the next page request). `enabled: false` disables
 * the particle canvas; the ambient orbs stay.
 */
import { useEffect, useRef } from "react";
import type { ParticlesSettings } from "@/lib/settings";

const ORBS = [
  { color: "#054432", size: 620, top: "-12%", left: "-8%", phase: 0 },
  { color: "#785412", size: 540, top: "42%", left: "58%", phase: 1.8 },
  { color: "#033036", size: 560, top: "58%", left: "12%", phase: 3.4 },
];

export function AtmosphericEngine({ config }: { config: ParticlesSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cfgRef = useRef(config);
  cfgRef.current = config;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const isMobile = window.innerWidth < 768;
    const cfg = cfgRef.current;
    const count = Math.min(cfg.count, isMobile ? 30 : 400);
    const R = cfg.parallax * 160;
    const speed = cfg.speed;
    const linesOn = cfg.lines;
    const mouse = { x: -9999, y: -9999 };

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0004,
      vy: -0.0002 - Math.random() * 0.0004,
      r: 0.7 + Math.random() * 1.7,
      a: 0.25 + Math.random() * 0.5,
    }));

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left) / rect.width;
      mouse.y = (e.clientY - rect.top) / rect.height;
    };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    if (R > 0) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerleave", onLeave);
    }
    const onVis = () => { running = document.visibilityState === "visible"; };
    document.addEventListener("visibilitychange", onVis);

    const tick = () => {
      if (!running) { raf = requestAnimationFrame(tick); return; }
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // physics
      for (const p of particles) {
        // دافعهٔ نشانگر (فضای نرمال‌شده) — فقط وقتی parallax روشن است
        if (R > 0 && mouse.x > -1) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          const rN = R / w;
          if (d2 < rN * rN && d2 > 0.000001) {
            const d = Math.sqrt(d2);
            const f = ((rN - d) / rN) * 0.0022 * speed;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
          }
        }
        p.vx *= 0.985; p.vy *= 0.985;
        p.vy -= 0.0000025 * speed; // شتاب ملایم رو به بالا (غبار معلق)
        p.x += p.vx * speed; p.y += p.vy * speed;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); p.vx = 0; p.vy = -0.0002 - Math.random() * 0.0004; }
        if (p.x < -0.02) p.x = 1.02;
        if (p.x > 1.02) p.x = -0.02;
      }

      // constellation lines — طلایی بسیار ظریف (قابل خاموش‌شدن از تنظیمات)
      const maxD = 120;
      if (linesOn) {
        ctx.lineWidth = 0.6;
        for (let i = 0; i < particles.length; i++) {
          const a = particles[i];
          for (let j = i + 1; j < particles.length; j++) {
            const b = particles[j];
            const dx = (a.x - b.x) * w, dy = (a.y - b.y) * h;
            const d2 = dx * dx + dy * dy;
            if (d2 < maxD * maxD) {
              const o = 0.15 * (1 - Math.sqrt(d2) / maxD);
              ctx.strokeStyle = `rgba(212, 175, 55, ${o.toFixed(3)})`;
              ctx.beginPath();
              ctx.moveTo(a.x * w, a.y * h);
              ctx.lineTo(b.x * w, b.y * h);
              ctx.stroke();
            }
          }
        }
      }

      // dust
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(229, 192, 123, ${p.a.toFixed(2)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      if (R > 0) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerleave", onLeave);
      }
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // `enabled: false` disables the particle canvas; the ambient orbs stay.
  const particlesOn = cfgRef.current.enabled;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* سه گوی محیطی — blur 140px، پالس فازدار */}
      {ORBS.map((o, i) => (
        <span
          key={i}
          className="absolute rounded-full orb"
          style={{
            width: o.size, height: o.size, top: o.top, left: o.left,
            background: o.color, filter: "blur(140px)", opacity: 0.18,
            animationDelay: `${o.phase}s`,
          }}
        />
      ))}
      {particlesOn ? <canvas ref={canvasRef} className="absolute inset-0 size-full" /> : null}
    </div>
  );
}
