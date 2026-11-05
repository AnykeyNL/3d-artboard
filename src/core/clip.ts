// Robust polygon booleans (Clipper, integer coordinates at 1 µm).
import ClipperLib from 'clipper-lib';

export type Pair = [number, number];
export type Ring = Pair[];
/** Outer ring followed by hole rings. */
export type Poly = Ring[];
export type MultiPolygon = Poly[];
type Geom = Poly | MultiPolygon;

const S = 1000;

function isMulti(g: Geom): g is MultiPolygon {
  return g.length > 0 && Array.isArray((g as any)[0][0]) && Array.isArray((g as any)[0][0][0]);
}

function area2(r: Ring): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

function toPaths(g: Geom): any[] {
  const polys = isMulti(g) ? g : [g as Poly];
  const out: any[] = [];
  for (const poly of polys) {
    poly.forEach((ring, i) => {
      if (ring.length < 3) return;
      // Outer rings CCW, holes CW, so non-zero filling unions outers and cuts holes.
      const want = i === 0;
      const ccw = area2(ring) > 0;
      const r = want === ccw ? ring : [...ring].reverse();
      out.push(r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })));
    });
  }
  return out;
}

function fromTree(tree: any): MultiPolygon {
  const out: MultiPolygon = [];
  const ring = (c: any[]): Ring => c.map((p) => [p.X / S, p.Y / S] as Pair);
  const walkOuter = (node: any) => {
    const poly: Poly = [ring(node.Contour())];
    for (const hole of node.Childs()) {
      poly.push(ring(hole.Contour()));
      for (const island of hole.Childs()) walkOuter(island);
    }
    out.push(poly);
  };
  for (const n of tree.Childs()) walkOuter(n);
  return out;
}

function run(type: number, subject: Geom[], clip: Geom[]): MultiPolygon {
  const c = new ClipperLib.Clipper();
  c.StrictlySimple = true;
  for (const g of subject) c.AddPaths(toPaths(g), ClipperLib.PolyType.ptSubject, true);
  for (const g of clip) c.AddPaths(toPaths(g), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return fromTree(tree);
}

export function union(...g: Geom[]): MultiPolygon {
  return run(ClipperLib.ClipType.ctUnion, g, []);
}

export function difference(a: Geom, ...b: Geom[]): MultiPolygon {
  return b.length ? run(ClipperLib.ClipType.ctDifference, [a], b) : run(ClipperLib.ClipType.ctUnion, [a], []);
}

export function intersection(a: Geom, ...b: Geom[]): MultiPolygon {
  let r = run(ClipperLib.ClipType.ctUnion, [a], []);
  for (const g of b) r = run(ClipperLib.ClipType.ctIntersection, [r], [g]);
  return r;
}

export function polyArea(poly: Poly): number {
  return poly.reduce((a, r, i) => a + (i === 0 ? 1 : -1) * Math.abs(area2(r)) / 2, 0);
}
