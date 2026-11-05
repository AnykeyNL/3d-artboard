// Turn a laid-out cell plus a pattern sample into a printable tile solid.
import { DesignParams } from './params';
import { Cell } from './layout';
import { FieldSample } from './patterns';
import { Polygon, Vec2, Vec3, insideDistance } from './geometry';

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
  /** Has a press-fit socket (and the backplate a pin under it). */
  socket: boolean;
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
  const socket =
    p.mount.type === 'pressfit' && inr >= (p.mount.pinDiameter + p.mount.clearance) / 2 + 1.2;

  return { id, i: cell.i, j: cell.j, center: cell.center, color, base, top, height, socket, edge: cell.edge, overhang };
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
