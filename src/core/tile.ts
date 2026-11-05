// Turn a laid-out cell plus a pattern sample into a printable tile solid.
import { DesignParams, LABEL, pinSpec } from './params';
import { Cell } from './layout';
import { FieldSample } from './patterns';
import { Polygon, Vec2, Vec3, insideDistance, pointInConvex, insetConvex, bbox } from './geometry';
import { labelSize } from './label';

export interface Tile {
  id: number;
  i: number;
  j: number;
  /** Centre on the board (mm, board origin at centre). */
  center: Vec2;
  color: number;
  /** Footprint relative to `center`, CCW. */
  base: Polygon;
  /** Top: one apex, or a ring of points matching `base` (flat/tilted top). Relative to `center`. */
  top: Vec3[];
  /** Tallest point of the tile. */
  height: number;
  /** Has a socket at its centre (and the backplate a pin under it). */
  socket: boolean;
  /** Offset key socket (relative to centre) that makes the fit one-way, or null. */
  key: Vec2 | null;
  /** Engraved number on the bottom: centre (relative) and character height, or null. */
  label: { x: number; y: number; h: number } | null;
  edge: boolean;
  /** Tip sticks out past the footprint (only when clampOverhang is off). */
  overhang: boolean;
}

export function buildTile(p: DesignParams, cell: Cell, s: FieldSample, color: number, id: number): Tile {
  const t = p.tiles;
  const [cx, cy] = cell.center;
  const base: Polygon = cell.footprint.map(([x, y]) => [x - cx, y - cy]);
  const inr = Math.max(0.5, insideDistance([0, 0], base));

  const maxRise = Math.max(t.minRise, p.depth - p.backplate.thickness - t.wall);
  const rise = t.minRise + s.h * (maxRise - t.minRise);
  const topZ = t.wall + rise;

  const scale = Math.max(0, Math.min(0.9, t.topScale));
  let top: Vec3[];
  let overhang = false;

  if (scale < 0.02) {
    const maxOff = t.clampOverhang ? 0.85 * inr : 1.6 * inr;
    let ax = s.ox * maxOff;
    let ay = s.oy * maxOff;
    if (t.clampOverhang) {
      // Make sure the apex really lies inside the (possibly clipped) footprint.
      for (let k = 0; k < 20 && insideDistance([ax, ay], base) < 0.1 * inr; k++) {
        ax *= 0.85;
        ay *= 0.85;
      }
    } else {
      overhang = insideDistance([ax, ay], base) < 0;
    }
    top = [[ax, ay, topZ]];
  } else {
    const room = (1 - scale) * inr * 0.9;
    const ox = s.ox * room;
    const oy = s.oy * room;
    const m = Math.hypot(s.ox, s.oy);
    // Tilt the flat top along the lean direction.
    const tilt = m > 1e-6 ? (0.6 * rise) / inr : 0;
    const dx = m > 1e-6 ? s.ox / m : 0;
    const dy = m > 1e-6 ? s.oy / m : 0;
    top = base.map(([x, y]) => {
      const px = x * scale + ox;
      const py = y * scale + oy;
      const z = topZ + tilt * m * (px * dx + py * dy);
      return [px, py, Math.min(t.wall + maxRise, Math.max(t.wall + 0.6, z))] as Vec3;
    });
  }

  const height = Math.max(...top.map((q) => q[2]));
  const spec = pinSpec(p);
  const socket = !!spec && inr >= (spec.d + spec.clearance) / 2 + 1.2;
  const tile: Tile = { id, i: cell.i, j: cell.j, center: cell.center, color, base, top, height, socket, key: null, label: null, edge: cell.edge, overhang };
  placeKey(p, tile);
  placeLabel(p, tile);
  return tile;
}

/** Radius of a socket opening on the tile bottom (bore + entry chamfer). */
export function socketEntryR(d: number, clearance: number): number {
  return (d + clearance + 0.8) / 2;
}

/** Sockets on a tile bottom: [x, y, entry radius]. */
export function socketCircles(p: DesignParams, t: Tile): [number, number, number][] {
  const spec = pinSpec(p);
  if (!spec) return [];
  const out: [number, number, number][] = [];
  if (t.socket) out.push([0, 0, socketEntryR(spec.d, spec.clearance)]);
  if (t.key) out.push([t.key[0], t.key[1], socketEntryR(spec.keyD, spec.clearance)]);
  return out;
}

/**
 * Second pin, off centre. With two pins a tile fits only one way round, even
 * when its outline is symmetric. Prefer "up" so keys line up across the board.
 */
