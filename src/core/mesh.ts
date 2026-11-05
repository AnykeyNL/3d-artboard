// Printable meshes built directly in TypeScript (no CSG engine needed), so the
// browser can export STL/3MF in seconds. Geometry matches the OpenSCAD file.
// Convention here: triangles are counter-clockwise seen from outside (STL/three.js).
import earcut from 'earcut';
import polygonClipping from 'polygon-clipping';
import type * as PC from 'polygon-clipping';
import { Design } from './design';
import { Section, KEY, bowtie } from './backplate';
import { Tile } from './tile';
import { Polygon, Vec2, Vec3, signedArea } from './geometry';

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
    const idx = earcut(flat, holes.length ? holes : undefined);
    for (let i = 0; i < idx.length; i += 3) {
      const p = (k: number): Vec3 => [flat[2 * idx[i + k]], flat[2 * idx[i + k] + 1], z];
      let a = p(0);
      let b = p(1);
      const c = p(2);
      const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
      if (ccw !== up) [a, b] = [b, a];
      this.tri(a, b, c);
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

/** Outer ring CCW, holes CW, no repeated closing point. */
function normaliseRings(rings: Polygon[]): Polygon[] {
  return rings.map((r, i) => {
    let ring = r;
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (ring.length > 1 && f[0] === l[0] && f[1] === l[1]) ring = ring.slice(0, -1);
    const ccw = signedArea(ring) > 0;
    return (i === 0) === ccw ? ring : [...ring].reverse();
  });
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

export interface TileSolidOptions {
  wall: number;
  /** Socket diameter (pin + clearance), or 0 for none. */
  socketD: number;
  socketH: number;
}

/** Closed mesh of a tile in its own coordinates (base centre at origin, base on z=0). */
export function tileSolid(tile: Pick<Tile, 'base' | 'top'>, o: TileSolidOptions): Mesh {
  const m = new Mesh();
  const base = tile.base;
  const n = base.length;
  const w = o.wall;

  if (o.socketD > 0) {
    const seg = 32;
    const entry = circle((o.socketD + 0.8) / 2, seg);
    const bore = circle(o.socketD / 2, seg);
    // Bottom with the socket opening.
    m.cap([base, [...entry].reverse()], 0, false);
    // Entry chamfer and bore face into the hole (reverse winding).
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const e0: Vec3 = [entry[i][0], entry[i][1], 0];
      const e1: Vec3 = [entry[j][0], entry[j][1], 0];
      const c0: Vec3 = [bore[i][0], bore[i][1], 0.4];
      const c1: Vec3 = [bore[j][0], bore[j][1], 0.4];
      const t0: Vec3 = [bore[i][0], bore[i][1], o.socketH];
      const t1: Vec3 = [bore[j][0], bore[j][1], o.socketH];
      m.tri(e0, c1, e1);
      m.tri(e0, c0, c1);
      m.tri(c0, t1, c1);
      m.tri(c0, t0, t1);
    }
    m.cap([bore], o.socketH, false);
  } else {
    m.cap([base], 0, false);
  }

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
  return {
    wall: p.tiles.wall,
    socketD: tile.socket ? p.mount.pinDiameter + p.mount.clearance : 0,
    socketH: p.mount.pinHeight + 0.4,
  };
}

// ---------- backplate ----------

const pc = polygonClipping;
type MP = PC.MultiPolygon;
// Snap to a 1 µm grid: polygon-clipping is robust only when near-identical points coincide.
const snap = (v: number) => Math.round(v * 1000) / 1000;
const toPC = (p: Polygon): PC.Polygon => {
  const ring: PC.Pair[] = [];
  for (const [x, y] of p) {
    const q: PC.Pair = [snap(x), snap(y)];
    const last = ring[ring.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) ring.push(q);
  }
  return [ring];
};

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

/**
 * Backplate section: stacked layers (key pockets at the bottom, optional
 * engraved guides at the top) plus pins.
 */
export function sectionSolid(d: Design, s: Section): Mesh {
  const p = d.params;
  const t = p.backplate.thickness;
  const full: MP = [toPC(s.poly)];
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
  if (p.mount.type === 'pressfit') {
    for (const [x, y] of s.pins) m.append(pinSolid(p.mount.pinDiameter, p.mount.pinHeight, t).translated(x, y));
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
    m.append(tileSolid(block, { wall: h - 0.01, socketD: p.mount.pinDiameter + c, socketH: p.mount.pinHeight + 0.4 }).translated(9 + k * 14, 30));
  });
  return m;
}
