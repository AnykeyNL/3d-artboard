import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDesign, tileMesh, bbox, toScad, PATTERNS, OutlineShape, TileShape, PartialParams } from '../src/core/index';

const outlines: OutlineShape[] = ['square', 'rounded', 'oval', 'circle'];
const shapes: TileShape[] = ['square', 'hex', 'triangle'];

function edgesClosed(faces: [number, number, number][]): boolean {
  // Manifold: every directed edge appears once and its reverse once.
  const seen = new Map<string, number>();
  for (const [a, b, c] of faces) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = `${u}>${v}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of seen) {
    const [u, v] = k.split('>');
    if (n !== 1 || seen.get(`${v}>${u}`) !== 1) return false;
  }
  return true;
}

describe('design generation', () => {
  for (const outline of outlines) {
    for (const shape of shapes) {
      it(`${outline} board with ${shape} tiles fits the printer`, () => {
        const d = generateDesign({ width: 620, height: 480, depth: 40, outline, tiles: { shape, size: 40 } });
        expect(d.errors).toEqual([]);
        expect(d.tiles.length).toBeGreaterThan(50);
        const p = d.params;
        const usable = p.printer.bedX - 2 * p.printer.margin;
        for (const s of d.sections) {
          const b = bbox(s.poly);
          expect(b.maxX - b.minX).toBeLessThanOrEqual(usable + 1e-6);
          expect(b.maxY - b.minY).toBeLessThanOrEqual(usable + 1e-6);
          // Pins must sit fully on their own section.
          for (const [x, y] of s.pins) {
            expect(x - p.mount.pinDiameter / 2).toBeGreaterThanOrEqual(s.cell.minX - 1e-6);
            expect(x + p.mount.pinDiameter / 2).toBeLessThanOrEqual(s.cell.maxX + 1e-6);
            expect(y - p.mount.pinDiameter / 2).toBeGreaterThanOrEqual(s.cell.minY - 1e-6);
            expect(y + p.mount.pinDiameter / 2).toBeLessThanOrEqual(s.cell.maxY + 1e-6);
          }
        }
        // Every tile lands on exactly one plate of its own colour, inside the bed.
        const placed = new Map<number, number>();
        for (const pl of d.plates.filter((q) => q.kind === 'tiles')) {
          for (const it of pl.items) {
            const t = d.tiles[it.ref];
            expect(t.color).toBe(pl.color);
            placed.set(it.ref, (placed.get(it.ref) ?? 0) + 1);
            const b = bbox([...t.base, ...t.top]);
            expect(it.x + b.minX).toBeGreaterThanOrEqual(p.printer.margin - 1e-6);
            expect(it.y + b.minY).toBeGreaterThanOrEqual(p.printer.margin - 1e-6);
            expect(it.x + b.maxX).toBeLessThanOrEqual(p.printer.bedX - p.printer.margin + 1e-6);
            expect(it.y + b.maxY).toBeLessThanOrEqual(p.printer.bedY - p.printer.margin + 1e-6);
          }
        }
        expect(placed.size).toBe(d.tiles.length);
        expect([...placed.values()].every((n) => n === 1)).toBe(true);
        // Depth limit is respected and meshes are closed.
        for (const t of d.tiles) {
          expect(p.backplate.thickness + t.height).toBeLessThanOrEqual(p.depth + 1e-6);
          expect(edgesClosed(tileMesh(t, p.tiles.wall).faces)).toBe(true);
        }
      });
    }
  }

  for (const { id } of PATTERNS) {
    for (const topScale of [0, 0.5]) {
      it(`pattern ${id} (topScale ${topScale}) gives valid tiles`, () => {
        const d = generateDesign({ width: 400, height: 400, pattern: { type: id }, tiles: { topScale }, colors: { count: 8 } });
        expect(d.errors).toEqual([]);
        for (const t of d.tiles) {
          expect(t.color).toBeGreaterThanOrEqual(0);
          expect(t.color).toBeLessThan(8);
          expect(t.overhang).toBe(false);
          expect(edgesClosed(tileMesh(t, d.params.tiles.wall).faces)).toBe(true);
        }
      });
    }
  }

  it('a 2 m × 2 m board splits into bed-sized sections', () => {
    const d = generateDesign({ width: 2000, height: 2000, depth: 200, tiles: { size: 80 } });
    expect(d.errors).toEqual([]);
    expect(d.stats.sections).toBeGreaterThanOrEqual(81);
    expect(d.stats.tallestTile).toBeLessThanOrEqual(195);
  });

  it('rejects sizes beyond the limits', () => {
    expect(generateDesign({ width: 2100 }).errors.length).toBeGreaterThan(0);
    expect(generateDesign({ depth: 250 }).errors.length).toBeGreaterThan(0);
    expect(generateDesign({ colors: { count: 9 } }).errors.length).toBeGreaterThan(0);
  });

  it('glue mode has no pins or sockets', () => {
    const d = generateDesign({ mount: { type: 'glue' } });
    expect(d.stats.pins).toBe(0);
    expect(d.tiles.every((t) => !t.socket)).toBe(true);
  });

  it('uses only the requested number of colours', () => {
    for (const count of [1, 2, 5, 8]) {
      const d = generateDesign({ colors: { count, mode: 'random' } });
      expect(new Set(d.tiles.map((t) => t.color)).size).toBeLessThanOrEqual(count);
      expect(d.palette.length).toBe(count);
    }
  });
});

let hasOpenscad = false;
try {
  execFileSync('openscad', ['--version'], { stdio: 'ignore' });
  hasOpenscad = true;
} catch {}

describe.skipIf(!hasOpenscad)('OpenSCAD output', () => {
  const params: PartialParams = { width: 300, height: 260, depth: 30, outline: 'oval', tiles: { shape: 'hex', size: 40 } };
  const dir = mkdtempSync(join(tmpdir(), 'artboard-'));
  const d = generateDesign(params);
  const scad = join(dir, 'artboard.scad');
  writeFileSync(scad, toScad(d));

  const render = (part: string, index = 0) => {
    const out = join(dir, `${part}${index}.stl`);
    const log = execFileSync('openscad', ['-D', `part="${part}"`, '-D', `index=${index}`, '-o', out, scad], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { log, stl: readFileSync(out, 'utf8') };
  };

  it.each([
    ['tile', 0],
    ['tile', d.tiles.findIndex((t) => t.edge)],
    ['section', 0],
    ['key', 0],
  ])('renders %s %i as a solid', (part, index) => {
    const { stl } = render(part as string, index as number);
    expect(stl.startsWith('solid')).toBe(true);
    expect((stl.match(/facet normal/g) ?? []).length).toBeGreaterThan(8);
  }, 120_000);
});
