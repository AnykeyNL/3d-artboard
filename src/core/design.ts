// Build a whole design from parameters: tiles, backplate sections, plates and checks.
import { DesignParams, LIMITS, PartialParams, withDefaults } from './params';
import { layoutCells, outlinePolygon } from './layout';
import { samplePattern } from './patterns';
import { colorIndex, colorValue, paletteFor } from './colors';
import { Tile, buildTile, tileMesh } from './tile';
import { Section, buildSections, KEY } from './backplate';
import { Plate, packPlates } from './packing';
import { Polygon, Vec3, area, bbox } from './geometry';

export interface DesignStats {
  tiles: number;
  tilesPerColor: number[];
  pins: number;
  gluedTiles: number;
  sections: number;
  keys: number;
  plates: number;
  /** Rough filament use, grams per colour (tiles), plus backplate. */
  gramsPerColor: number[];
  backplateGrams: number;
  tallestTile: number;
}

export interface Design {
  params: DesignParams;
  outline: Polygon;
  palette: string[];
  tiles: Tile[];
  sections: Section[];
  plates: Plate[];
  keyCount: number;
  stats: DesignStats;
  warnings: string[];
  errors: string[];
}

/** PLA, with typical walls + ~15% infill this is roughly what a solid volume costs. */
const GRAMS_PER_CM3 = 1.24 * 0.55;

export function validate(p: DesignParams): string[] {
  const e: string[] = [];
  if (!(p.width > 0 && p.width <= LIMITS.maxWidth)) e.push(`Width must be between 1 and ${LIMITS.maxWidth} mm.`);
  if (!(p.height > 0 && p.height <= LIMITS.maxHeight)) e.push(`Height must be between 1 and ${LIMITS.maxHeight} mm.`);
  if (!(p.depth > 0 && p.depth <= LIMITS.maxDepth)) e.push(`Depth must be between 1 and ${LIMITS.maxDepth} mm.`);
  if (p.colors.count < LIMITS.minColors || p.colors.count > LIMITS.maxColors) e.push('Use 1 to 8 colours.');
  const minDepth = p.backplate.thickness + p.tiles.wall + p.tiles.minRise;
  if (p.depth < minDepth) e.push(`Depth must be at least ${minDepth} mm (backplate + tile wall + minimum rise).`);
  const usableX = p.printer.bedX - 2 * p.printer.margin;
  const usableY = p.printer.bedY - 2 * p.printer.margin;
  if (p.tiles.size * 1.2 > Math.min(usableX, usableY)) e.push(`Tiles must be smaller than about ${Math.floor(Math.min(usableX, usableY) / 1.2)} mm to fit the bed.`);
  if (p.tiles.size < 10) e.push('Tiles must be at least 10 mm.');
  if (p.depth - p.backplate.thickness > p.printer.bedZ) e.push(`Tiles can be at most ${p.printer.bedZ} mm tall.`);
  if (p.mount.type === 'pressfit' && p.tiles.wall < p.mount.pinHeight + 1.2) {
    e.push(`With press-fit pins the tile wall must be at least ${p.mount.pinHeight + 1.2} mm (pin height + 1.2).`);
  }
  if (p.mount.pinHeight >= p.backplate.thickness * 3) e.push('Pins are too tall for this backplate.');
  return e;
}

export function generateDesign(input: PartialParams | DesignParams): Design {
  const params = withDefaults(input as PartialParams);
  const errors = validate(params);
  const warnings: string[] = [];
  const outline = outlinePolygon(params);
  const palette = paletteFor(params);

  if (errors.length) {
    return {
      params, outline, palette, tiles: [], sections: [], plates: [], keyCount: 0, warnings, errors,
      stats: emptyStats(palette.length),
    };
  }

  const cells = layoutCells(params, outline);
  const tiles: Tile[] = cells.map((cell, id) => {
    const s = samplePattern(params, cell.center, cell.i, cell.j);
    const color = colorIndex(params, colorValue(params, cell.center, s, cell.i, cell.j), cell.i, cell.j);
    return buildTile(params, cell, s, color, id);
  });

  const unsocketed = params.mount.type === 'pressfit' ? tiles.filter((t) => !t.socket).length : 0;
  if (unsocketed) warnings.push(`${unsocketed} small edge tile(s) are too narrow for a pin and need glue.`);
  const overhangs = tiles.filter((t) => t.overhang).length;
  if (overhangs) warnings.push(`${overhangs} tile tip(s) overhang their base; turn on "keep tips inside" or expect supports.`);

  const { sections, warnings: sw } = buildSections(params, outline, tiles);
  warnings.push(...sw);

  // Each key joins two sections and is listed on both.
  const keyCount = sections.reduce((n, s) => n + s.keys.length, 0) / 2;
  const plates = packPlates(params, tiles, keyCount, palette.length);

  // Sanity checks: everything must fit the printer.
  const lim = { x: params.printer.bedX, y: params.printer.bedY };
  for (const s of sections) {
    const b = bbox(s.poly);
    if (b.maxX - b.minX > lim.x - 2 * params.printer.margin + 1e-6 || b.maxY - b.minY > lim.y - 2 * params.printer.margin + 1e-6) {
      errors.push(`Backplate section ${s.id + 1} is larger than the print bed.`);
    }
  }

  const tilesPerColor = palette.map((_, c) => tiles.filter((t) => t.color === c).length);
  const gramsPerColor = palette.map((_, c) =>
    tiles.filter((t) => t.color === c).reduce((g, t) => g + (meshVolume(t, params.tiles.wall) / 1000) * GRAMS_PER_CM3, 0),
  );
  const plateArea = sections.reduce((a, s) => a + area(s.poly), 0);
  const backplateGrams = ((plateArea * params.backplate.thickness) / 1000) * GRAMS_PER_CM3;

  return {
    params,
    outline,
    palette,
    tiles,
    sections,
    plates,
    keyCount,
    warnings,
    errors,
    stats: {
      tiles: tiles.length,
      tilesPerColor,
      pins: sections.reduce((n, s) => n + s.pins.length, 0),
      gluedTiles: tiles.filter((t) => !t.socket).length,
      sections: sections.length,
      keys: keyCount,
      plates: plates.length,
      gramsPerColor: gramsPerColor.map((g) => Math.round(g)),
      backplateGrams: Math.round(backplateGrams),
      tallestTile: Math.max(0, ...tiles.map((t) => t.height)),
    },
  };
}

function emptyStats(n: number): DesignStats {
  return {
    tiles: 0, tilesPerColor: Array(n).fill(0), pins: 0, gluedTiles: 0, sections: 0, keys: 0, plates: 0,
    gramsPerColor: Array(n).fill(0), backplateGrams: 0, tallestTile: 0,
  };
}

/** Volume (mm³) of a tile body via the divergence theorem. */
export function meshVolume(tile: Tile, wall: number): number {
  const { positions, faces } = tileMesh(tile, wall);
  let v = 0;
  for (const [a, b, c] of faces) {
    const p: Vec3 = positions[a];
    const q: Vec3 = positions[b];
    const r: Vec3 = positions[c];
    v += p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
  }
  // OpenSCAD winding (clockwise from outside) gives a negative signed volume.
  return Math.abs(v / 6);
}

export { KEY };
