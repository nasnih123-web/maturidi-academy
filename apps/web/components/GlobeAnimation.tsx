'use client';

import { useEffect, useRef } from 'react';

import { WORLD_LAND } from '@/lib/world-countries';

/**
 * GlobeAnimation — the homepage اماکن slot's animated globe.
 *
 * Pure canvas: no tiles, no worker, no network, nothing that can
 * come back black (it replaced the PR #77 live mini-globe, which
 * rendered as a black box on the deployed homepage). It cycles
 * through six stylised globe models in the language of the owner's
 * reference screenshots — glowing spheres with dots, arcs and orbit
 * rings on a transparent ground — never a map tile.
 *
 * Countries revision: the graticule wireframe is GONE. The sphere
 * now carries the real map of the countries — land polygons from
 * world-atlas countries-110m, simplified to ~1° (Douglas-Peucker),
 * antimeridian-split, Antarctica excluded (not a country), 152
 * polygons / 206 rings / ~23 KB — projected orthographically with
 * the same rotation as the dots and arcs, clipped to the sphere.
 * One engine, six palettes/decorations; models crossfade every few
 * seconds. Respects prefers-reduced-motion (one static frame, no
 * loop). Decorative only: the section heading and the link beside
 * it carry the meaning, so the canvas is aria-hidden.
 */

interface GlobeModel {
  /** Sphere gradient: rim → lit centre (the ocean). */
  sphere: [string, string];
  /** Outer glow colour. */
  glow: string;
  /** Land fill colour. */
  land: string;
  /** Land outline colour. */
  landStroke: string;
  /** Surface dot colour. */
  dot: string;
  /** Arc stroke colour. */
  arc: string;
  /** Orbit rings: colour + tilt in radians. Empty = no rings. */
  rings: { color: string; tilt: number }[];
  /** Surface dot count and arc count. */
  dots: number;
  arcs: number;
}

const MODELS: GlobeModel[] = [
  {
    // Neon network (blue/cyan, dense dots + arcs).
    sphere: ['#0e7490', '#38bdf8'],
    glow: 'rgba(56, 189, 248, 0.55)',
    land: 'rgba(165, 243, 252, 0.9)',
    landStroke: 'rgba(34, 211, 238, 0.5)',
    dot: '#a5f3fc',
    arc: 'rgba(34, 211, 238, 0.85)',
    rings: [],
    dots: 90,
    arcs: 5,
  },
  {
    // Circuit copper (amber on dark, sparser dots).
    sphere: ['#92400e', '#f59e0b'],
    glow: 'rgba(245, 158, 11, 0.5)',
    land: 'rgba(253, 230, 138, 0.9)',
    landStroke: 'rgba(251, 191, 36, 0.5)',
    dot: '#fde68a',
    arc: 'rgba(251, 191, 36, 0.8)',
    rings: [],
    dots: 60,
    arcs: 3,
  },
  {
    // Holographic rings (cyan + magenta tilted orbits).
    sphere: ['#155e75', '#22d3ee'],
    glow: 'rgba(34, 211, 238, 0.5)',
    land: 'rgba(207, 250, 254, 0.9)',
    landStroke: 'rgba(34, 211, 238, 0.5)',
    dot: '#cffafe',
    arc: 'rgba(232, 121, 249, 0.85)',
    rings: [
      { color: 'rgba(34, 211, 238, 0.9)', tilt: -0.42 },
      { color: 'rgba(232, 121, 249, 0.9)', tilt: 0.38 },
    ],
    dots: 45,
    arcs: 2,
  },
  {
    // Golden lamp globe (warm amber glow).
    sphere: ['#78350f', '#fbbf24'],
    glow: 'rgba(251, 191, 36, 0.55)',
    land: 'rgba(254, 243, 199, 0.9)',
    landStroke: 'rgba(251, 191, 36, 0.5)',
    dot: '#fef3c7',
    arc: 'rgba(253, 224, 71, 0.8)',
    rings: [],
    dots: 60,
    arcs: 3,
  },
  {
    // Ice digital (pale blue on deep navy).
    sphere: ['#0c4a6e', '#bae6fd'],
    glow: 'rgba(186, 230, 253, 0.5)',
    land: 'rgba(240, 249, 255, 0.92)',
    landStroke: 'rgba(125, 211, 252, 0.5)',
    dot: '#f0f9ff',
    arc: 'rgba(125, 211, 252, 0.85)',
    rings: [],
    dots: 90,
    arcs: 4,
  },
  {
    // Pink data rings (magenta/cyan orbits).
    sphere: ['#701a75', '#e879f9'],
    glow: 'rgba(232, 121, 249, 0.5)',
    land: 'rgba(253, 244, 255, 0.9)',
    landStroke: 'rgba(232, 121, 249, 0.5)',
    dot: '#fdf4ff',
    arc: 'rgba(34, 211, 238, 0.85)',
    rings: [{ color: 'rgba(232, 121, 249, 0.9)', tilt: -0.3 }],
    dots: 60,
    arcs: 5,
  },
];

