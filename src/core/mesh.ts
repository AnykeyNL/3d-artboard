// Printable meshes built directly in TypeScript (no CSG engine needed), so the
// browser can export STL/3MF in seconds. Geometry matches the OpenSCAD file.
// Convention here: triangles are counter-clockwise seen from outside (STL/three.js).
import earcut, { deviation } from 'earcut';
import * as P2T from 'poly2tri';
import * as PC from './clip';
import { Design } from './design';
import { Section, KEY, bowtie } from './backplate';
import { Tile } from './tile';
import { Polygon, Vec2, Vec3, signedArea, bbox, insetConvex } from './geometry';
import { LABEL, pinSpec } from './params';
import { labelRects } from './label';

export class Mesh {
  /** Flat triangle soup: 9 numbers per triangle. */
  tris: number[] = [];

  tri(a: Vec3, b: Vec3, c: Vec3) {
    this.tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  /** Quad from a lower edge (a→b) to an upper edge, outward when a→b runs CCW around the solid. */
  wall(a: Vec2, b: Vec2, za: number, zb: number, topA?: Vec3, topB?: Vec3) {
    const a0: Vec3 = [a[0], a[1], za];
    const b0: Vec3 = [b[0], b[1], za];
    const a1: Vec3 = topA ?? [a[0], a[1], zb];
    const b1: Vec3 = topB ?? [b[0], b[1], zb];
    this.tri(a0, b0, b1);
    this.tri(a0, b1, a1);
  }

  /** Flat cap at height z over a region (outer ring + holes), facing up or down. */
  cap(rings: Polygon[], z: number, up: boolean) {
    const flat: number[] = [];
    const holes: number[] = [];
    rings.forEach((r, i) => {
      if (i > 0) holes.push(flat.length / 2);
      for (const p of r) flat.push(p[0], p[1]);
    });
    // earcut's hole bridging can go wrong on some layouts (numbers lined up
    // under sockets). Try a few rotations and keep the first exact result.
    let idx: number[] = [];
    let best = Infinity;
    for (const ang of [0.3141, 0, 1.1, 2.3, 0.77, 1.9, 2.9, 0.05]) {
      const rot = new Array<number>(flat.length);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let v = 0; v < flat.length; v += 2) {
        rot[v] = flat[v] * ca - flat[v + 1] * sa;
        rot[v + 1] = flat[v] * sa + flat[v + 1] * ca;
      }
      const cand = earcut(rot, holes.length ? holes : undefined);
      const dv = holes.length ? deviation(flat, holes, 2, cand) : 0;
      if (dv < best) { best = dv; idx = cand; }
      if (dv < 1e-9) break;
    }
    // Still wrong: fall back to a constrained Delaunay triangulation.
    if (best > 1e-9) {
      try {
        const pts = rings.map((r, ri) => {
          const off = ri === 0 ? 0 : holes[ri - 1];
          return r.map((q, k) => Object.assign(new P2T.Point(q[0], q[1]), { _i: off + k }));
        });
        const ctx = new P2T.SweepContext(pts[0]);
        for (const h of pts.slice(1)) ctx.addHole(h);
        ctx.triangulate();
        const cdt: number[] = [];
        for (const tr of ctx.getTriangles()) for (const k of [0, 1, 2] as const) cdt.push((tr.getPoint(k) as unknown as { _i: number })._i);
        if (deviation(flat, holes, 2, cdt) < best) idx = cdt;
      } catch {
        // keep the best earcut result
      }
    }
    // earcut can leave a ring vertex lying on a triangle edge (collinear holes).
    // Find those and split the triangle so caps meet the walls edge to edge.
    const n = flat.length / 2;
    const cell = 4;
    const grid = new Map<string, number[]>();
    for (let v = 0; v < n; v++) {
      const k = `${Math.floor(flat[2 * v] / cell)},${Math.floor(flat[2 * v + 1] / cell)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(v);
    }
    const onEdge = (a: number, b: number): number[] => {
      const ax = flat[2 * a], ay = flat[2 * a + 1], bx = flat[2 * b], by = flat[2 * b + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-9) return [];
      const found: [number, number][] = [];
      for (let gx = Math.floor(Math.min(ax, bx) / cell); gx <= Math.floor(Math.max(ax, bx) / cell); gx++) {
        for (let gy = Math.floor(Math.min(ay, by) / cell); gy <= Math.floor(Math.max(ay, by) / cell); gy++) {
          for (const v of grid.get(`${gx},${gy}`) ?? []) {
            if (v === a || v === b) continue;
            const px = flat[2 * v], py = flat[2 * v + 1];
            const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (len * len);
            if (t <= 1e-9 || t >= 1 - 1e-9) continue;
            const dist = Math.abs((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / len;
            if (dist < 1e-6) found.push([t, v]);
          }
        }
      }
      return found.sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    };
    const P = (v: number): Vec3 => [flat[2 * v], flat[2 * v + 1], z];
    for (let i = 0; i < idx.length; i += 3) {
      let [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
      const cross = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
      if (Math.abs(cross) < 1e-9) continue;
      if (cross < 0) [b, c] = [c, b]; // now CCW
      const ring = [a, ...onEdge(a, b), b, ...onEdge(b, c), c, ...onEdge(c, a)];
      const emit = (p: Vec3, q: Vec3, r: Vec3) => (up ? this.tri(p, q, r) : this.tri(p, r, q));
      if (ring.length === 3) {
        emit(P(a), P(b), P(c));
      } else {
        const m: Vec3 = [(flat[2 * a] + flat[2 * b] + flat[2 * c]) / 3, (flat[2 * a + 1] + flat[2 * b + 1] + flat[2 * c + 1]) / 3, z];
        for (let k = 0; k < ring.length; k++) emit(m, P(ring[k]), P(ring[(k + 1) % ring.length]));
      }
    }
  }

  /** Straight extrusion of a region between z0 and z1. Outer ring CCW, holes CW. */
  prism(rings: Polygon[], z0: number, z1: number, caps = { bottom: true, top: true }) {
    const norm = normaliseRings(rings);
    if (caps.bottom) this.cap(norm, z0, false);
    if (caps.top) this.cap(norm, z1, true);
    for (const r of norm) for (let i = 0; i < r.length; i++) this.wall(r[i], r[(i + 1) % r.length], z0, z1);
  }

  translated(dx: number, dy: number, dz = 0): Mesh {
    const m = new Mesh();
    m.tris = this.tris.map((v, i) => v + (i % 3 === 0 ? dx : i % 3 === 1 ? dy : dz));
    return m;
  }

  append(other: Mesh): this {
    for (const v of other.tris) this.tris.push(v);
    return this;
  }

  get triangleCount() {
    return this.tris.length / 9;
  }
}

/**
 * Outer ring CCW, holes CW, no repeated or collinear points. (earcut drops
 * collinear points from caps, so walls must not keep them either, or the
 * mesh gets T-junctions.)
 */
function normaliseRings(rings: Polygon[]): Polygon[] {
  return rings
    .map((r, i) => {
      const ring = dropCollinear(r);
      const ccw = signedArea(ring) > 0;
      return (i === 0) === ccw ? ring : [...ring].reverse();
    })
    .filter((r) => r.length >= 3);
}

function dropCollinear(r: Polygon): Polygon {
  let pts = r.filter((p, i) => {
    const q = r[(i + 1) % r.length];
    return Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const keep: Polygon = [];
    for (let i = 0; i < pts.length; i++) {
      const a = keep.length ? keep[keep.length - 1] : pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) < 1e-9) changed = true;
      else keep.push(b);
    }
    pts = keep;
  }
  return pts;
}

function circle(r: number, n = 32, cx = 0, cy = 0): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Miter offset of a simple CCW polygon (positive grows). Fine for small deltas. */
export function offsetPolygon(poly: Polygon, d: number): Polygon {
  const n = poly.length;
  const out: Polygon = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i + n - 1) % n];
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const n1 = edgeNormal(p0, p1);
    const n2 = edgeNormal(p1, p2);
    const bx = n1[0] + n2[0];
    const by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) {
      out.push([p1[0] + n1[0] * d, p1[1] + n1[1] * d]);
      continue;
    }
    const cos = (n1[0] * bx + n1[1] * by) / bl;
    const k = d / Math.max(cos, 0.2);
    out.push([p1[0] + (bx / bl) * k, p1[1] + (by / bl) * k]);
  }
  return out;
}

function edgeNormal(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

// ---------- tiles ----------

export interface SocketSpec {
  x: number;
  y: number;
  /** Bore diameter (pin + clearance). */
  d: number;
  /** Depth. */
  h: number;
}

export interface TileSolidOptions {
  wall: number;
  sockets: SocketSpec[];
  /** Engraved region on the bottom (already mirrored) and its depth. */
  label?: { region: PC.MultiPolygon; depth: number };
}

/** Closed mesh of a tile in its own coordinates (base centre at origin, base on z=0). */
export function tileSolid(tile: Pick<Tile, 'base' | 'top'>, o: TileSolidOptions): Mesh {
  const m = new Mesh();
  const base = tile.base;
  const n = base.length;
  const w = o.wall;
  const seg = 32;

  const bottomHoles: Polygon[] = [];
  for (const sk of o.sockets) {
    const entry = circle((sk.d + 0.8) / 2, seg, sk.x, sk.y);
    const bore = circle(sk.d / 2, seg, sk.x, sk.y);
    bottomHoles.push([...entry].reverse());
    // Entry chamfer and bore face into the hole (reverse winding).
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const e0: Vec3 = [entry[i][0], entry[i][1], 0];
      const e1: Vec3 = [entry[j][0], entry[j][1], 0];
      const c0: Vec3 = [bore[i][0], bore[i][1], 0.4];
      const c1: Vec3 = [bore[j][0], bore[j][1], 0.4];
      const t0: Vec3 = [bore[i][0], bore[i][1], sk.h];
      const t1: Vec3 = [bore[j][0], bore[j][1], sk.h];
      m.tri(e0, c1, e1);
      m.tri(e0, c0, c1);
      m.tri(c0, t1, c1);
      m.tri(c0, t0, t1);
    }
    m.cap([bore], sk.h, false);
  }

  const islands: Polygon[][] = [];
  if (o.label) {
    const dz = o.label.depth;
    for (const poly of o.label.region) {
      const rings = normaliseRings(poly as Polygon[]);
      if (!rings.length) continue;
      bottomHoles.push(rings[0]);
      for (const h of rings.slice(1)) islands.push([h]);
      // Pocket walls face into the pocket; its ceiling faces down.
      for (const r of rings) for (let i = 0; i < r.length; i++) m.wall(r[(i + 1) % r.length], r[i], 0, dz);
      m.cap(rings, dz, false);
    }
  }
  m.cap([base, ...bottomHoles], 0, false);
  for (const isl of islands) m.cap(isl, 0, false);

  for (let i = 0; i < n; i++) m.wall(base[i], base[(i + 1) % n], 0, w);

  const top = tile.top;
  if (top.length === 1) {
    const a = top[0];
    for (let i = 0; i < n; i++) {
      const p = base[i];
      const q = base[(i + 1) % n];
      m.tri([p[0], p[1], w], [q[0], q[1], w], a);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      m.wall(base[i], base[j], w, w, top[i], top[j]);
    }
    for (let i = 1; i < top.length - 1; i++) m.tri(top[0], top[i], top[i + 1]);
  }
  return m;
}

export function tileOptions(d: Design, tile: Tile): TileSolidOptions {
  const p = d.params;
  const spec = pinSpec(p);
  const sockets: SocketSpec[] = [];
  if (spec && tile.socket) sockets.push({ x: 0, y: 0, d: spec.d + spec.clearance, h: spec.h + 0.4 });
  if (spec && tile.key) sockets.push({ x: tile.key[0], y: tile.key[1], d: spec.keyD + spec.clearance, h: spec.h + 0.4 });
  const label = tile.label
    ? { region: PC.union(...labelRects(String(tile.id + 1), tile.label.h, tile.label.x, tile.label.y).map((r) => [r] as PC.Poly)), depth: LABEL.depth }
    : undefined;
  return { wall: p.tiles.wall, sockets, label };
}

// ---------- backplate ----------

const pc = PC;
type MP = PC.MultiPolygon;
const toPC = (p: Polygon): PC.Poly => [p.map(([x, y]) => [x, y] as PC.Pair)];

export function pinSolid(d: number, h: number, base: number, seg = 24): Mesh {
  // Starts 0.3 mm inside the plate so slicers merge it with the plate.
  const m = new Mesh();
  const r = d / 2;
  const c0 = circle(r, seg);
  const c1 = circle(r - 0.5, seg);
  const z0 = base - 0.3;
  const zc = base + h - 0.6;
  const zt = base + h;
  m.cap([c0], z0, false);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    m.wall(c0[i], c0[j], z0, zc);
    m.wall(c0[i], c0[j], zc, zt, [c1[i][0], c1[i][1], zt], [c1[j][0], c1[j][1], zt]);
  }
  m.cap([c1], zt, true);
  return m;
}

function bowtieAt(x: number, y: number, angDeg: number, grow: number): Polygon {
  const a = (angDeg * Math.PI) / 180;
  const shape = grow ? offsetPolygon(bowtie(), grow) : bowtie();
  return shape.map(([u, v]) => [x + u * Math.cos(a) - v * Math.sin(a), y + u * Math.sin(a) + v * Math.cos(a)]);
}

// ---------- honeycomb web ----------

/** Pads around pins / tile centres; short spokes tie each pad to the nearest honeycomb walls. */
export const PAD = { margin: 3 };

export function honeycombGeometry(p: Design['params']) {
  const R = p.backplate.cell / Math.sqrt(3); // circumradius of a flat-top hexagon
  return {
    R,
    dx: 1.5 * R,
    dy: Math.sqrt(3) * R,
    holeR: ((p.backplate.cell / 2 - p.backplate.rib / 2) * 2) / Math.sqrt(3),
  };
}

function hexAt(cx: number, cy: number, r: number): Polygon {
  const out: Polygon = [];
  for (let k = 0; k < 6; k++) out.push([cx + r * Math.cos((k * Math.PI) / 3), cy + r * Math.sin((k * Math.PI) / 3)]);
  return out;
}

/**
 * Spokes for a pad at (x, y): of the six directions straight at a hexagon's
 * walls, the three shortest, each just long enough to reach into the wall.
 */
export function padSpokes(p: Design['params'], x: number, y: number): [number, number][] {
  const hc = honeycombGeometry(p);
  const i0 = Math.round(x / hc.dx);
  let best: { cx: number; cy: number; d: number } | null = null;
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const off = Math.abs(i) % 2 === 1 ? hc.dy / 2 : 0;
    const j = Math.round((y - off) / hc.dy);
    for (let jj = j - 1; jj <= j + 1; jj++) {
      const cx = i * hc.dx;
      const cy = jj * hc.dy + off;
      const dd = Math.hypot(x - cx, y - cy);
      if (!best || dd < best.d) best = { cx, cy, d: dd };
    }
  }
  if (!best) return [];
  const apothem = (hc.holeR * Math.sqrt(3)) / 2;
  const lx = x - best.cx;
  const ly = y - best.cy;
  // Inside the hole? Then spokes are needed.
  const normals = [30, 90, 150, 210, 270, 330].map((a) => [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180), a] as const);
  if (normals.some(([nx, ny]) => nx * lx + ny * ly > apothem)) return [];
  const exits = normals.map(([ux, uy, a]) => {
    let t = Infinity;
    for (const [nx, ny] of normals) {
      const nu = nx * ux + ny * uy;
      if (nu > 1e-9) t = Math.min(t, (apothem - (nx * lx + ny * ly)) / nu);
    }
    return [a, t + p.backplate.rib / 2] as [number, number];
  });
  return exits.sort((a, b) => a[1] - b[1]).slice(0, 3);
}

function rotRect(x: number, y: number, angDeg: number, len: number, w: number): Polygon {
  const a = (angDeg * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a);
  const vx = -uy * (w / 2), vy = ux * (w / 2);
  return [
    [x + vx, y + vy],
    [x - vx, y - vy],
    [x + ux * len - vx, y + uy * len - vy],
    [x + ux * len + vx, y + uy * len + vy],
  ];
}

/**
 * 2D outline of a backplate section. Solid style: the section itself. Honeycomb:
 * section minus hexagonal holes, except a solid rim, pads with spokes under every
 * pin (or tile centre in glue mode) and pads around key pockets.
 */
export function sectionWeb(d: Design, s: Section): MP {
  const p = d.params;
  const full: MP = [toPC(s.poly)];
  if (p.backplate.style !== 'honeycomb') return full;
  const hc = honeycombGeometry(p);
  const b = bbox(s.poly);
  const holes: PC.Poly[] = [];
  for (let i = Math.floor(b.minX / hc.dx) - 1; i <= Math.ceil(b.maxX / hc.dx) + 1; i++) {
    for (let j = Math.floor(b.minY / hc.dy) - 1; j <= Math.ceil(b.maxY / hc.dy) + 1; j++) {
      const cx = i * hc.dx;
      const cy = j * hc.dy + (Math.abs(i) % 2 === 1 ? hc.dy / 2 : 0);
      if (cx + hc.R < b.minX || cx - hc.R > b.maxX || cy + hc.R < b.minY || cy - hc.R > b.maxY) continue;
      holes.push(toPC(hexAt(cx, cy, hc.holeR)));
    }
  }
  const inner = insetConvex(s.poly, p.backplate.rim);
  if (inner.length < 3 || !holes.length) return full;

  const solids: PC.Poly[] = [];
  const centres = padCentres(d, s);
  const padR = padRadius(p);
  for (const [x, y] of centres) {
    solids.push(toPC(circle(padR, 20, x, y)));
    for (const [a, len] of padSpokes(p, x, y)) solids.push(toPC(rotRect(x, y, a, len, p.backplate.rib)));
  }
  for (const [x, y, a] of s.keys) solids.push(toPC(bowtieAt(x, y, a, PAD.margin)));

  let cut = pc.intersection(pc.union(...holes), toPC(inner));
  if (solids.length) cut = pc.difference(cut, ...solids);
  return pc.difference(full, cut);
}

/** Where the honeycomb keeps solid pads: under every pin, or under tile centres when there are none. */
export function padCentres(d: Design, s: Section): Vec2[] {
  return pinSpec(d.params) ? [...s.pins, ...s.keyPins] : s.tiles.map((id) => d.tiles[id].center);
}

export function padRadius(p: Design['params']): number {
  return (pinSpec(p)?.d ?? 8) / 2 + PAD.margin;
}

/**
 * Backplate section: stacked layers (key pockets at the bottom, optional
 * engraved guides at the top) plus pins.
 */
export function sectionSolid(d: Design, s: Section): Mesh {
  const p = d.params;
  const t = p.backplate.thickness;
  const full: MP = sectionWeb(d, s);
  const layers: { region: MP; z0: number; z1: number }[] = [];

  const keyDepth = p.backplate.thickness / 2;
  let bottom = full;
  if (s.keys.length) {
    const pockets = s.keys.map(([x, y, a]) => toPC(bowtieAt(x, y, a, KEY.clearance)));
    bottom = pc.difference(full, ...pockets);
    layers.push({ region: bottom, z0: 0, z1: keyDepth });
  }

  const guideDepth = 0.6;
  const guides = p.mount.type === 'glue' && p.mount.guides && s.tiles.length > 0;
  const midTop = guides ? t - guideDepth : t;
  layers.push({ region: full, z0: layers.length ? keyDepth : 0, z1: midTop });

  if (guides) {
    const gw = 0.4;
    const outs = s.tiles.map((id) => {
      const tl = d.tiles[id];
      return toPC(offsetPolygon(tl.base, gw).map(([x, y]) => [x + tl.center[0], y + tl.center[1]] as Vec2));
    });
    const ins = s.tiles.map((id) => {
      const tl = d.tiles[id];
      return toPC(offsetPolygon(tl.base, -gw).map(([x, y]) => [x + tl.center[0], y + tl.center[1]] as Vec2));
    });
    const top = pc.intersection(full, pc.union(pc.difference(full, ...outs), ...ins));
    layers.push({ region: top, z0: midTop, z1: t });
  }

  // Each layer is its own closed shell, overlapping the next by 0.02 mm, so every
  // body is watertight and the slicer merges them (just like the pins).
  const m = new Mesh();
  layers.forEach((L, i) => {
    const z1 = i < layers.length - 1 ? L.z1 + 0.02 : L.z1;
    for (const poly of L.region) m.prism(poly as Polygon[], L.z0, z1);
  });
  const spec = pinSpec(p);
  if (spec) {
    for (const [x, y] of s.pins) m.append(pinSolid(spec.d, spec.h, t).translated(x, y));
    for (const [x, y] of s.keyPins) m.append(pinSolid(spec.keyD, spec.h, t, 16).translated(x, y));
  }
  return m;
}

export function keySolid(d: Design): Mesh {
  const m = new Mesh();
  m.prism([bowtie()], 0, d.params.backplate.thickness / 2 - 0.2);
  return m;
}

/** Strip with pins plus blocks with sockets at increasing clearance (taller block = looser). */
export function fitTestSolids(d: Design): Mesh {
  const p = d.params;
  const cl = [0.05, 0.1, 0.15, 0.2, 0.3];
  const t = p.backplate.thickness;
  const m = new Mesh();
  const W = cl.length * 14 + 4;
  m.prism([[[0, 0], [W, 0], [W, 14], [0, 14]]], 0, t);
  cl.forEach((c, k) => {
    m.append(pinSolid(p.mount.pinDiameter, p.mount.pinHeight, t).translated(9 + k * 14, 7));
    const s = 6;
    const h = p.mount.pinHeight + 2 + k;
    const block = {
      base: [[-s, -s], [s, -s], [s, s], [-s, s]] as Polygon,
      top: [[-s, -s, h], [s, -s, h], [s, s, h], [-s, s, h]] as Vec3[],
    };
    m.append(tileSolid(block, { wall: h - 0.01, sockets: [{ x: 0, y: 0, d: p.mount.pinDiameter + c, h: p.mount.pinHeight + 0.4 }] }).translated(9 + k * 14, 30));
  });
  return m;
}
