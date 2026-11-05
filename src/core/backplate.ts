// Split the backplate into bed-sized sections, place press-fit pins, and add
// bowtie keys that lock neighbouring sections together.
import { DesignParams, pinSpec } from './params';
import { Tile, placeKey, placeLabel } from './tile';
import { BBox, Polygon, Vec2, area, bbox, clipConvex, pointInConvex, rect } from './geometry';

export interface Section {
  id: number;
  col: number;
  row: number;
  /** Cell of the cutting grid (absolute board coords). */
  cell: BBox;
  /** Outline of this section (absolute board coords). */
  poly: Polygon;
  /** Centre pin positions (absolute). */
  pins: Vec2[];
  /** Offset key pin positions (absolute). */
  keyPins: Vec2[];
  /** Bowtie key pockets: [x, y, angleDeg] (absolute). */
  keys: [number, number, number][];
  /** Tiles whose centre lies on this section. */
  tiles: number[];
}

export const KEY = {
  length: 26,
  endWidth: 14,
  waist: 7,
  clearance: 0.15,
};

export function bowtie(): Polygon {
  const L = KEY.length / 2;
  const W = KEY.endWidth / 2;
  const w = KEY.waist / 2;
  return [
    [-L, -W],
    [0, -w],
    [L, -W],
    [L, W],
    [0, w],
    [-L, W],
  ];
}

function usable(p: DesignParams): { x: number; y: number } {
  return { x: p.printer.bedX - 2 * p.printer.margin, y: p.printer.bedY - 2 * p.printer.margin };
}

/**
 * Choose cut positions along one axis. Cuts are spread evenly, then nudged so
 * they stay clear of pins (which must not straddle a seam).
 */
