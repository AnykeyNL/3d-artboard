// Board outline and the grid of tile footprints clipped to it.
import { DesignParams } from './params';
import { Polygon, Vec2, area, centroid, clipConvex, ensureCCW, insetConvex } from './geometry';

/** Board outline, centred on the origin. All four shapes are convex. */
export function outlinePolygon(p: DesignParams, segments = 128): Polygon {
  const w = p.width / 2;
  const h = p.height / 2;
  switch (p.outline) {
    case 'square':
      return [
        [-w, -h],
        [w, -h],
        [w, h],
        [-w, h],
      ];
    case 'rounded': {
      const r = Math.max(0, Math.min(p.cornerRadius, w, h));
      if (r < 0.01) return outlinePolygon({ ...p, outline: 'square' });
      const per = Math.max(4, Math.round(segments / 4));
      const pts: Polygon = [];
      const corners: [number, number, number][] = [
        [w - r, -h + r, -Math.PI / 2],
        [w - r, h - r, 0],
        [-w + r, h - r, Math.PI / 2],
        [-w + r, -h + r, Math.PI],
      ];
      for (const [cx, cy, a0] of corners) {
        for (let i = 0; i <= per; i++) {
          const a = a0 + (i / per) * (Math.PI / 2);
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
      }
      return ensureCCW(dedupe(pts));
    }
    case 'oval':
    case 'circle': {
      const rx = p.outline === 'circle' ? Math.min(w, h) : w;
      const ry = p.outline === 'circle' ? Math.min(w, h) : h;
      const pts: Polygon = [];
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push([rx * Math.cos(a), ry * Math.sin(a)]);
      }
      return pts;
    }
  }
}

function dedupe(p: Polygon): Polygon {
  return p.filter((q, i) => {
    const r = p[(i + 1) % p.length];
    return Math.hypot(q[0] - r[0], q[1] - r[1]) > 1e-6;
  });
}

export interface Cell {
  /** Grid coordinates, used for stable per-tile randomness. */
  i: number;
  j: number;
  /** Full (unclipped) footprint. */
  full: Polygon;
  /** Footprint after clipping to the outline and shrinking by half the gap. */
  footprint: Polygon;
  center: Vec2;
  edge: boolean;
}

/** Regular footprint polygons around the origin, CCW. `size` is centre-to-centre pitch. */
function cellsFor(p: DesignParams): { i: number; j: number; poly: Polygon }[] {
  const s = p.tiles.size;
  const W = p.width / 2 + s;
  const H = p.height / 2 + s;
  const out: { i: number; j: number; poly: Polygon }[] = [];
  if (p.tiles.shape === 'square') {
    const n = Math.ceil(W / s);
    const m = Math.ceil(H / s);
    // Odd count across → centre tile on the origin; even → seam on the origin.
    const ox = (Math.round(p.width / s) % 2 === 1) ? 0 : s / 2;
    const oy = (Math.round(p.height / s) % 2 === 1) ? 0 : s / 2;
    for (let i = -n; i <= n; i++) {
      for (let j = -m; j <= m; j++) {
        const cx = i * s + ox;
        const cy = j * s + oy;
        const h = s / 2;
        out.push({ i, j, poly: [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]] });
      }
    }
  } else if (p.tiles.shape === 'hex') {
    // Pointy-top hexagons; size = distance between neighbouring centres (flat-to-flat width).
    const R = s / Math.sqrt(3); // circumradius
    const dy = 1.5 * R;
    const n = Math.ceil(W / s) + 1;
    const m = Math.ceil(H / dy) + 1;
    for (let j = -m; j <= m; j++) {
      for (let i = -n; i <= n; i++) {
        const cx = i * s + (Math.abs(j) % 2 === 1 ? s / 2 : 0);
        const cy = j * dy;
        const poly: Polygon = [];
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          poly.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
        }
        out.push({ i, j, poly });
      }
    }
  } else {
    // Equilateral triangles; size = side length.
    const th = (s * Math.sqrt(3)) / 2;
    const n = Math.ceil(W / (s / 2)) + 2;
    const m = Math.ceil(H / th) + 1;
    for (let j = -m; j <= m; j++) {
      for (let i = -n; i <= n; i++) {
        const x0 = (i * s) / 2;
        const y0 = j * th - th / 2;
        const up = (i + j) % 2 === 0;
        const poly: Polygon = up
          ? [[x0 - s / 2, y0], [x0 + s / 2, y0], [x0, y0 + th]]
          : [[x0 - s / 2, y0 + th], [x0, y0], [x0 + s / 2, y0 + th]];
        out.push({ i, j, poly: ensureCCW(poly) });
      }
    }
  }
  return out;
}

export function layoutCells(p: DesignParams, outline: Polygon): Cell[] {
  const cells: Cell[] = [];
  const outlineInset = insetConvex(outline, p.tiles.gap / 2);
  for (const { i, j, poly } of cellsFor(p)) {
    const fullArea = area(poly);
    const clipped = clipConvex(poly, outlineInset);
    if (clipped.length < 3) continue;
    const footprint = insetConvex(clipped, p.tiles.gap / 2);
    if (footprint.length < 3) continue;
    const a = area(footprint);
    if (a < fullArea * p.tiles.minEdgeFraction) continue;
    cells.push({
      i,
      j,
      full: poly,
      footprint,
      center: centroid(footprint),
      edge: area(clipped) < fullArea - 1e-6,
    });
  }
  return cells;
}
