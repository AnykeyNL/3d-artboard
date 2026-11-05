// 2D polygon helpers. All polygons are arrays of [x, y] in millimetres,
// counter-clockwise, and (for everything the layout produces) convex.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Polygon = Vec2[];

export function signedArea(p: Polygon): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function area(p: Polygon): number {
  return Math.abs(signedArea(p));
}

export function ensureCCW(p: Polygon): Polygon {
  return signedArea(p) < 0 ? [...p].reverse() : p;
}

export function centroid(p: Polygon): Vec2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = p.length;
    return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bbox(points: ArrayLike<Vec2 | Vec3>): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

/** Keep the part of `poly` where a*x + b*y <= c. */
export function clipHalfPlane(poly: Polygon, a: number, b: number, c: number): Polygon {
  const out: Polygon = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const dp = a * p[0] + b * p[1] - c;
    const dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

/** Inward half-planes of a convex CCW polygon, each as [a, b, c] with a*x+b*y<=c inside. */
function halfPlanes(clip: Polygon, inset = 0): [number, number, number][] {
  const hp: [number, number, number][] = [];
  for (let i = 0; i < clip.length; i++) {
    const p = clip[i];
    const q = clip[(i + 1) % clip.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    // Outward normal of a CCW edge is (ey, -ex).
    const a = ey / len;
    const b = -ex / len;
    hp.push([a, b, a * p[0] + b * p[1] - inset]);
  }
  return hp;
}

/** Sutherland–Hodgman: intersection of any polygon with a convex CCW polygon. */
export function clipConvex(subject: Polygon, clip: Polygon): Polygon {
  let out = subject;
  for (const [a, b, c] of halfPlanes(clip)) {
    if (out.length === 0) break;
    out = clipHalfPlane(out, a, b, c);
  }
  return cleanPolygon(out);
}

/** Shrink a convex CCW polygon by distance d (each edge moves inward by d). */
export function insetConvex(poly: Polygon, d: number): Polygon {
  if (d <= 0) return poly;
  let out = poly;
  for (const [a, b, c] of halfPlanes(poly, d)) {
    if (out.length === 0) break;
    out = clipHalfPlane(out, a, b, c);
  }
  return cleanPolygon(out);
}

/** Drop duplicate and collinear vertices. */
export function cleanPolygon(p: Polygon, eps = 1e-6): Polygon {
  let pts = p.filter((q, i) => {
    const r = p[(i + 1) % p.length];
    return Math.hypot(q[0] - r[0], q[1] - r[1]) > 1e-4;
  });
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) < eps) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return pts.length >= 3 ? pts : [];
}

export function pointInConvex(p: Vec2, poly: Polygon, inset = 0): boolean {
  for (const [a, b, c] of halfPlanes(poly, inset)) {
    if (a * p[0] + b * p[1] > c + 1e-9) return false;
  }
  return true;
}

/** Distance from a point to the nearest edge of a convex polygon (positive inside). */
export function insideDistance(p: Vec2, poly: Polygon): number {
  let d = Infinity;
  for (const [a, b, c] of halfPlanes(poly)) {
    d = Math.min(d, c - (a * p[0] + b * p[1]));
  }
  return d;
}

export function translate(poly: Polygon, dx: number, dy: number): Polygon {
  return poly.map(([x, y]) => [x + dx, y + dy]);
}

export function rect(minX: number, minY: number, maxX: number, maxY: number): Polygon {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of integers to [0,1). */
export function hash01(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.floor(v) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return rng(h)();
}
