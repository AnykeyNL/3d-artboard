import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  generateDesign, tileSolid, tileOptions, sectionSolid, keySolid, fitTestSolids, Mesh, toBinarySTL, to3MF,
  buildPrintPack, assemblyMapSVG, meshVolume, area, KEY, PartialParams,
} from '../src/core/index';
import polygonClipping from 'polygon-clipping';

function volume(m: Mesh): number {
  let v = 0;
  const t = m.tris;
  for (let i = 0; i < t.length; i += 9) {
    v += t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7])
      - t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6])
      + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6]);
  }
  return v / 6;
}

/** Every edge shared by exactly two triangles with opposite direction. */
function closed(m: Mesh): boolean {
  const key = (i: number) => `${m.tris[i].toFixed(4)},${m.tris[i + 1].toFixed(4)},${m.tris[i + 2].toFixed(4)}`;
  const edges = new Map<string, number>();
  for (let i = 0; i < m.tris.length; i += 9) {
    const v = [key(i), key(i + 3), key(i + 6)];
    for (let k = 0; k < 3; k++) {
      const e = `${v[k]}|${v[(k + 1) % 3]}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  for (const [e, n] of edges) {
    const [a, b] = e.split('|');
    if (n !== 1 || edges.get(`${b}|${a}`) !== 1) return false;
  }
  return true;
}

const cases: PartialParams[] = [
  { tiles: { shape: 'hex', size: 40 } },
  { tiles: { shape: 'square', size: 50, topScale: 0.5 }, pattern: { type: 'dunes' } },
  { tiles: { shape: 'triangle', size: 60 }, outline: 'circle', mount: { type: 'glue' } },
];

describe('tile meshes', () => {
  for (const c of cases) {
    it(`are closed and match the solid volume (${c.tiles?.shape})`, () => {
      const d = generateDesign(c);
      for (const t of d.tiles) {
        const o = tileOptions(d, t);
        const m = tileSolid(t, o);
        expect(closed(m)).toBe(true);
        const v = volume(m);
        expect(v).toBeGreaterThan(0);
        const socket = o.socketD ? Math.PI * (o.socketD / 2) ** 2 * o.socketH : 0;
        const expected = meshVolume(t, d.params.tiles.wall) - socket;
        expect(Math.abs(v - expected) / expected).toBeLessThan(0.03);
      }
    });
  }
});

describe('backplate meshes', () => {
  for (const c of cases) {
    it(`have the right volume (${c.outline ?? 'square'}, ${c.mount?.type ?? 'pressfit'})`, () => {
      const d = generateDesign({ ...c, width: 600, height: 520 });
      const p = d.params;
      for (const s of d.sections) {
        const m = sectionSolid(d, s);
        const v = volume(m);
        const plate = area(s.poly) * p.backplate.thickness;
        // Key pockets: the part of each bowtie that falls on this section.
        let pockets = 0;
        for (const [x, y, a] of s.keys) {
          const r = (a * Math.PI) / 180;
          const bt = KEY;
          void bt;
          const shape = [[-13, -7], [0, -3.5], [13, -7], [13, 7], [0, 3.5], [-13, 7]].map(([u, w]) => [x + u * Math.cos(r) - w * Math.sin(r), y + u * Math.sin(r) + w * Math.cos(r)] as [number, number]);
          const inter = polygonClipping.intersection([shape], [s.poly as [number, number][]]);
          pockets += inter.reduce((acc, poly) => acc + area(poly[0] as any), 0) * (p.backplate.thickness / 2);
        }
        const pins = p.mount.type === 'pressfit' ? s.pins.length * Math.PI * (p.mount.pinDiameter / 2) ** 2 * p.mount.pinHeight : 0;
        const expected = plate - pockets + pins;
        // Pins overlap the plate by 0.3 mm and pockets grow by the clearance; allow a few percent.
        expect(Math.abs(v - expected) / expected).toBeLessThan(0.04);
      }
    });
  }

  it('keys and fit test are closed solids', () => {
    const d = generateDesign({});
    expect(closed(keySolid(d))).toBe(true);
    expect(volume(fitTestSolids(d))).toBeGreaterThan(0);
  });
});

describe('files', () => {
  const d = generateDesign({ width: 400, height: 300, tiles: { size: 45 } });

  it('writes binary STL with the right triangle count', () => {
    const m = tileSolid(d.tiles[0], tileOptions(d, d.tiles[0]));
    const stl = toBinarySTL([m]);
    const n = new DataView(stl.buffer).getUint32(80, true);
    expect(n).toBe(m.triangleCount);
    expect(stl.length).toBe(84 + 50 * n);
  });

  it('writes a 3MF package', () => {
    const m = keySolid(d);
    const files = unzipSync(to3MF([{ name: 'key', mesh: m, color: '#ff0000' }]));
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toContain('<object id="2"');
    expect(model).toContain('displaycolor="#FF0000FF"');
  });

  it('builds a complete print pack', async () => {
    const zip = await buildPrintPack(d, { format: 'stl' });
    const names = Object.keys(unzipSync(zip));
    expect(names.filter((n) => n.startsWith('backplate/')).length).toBe(d.sections.length);
    expect(names.filter((n) => /^tiles\/.*\.stl$/.test(n)).length).toBe(d.plates.filter((p) => p.kind === 'tiles').length);
    for (const f of ['README.txt', 'assembly-map.svg', 'tiles.csv', 'artboard.scad', 'design.json', 'fit-test.stl']) expect(names).toContain(f);
    const csv = strFromU8(unzipSync(zip)['tiles.csv']).trim().split('\n');
    expect(csv.length).toBe(d.tiles.length + 1);
  });

  it('numbers tiles in reading order on the map', () => {
    const svg = assemblyMapSVG(d);
    expect(svg).toContain('>1</text>');
    expect(svg).toContain(`>${d.tiles.length}</text>`);
    const first = d.tiles[0].center;
    const last = d.tiles[d.tiles.length - 1].center;
    expect(first[1]).toBeGreaterThan(last[1]);
  });
});