function chooseCuts(min: number, max: number, limit: number, pinCoords: number[], clearance: number): number[] {
  const span = max - min;
  let n = Math.max(1, Math.ceil(span / limit));
  for (;;) {
    const step = span / n;
    const slack = (limit - step) / 2;
    if (n > 1 && slack < clearance && n < 200) {
      n++;
      continue;
    }
    const cuts: number[] = [];
    for (let k = 1; k < n; k++) {
      const ideal = min + k * step;
      let best = ideal;
      let bestScore = -Infinity;
      const range = Math.max(0, slack);
      for (let d = -range; d <= range + 1e-9; d += 0.5) {
        const c = ideal + d;
        let near = Infinity;
        for (const q of pinCoords) near = Math.min(near, Math.abs(q - c));
        // Prefer clear of pins, then closest to even spacing.
        const score = Math.min(near, clearance * 2) * 1000 - Math.abs(d);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      cuts.push(best);
    }
    return [min, ...cuts, max];
  }
}

export function buildSections(p: DesignParams, outline: Polygon, tiles: Tile[]): { sections: Section[]; warnings: string[] } {
  const warnings: string[] = [];
  const b = bbox(outline);
  const lim = usable(p);
  const spec = pinSpec(p);
  const pinR = (spec?.d ?? 0) / 2;
  const keyR = (spec?.keyD ?? 0) / 2;
  const pinPositions = tiles.filter((t) => t.socket).map((t) => t.center);
  const xs = chooseCuts(b.minX, b.maxX, lim.x, pinPositions.map((q) => q[0]), pinR + 1);
  const ys = chooseCuts(b.minY, b.maxY, lim.y, pinPositions.map((q) => q[1]), pinR + 1);

  const sections: Section[] = [];
  const grid: (Section | null)[][] = [];
  for (let c = 0; c < xs.length - 1; c++) {
    grid[c] = [];
    for (let r = 0; r < ys.length - 1; r++) {
      const cell = { minX: xs[c], minY: ys[r], maxX: xs[c + 1], maxY: ys[r + 1] };
      const poly = clipConvex(rect(cell.minX, cell.minY, cell.maxX, cell.maxY), outline);
      if (poly.length < 3 || area(poly) < 1) {
        grid[c][r] = null;
        continue;
      }
      const s: Section = { id: sections.length, col: c, row: r, cell, poly, pins: [], keyPins: [], keys: [], tiles: [] };
      sections.push(s);
      grid[c][r] = s;
    }
  }

  const find = (pt: Vec2): Section | undefined =>
    sections.find(
      (s) => pt[0] >= s.cell.minX && pt[0] < s.cell.maxX + 1e-9 && pt[1] >= s.cell.minY && pt[1] < s.cell.maxY + 1e-9,
    );

  let straddling = 0;
  for (const t of tiles) {
    const s = find(t.center);
    if (!s) continue;
    s.tiles.push(t.id);
    if (!t.socket) continue;
    const c = t.center;
    const fits = (q: Vec2, r: number) =>
      q[0] - r >= s.cell.minX && q[0] + r <= s.cell.maxX && q[1] - r >= s.cell.minY && q[1] + r <= s.cell.maxY;
    if (fits(c, pinR)) {
      s.pins.push(c);
      if (t.key) {
        const k: Vec2 = [c[0] + t.key[0], c[1] + t.key[1]];
        if (fits(k, keyR)) s.keyPins.push(k);
        else {
          // Key pin would sit on a seam: try the other directions on this section.
          placeKey(p, t, (o) => fits([c[0] + o[0], c[1] + o[1]], keyR));
          if (t.key) s.keyPins.push([c[0] + t.key[0], c[1] + t.key[1]]);
          placeLabel(p, t);
        }
      }
    } else {
      // A pin on a seam can't be printed in one piece: glue that tile instead.
      t.socket = false;
      t.key = null;
      placeLabel(p, t);
      straddling++;
    }
  }
  if (straddling) warnings.push(`${straddling} tile(s) sit on a backplate seam and will need glue instead of a pin.`);

  if (p.backplate.keys) addKeys(p, outline, grid, xs, ys);

  return { sections, warnings };
}

function addKeys(p: DesignParams, outline: Polygon, grid: (Section | null)[][], xs: number[], ys: number[]) {
  const spacing = 90;
  const fromCorner = KEY.endWidth / 2 + 8;
  const inside = (x: number, y: number, ang: number) => {
    const a = (ang * Math.PI) / 180;
    return bowtie().every(([u, v]) => {
      const px = x + u * Math.cos(a) - v * Math.sin(a);
      const py = y + u * Math.sin(a) + v * Math.cos(a);
      return pointInConvex([px, py], outline, 3);
    });
  };
  const place = (a: Section, b: Section, along: [number, number], fixed: number, vertical: boolean) => {
    const [lo, hi] = along;
    const len = hi - lo - 2 * fromCorner;
    if (len < 0) return;
    const count = Math.max(1, Math.round(len / spacing) + 1);
    for (let k = 0; k < count; k++) {
      const t = count === 1 ? 0.5 : k / (count - 1);
      const s = lo + fromCorner + t * len;
      const [x, y, ang] = vertical ? [fixed, s, 0] : [s, fixed, 90];
      if (!inside(x, y, ang)) continue;
      a.keys.push([x, y, ang]);
      b.keys.push([x, y, ang]);
    }
  };
  for (let c = 0; c < grid.length; c++) {
    for (let r = 0; r < grid[c].length; r++) {
      const s = grid[c][r];
      if (!s) continue;
      const right = grid[c + 1]?.[r];
      if (right) {
        const span = sharedSpan(s.poly, right.poly, xs[c + 1], true);
        if (span) place(s, right, span, xs[c + 1], true);
      }
      const up = grid[c][r + 1];
      if (up) {
        const span = sharedSpan(s.poly, up.poly, ys[r + 1], false);
        if (span) place(s, up, span, ys[r + 1], false);
      }
    }
  }
}

/** Range along a seam line where both sections touch it. */
function sharedSpan(a: Polygon, b: Polygon, at: number, vertical: boolean): [number, number] | null {
  const range = (poly: Polygon): [number, number] | null => {
    const pts = poly.filter((q) => Math.abs((vertical ? q[0] : q[1]) - at) < 1e-6).map((q) => (vertical ? q[1] : q[0]));
    if (pts.length < 2) return null;
    return [Math.min(...pts), Math.max(...pts)];
  };
  const ra = range(a);
  const rb = range(b);
  if (!ra || !rb) return null;
  const lo = Math.max(ra[0], rb[0]);
  const hi = Math.min(ra[1], rb[1]);
  return hi > lo ? [lo, hi] : null;
}