export function placeKey(p: DesignParams, t: Tile, accept: (k: Vec2) => boolean = () => true) {
  t.key = null;
  const spec = pinSpec(p);
  if (!spec || !t.socket || !p.mount.keyPin) return;
  const mainR = socketEntryR(spec.d, spec.clearance);
  const keyR = socketEntryR(spec.keyD, spec.clearance);
  const dist = mainR + keyR + 1.2;
  for (const deg of [90, 270, 0, 180, 45, 135, 225, 315]) {
    const a = (deg * Math.PI) / 180;
    for (let o = dist; o <= dist + 6; o += 1) {
      const k: Vec2 = [o * Math.cos(a), o * Math.sin(a)];
      if (insideDistance(k, t.base) >= keyR + 1 && accept(k)) {
        t.key = k;
        return;
      }
    }
  }
}

/** Find room for the tile number on the bottom, clear of the sockets. */
export function placeLabel(p: DesignParams, t: Tile) {
  t.label = null;
  if (!p.mount.labels) return;
  const text = String(t.id + 1);
  const holes = socketCircles(p, t);
  const room = insetConvex(t.base, 0.8);
  if (room.length < 3) return;
  const fits = (x: number, y: number, w: number, hh: number) => {
    const corners: Vec2[] = [[x - w / 2, y - hh / 2], [x + w / 2, y - hh / 2], [x + w / 2, y + hh / 2], [x - w / 2, y + hh / 2]];
    if (!corners.every((c) => pointInConvex(c, room))) return false;
    return holes.every(([sx, sy, sr]) => {
      const dx = Math.max(Math.abs(sx - x) - w / 2, 0);
      const dy = Math.max(Math.abs(sy - y) - hh / 2, 0);
      return Math.hypot(dx, dy) >= sr + 0.6;
    });
  };
  const inr = insideDistance([0, 0], t.base);
  const away = t.key ? Math.atan2(-t.key[1], -t.key[0]) : -Math.PI / 2;
  const dirs = [away, away + Math.PI / 2, away - Math.PI / 2, away + Math.PI];
  const sizes = (from: number) => {
    const out: number[] = [];
    for (let h = Math.min(LABEL.maxHeight, Math.max(LABEL.minHeight, from * 0.45)); h >= LABEL.minHeight - 1e-9; h -= 0.5) out.push(h);
    return out;
  };
  // Preferred: on a line from the centre, away from the key pin.
  for (const h of sizes(inr)) {
    const { w, h: hh } = labelSize(text, h);
    for (const a of dirs) {
      for (let r = 0; r <= inr; r += 0.5) {
        const x = r * Math.cos(a);
        const y = r * Math.sin(a);
        if (fits(x, y, w, hh)) {
          t.label = { x, y, h };
          return;
        }
      }
    }
  }
  // Clipped edge tiles can have their pin near one side and room elsewhere:
  // search the whole bottom, closest to the centre first.
  const b = bbox(t.base);
  const grid: Vec2[] = [];
  for (let x = b.minX; x <= b.maxX; x += 0.5) for (let y = b.minY; y <= b.maxY; y += 0.5) if (insideDistance([x, y], t.base) > LABEL.minHeight / 2) grid.push([x, y]);
  if (!grid.length) return;
  grid.sort((u, v) => Math.hypot(u[0], u[1]) - Math.hypot(v[0], v[1]));
  const widest = Math.max(...grid.map((g) => insideDistance(g, t.base)));
  for (const h of sizes(widest)) {
    const { w, h: hh } = labelSize(text, h);
    for (const [x, y] of grid) {
      if (fits(x, y, w, hh)) {
        t.label = { x, y, h };
        return;
      }
    }
  }
}

/** Triangle mesh of a tile body (no socket). Same layout the OpenSCAD module uses. */
export function tileMesh(tile: Tile, wall: number): { positions: Vec3[]; faces: [number, number, number][] } {
  const n = tile.base.length;
  const m = tile.top.length;
  const positions: Vec3[] = [
    ...tile.base.map(([x, y]) => [x, y, 0] as Vec3),
    ...tile.base.map(([x, y]) => [x, y, wall] as Vec3),
    ...tile.top,
  ];
  const faces: [number, number, number][] = [];
  // Bottom (fan; viewed from below it is clockwise = outward per OpenSCAD).
  for (let i = 1; i < n - 1; i++) faces.push([0, i, i + 1]);
  // Straight walls.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, n + i, n + j], [i, n + j, j]);
  }
  if (m === 1) {
    for (let i = 0; i < n; i++) faces.push([n + i, 2 * n, n + ((i + 1) % n)]);
  } else {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push([n + i, 2 * n + i, 2 * n + j], [n + i, 2 * n + j, n + j]);
    }
    for (let i = 1; i < m - 1; i++) faces.push([2 * n, 2 * n + i + 1, 2 * n + i]);
  }
  return { positions, faces };
}