/** Deterministic pseudo-random in [0, 1) from an integer seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Dot {
  lat: number;
  lng: number;
  r: number;
}

interface Arc {
  a: number;
  b: number;
}

const SIZE = 480;
const MODEL_MS = 5000;
const FADE_MS = 900;
const TURN_MS = 30000;

export function GlobeAnimation() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const g: CanvasRenderingContext2D = ctx;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Per-model deterministic dot/arc layouts (same every render).
    const layouts = MODELS.map((m, i) => {
      const rnd = mulberry32(1234 + i * 77);
      const dots: Dot[] = [];
      for (let k = 0; k < m.dots; k++) {
        dots.push({ lat: (rnd() * 2 - 1) * 1.25, lng: rnd() * Math.PI * 2, r: 1.2 + rnd() * 1.8 });
      }
      const arcs: Arc[] = [];
      for (let k = 0; k < m.arcs; k++) {
        arcs.push({ a: Math.floor(rnd() * dots.length), b: Math.floor(rnd() * dots.length) });
      }
      return { dots, arcs };
    });

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const R = SIZE * 0.36;

    /** Orthographic projection of a lng/lat point at rotation theta. */
    function project(lng: number, lat: number, theta: number): { x: number; y: number; front: number } | null {
      const lon = ((lng * Math.PI) / 180 + theta) % (Math.PI * 2);
      const la = (lat * Math.PI) / 180;
      const z = Math.cos(la) * Math.cos(lon);
      if (z <= 0) return null;
      return { x: cx + R * Math.cos(la) * Math.sin(lon), y: cy - R * Math.sin(la), front: z };
    }

    function drawScene(model: GlobeModel, layout: (typeof layouts)[number], theta: number, time: number, alpha: number): void {
      g.save();
      g.globalAlpha = alpha;
      // No ground fill: the canvas stays transparent so the page
      // background shows through around the sphere (owner request).
      // Glow.
      g.save();
      g.shadowColor = model.glow;
      g.shadowBlur = 42;
      g.fillStyle = model.sphere[0];
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();
      g.restore();
      // Sphere body, lit from the top-left (the ocean).
      const sphere = g.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
      sphere.addColorStop(0, model.sphere[1]);
      sphere.addColorStop(1, model.sphere[0]);
      g.fillStyle = sphere;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();
      // Land polygons, clipped to the sphere. Behind-limb points
      // break the path (pen up) so nothing draws across the far side.
      g.save();
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.clip();
      for (const poly of WORLD_LAND) {
        const path = new Path2D();
        for (const ring of poly) {
          let penDown = false;
          for (const [lng, lat] of ring) {
            const p = project(lng, lat, theta);
            if (!p) {
              penDown = false;
              continue;
            }
            if (!penDown) {
              path.moveTo(p.x, p.y);
              penDown = true;
            } else {
              path.lineTo(p.x, p.y);
            }
          }
          // No closePath: fill auto-closes each visible stretch, and
          // stroke then shows only true coastline segments, never a
          // chord across a hidden gap or an antimeridian cut.
        }
        g.fillStyle = model.land;
        g.fill(path, 'evenodd');
        g.strokeStyle = model.landStroke;
        g.lineWidth = 1;
        g.stroke(path);
      }
      // Surface dots (front side only, brighter toward the centre).
      for (const d of layout.dots) {
        const p = project((d.lng * 180) / Math.PI, (d.lat * 180) / Math.PI, theta);
        if (!p) continue;
        g.globalAlpha = alpha * (0.35 + 0.65 * p.front);
        g.fillStyle = model.dot;
        g.beginPath();
        g.arc(p.x, p.y, d.r * (0.6 + 0.4 * p.front), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = alpha;
      // Arcs between dot pairs, with a travelling dash for data flow.
      g.strokeStyle = model.arc;
      g.lineWidth = 1.4;
      g.setLineDash([7, 9]);
      g.lineDashOffset = -time * 0.03;
      for (const arc of layout.arcs) {
        const a = project((layout.dots[arc.a].lng * 180) / Math.PI, (layout.dots[arc.a].lat * 180) / Math.PI, theta);
        const b = project((layout.dots[arc.b].lng * 180) / Math.PI, (layout.dots[arc.b].lat * 180) / Math.PI, theta);
        if (!a || !b) continue;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 - R * 0.35;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.quadraticCurveTo(mx, my, b.x, b.y);
        g.stroke();
      }
      g.setLineDash([]);
      g.restore();
      // Orbit rings + travelling satellite dots (drawn over the limb).
      for (const ring of model.rings) {
        g.save();
        g.translate(cx, cy);
        g.rotate(ring.tilt);
        g.strokeStyle = ring.color;
        g.lineWidth = 2;
        g.globalAlpha = alpha * 0.9;
        g.beginPath();
        g.ellipse(0, 0, R * 1.32, R * 0.42, 0, 0, Math.PI * 2);
        g.stroke();
        const t = (time * 0.0002) % (Math.PI * 2);
        const sx = Math.cos(t) * R * 1.32;
        const sy = Math.sin(t) * R * 0.42;
        g.fillStyle = ring.color;
        g.beginPath();
        g.arc(sx, sy, 4, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.restore();
    }

    let raf = 0;
    const start = performance.now();
    const frame = (now: number): void => {
      const t = now - start;
      const theta = (t / TURN_MS) * Math.PI * 2;
      const cycle = t % (MODEL_MS * MODELS.length);
      const idx = Math.floor(cycle / MODEL_MS);
      const into = cycle % MODEL_MS;
      g.clearRect(0, 0, SIZE, SIZE);
      if (into < FADE_MS) {
        const prev = (idx + MODELS.length - 1) % MODELS.length;
        drawScene(MODELS[prev], layouts[prev], theta, t, 1);
        drawScene(MODELS[idx], layouts[idx], theta, t, into / FADE_MS);
      } else {
        drawScene(MODELS[idx], layouts[idx], theta, t, 1);
      }
      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      drawScene(MODELS[0], layouts[0], 0.6, 0, 1);
    } else {
      raf = requestAnimationFrame(frame);
    }
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="globe-anim-frame" aria-hidden>
      <canvas ref={canvasRef} width={SIZE} height={SIZE} className="globe-anim-canvas" />
    </div>
  );
}
