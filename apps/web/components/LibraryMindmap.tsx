'use client';

/**
 * LibraryMindmap — SVG tree renderer for mindmap items.
 *
 * Input: a simple {label, children} JSON tree (from the item's `mindmap`
 * field; callers may synthesize one from chapters). Layout is a small
 * tidy-tree pass: subtree width from leaf count, depth for the y axis.
 * Graceful empty state when there is nothing to draw.
 */
import { useMemo } from 'react';
import type { MindmapNode } from '@/lib/library';

export interface LibraryMindmapLabels {
  empty: string;
  emptyHint: string;
  expandAria: string;
  collapseAria: string;
}

const NODE_W = 190;
const NODE_H = 52;
const LEVEL_H = 110;
const LEAF_GAP = 26;

interface Placed {
  node: MindmapNode;
  x: number; // center
  y: number; // top
  depth: number;
  children: Placed[];
}

function leafCount(n: MindmapNode): number {
  if (!n.children || n.children.length === 0) return 1;
  return n.children.reduce((a, c) => a + leafCount(c), 0);
}

function place(node: MindmapNode, depth: number, left: number): Placed {
  const kids = node.children ?? [];
  const children: Placed[] = [];
  let cursor = left;
  for (const k of kids) {
    const w = leafCount(k) * (NODE_W + LEAF_GAP);
    children.push(place(k, depth + 1, cursor));
    cursor += w;
  }
  const totalW = Math.max(leafCount(node) * (NODE_W + LEAF_GAP), NODE_W + LEAF_GAP);
  const x = kids.length === 0 ? left + (NODE_W + LEAF_GAP) / 2 : (children[0].x + children[children.length - 1].x) / 2;
  return { node, x, y: depth * LEVEL_H + 20, depth, children, totalW: totalW } as Placed & { totalW: number };
}

function maxDepth(p: Placed): number {
  return p.children.reduce((m, c) => Math.max(m, maxDepth(c)), p.depth);
}

function flatten(p: Placed, out: Placed[] = []): Placed[] {
  out.push(p);
  for (const c of p.children) flatten(c, out);
  return out;
}

export function LibraryMindmap({ root, labels }: { root: MindmapNode | null; labels: LibraryMindmapLabels }) {
  const placed = useMemo(() => (root ? place(root, 0, 0) : null), [root]);

  if (!placed) {
    return (
      <div className="lib-mindmap-empty" role="status">
        <p className="lib-mindmap-empty-title">{labels.empty}</p>
        <p>{labels.emptyHint}</p>
      </div>
    );
  }

  const nodes = flatten(placed);
  const width = Math.max(...nodes.map((n) => n.x)) + NODE_W / 2 + 20;
  const height = (maxDepth(placed) + 1) * LEVEL_H + 40;

  const edges: { d: string; key: string }[] = [];
  for (const n of nodes) {
    for (const c of n.children) {
      const x1 = n.x;
      const y1 = n.y + NODE_H;
      const x2 = c.x;
      const y2 = c.y;
      const my = (y1 + y2) / 2;
      edges.push({
        key: `${x1}-${y1}-${x2}-${y2}`,
        d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`,
      });
    }
  }

  return (
    <div className="lib-mindmap" role="img" aria-label={root?.label ?? ''}>
      <svg viewBox={`0 0 ${width} ${height}`} className="lib-mindmap-svg">
        {edges.map((e) => (
          <path key={e.key} d={e.d} className="lib-mindmap-edge" fill="none" />
        ))}
        {nodes.map((n, i) => (
          <g key={i} transform={`translate(${n.x - NODE_W / 2}, ${n.y})`}>
            <rect width={NODE_W} height={NODE_H} rx={10} className={`lib-mindmap-node${n.depth === 0 ? ' lib-mindmap-root' : ''}`} />
            <foreignObject width={NODE_W} height={NODE_H}>
              <div className="lib-mindmap-label">
                <span>{n.node.label}</span>
              </div>
            </foreignObject>
          </g>
        ))}
      </svg>
    </div>
  );
}
