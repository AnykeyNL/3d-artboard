// File writers: binary STL, 3MF, the assembly map (SVG) and the full print pack (zip).
import { zipSync, strToU8 } from 'fflate';
import { Design } from './design';
import { Mesh, tileSolid, tileOptions, sectionSolid, keySolid, fitTestSolids } from './mesh';
import { toScad } from './scad';
import { bbox, centroid } from './geometry';

export function toBinarySTL(meshes: Mesh[], name = 'artboard'): Uint8Array {
  const count = meshes.reduce((n, m) => n + m.triangleCount, 0);
  const buf = new ArrayBuffer(84 + count * 50);
  const dv = new DataView(buf);
  const header = `3D ArtBoard ${name}`.slice(0, 80);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, count, true);
  let o = 84;
  for (const m of meshes) {
    const t = m.tris;
    for (let i = 0; i < t.length; i += 9) {
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
      const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, t[i + k], true);
      dv.setUint16(o + 48, 0, true);
      o += 50;
    }
  }
  return new Uint8Array(buf);
}

/** Indexed vertices for 3MF; welds identical positions. */
function indexMesh(m: Mesh): { verts: number[]; idx: number[] } {
  const map = new Map<string, number>();
  const verts: number[] = [];
  const idx: number[] = [];
  const t = m.tris;
  for (let i = 0; i < t.length; i += 3) {
    const k = `${t[i].toFixed(4)},${t[i + 1].toFixed(4)},${t[i + 2].toFixed(4)}`;
    let v = map.get(k);
    if (v === undefined) {
      v = verts.length / 3;
      map.set(k, v);
      verts.push(t[i], t[i + 1], t[i + 2]);
    }
    idx.push(v);
  }
  // Drop triangles that collapsed when welding.
  const out: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    if (idx[i] !== idx[i + 1] && idx[i + 1] !== idx[i + 2] && idx[i] !== idx[i + 2]) out.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  return { verts, idx: out };
}

/** 3MF with one object per mesh, each optionally coloured. */
export function to3MF(objects: { name: string; mesh: Mesh; color?: string }[]): Uint8Array {
  const colors = [...new Set(objects.map((o) => o.color ?? '#cccccc'))];
  const res: string[] = [];
  res.push(`<basematerials id="1">${colors.map((c, i) => `<base name="Colour ${i + 1}" displaycolor="${c.toUpperCase()}FF"/>`).join('')}</basematerials>`);
  const items: string[] = [];
  objects.forEach((o, i) => {
    const id = i + 2;
    const { verts, idx } = indexMesh(o.mesh);
    const vs: string[] = [];
    for (let k = 0; k < verts.length; k += 3) vs.push(`<vertex x="${r(verts[k])}" y="${r(verts[k + 1])}" z="${r(verts[k + 2])}"/>`);
    const ts: string[] = [];
    for (let k = 0; k < idx.length; k += 3) ts.push(`<triangle v1="${idx[k]}" v2="${idx[k + 1]}" v3="${idx[k + 2]}"/>`);
    const pi = colors.indexOf(o.color ?? '#cccccc');
    res.push(`<object id="${id}" type="model" name="${esc(o.name)}" pid="1" pindex="${pi}"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`);
    items.push(`<item objectid="${id}"/>`);
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">3D ArtBoard</metadata>
<resources>${res.join('')}</resources>
<build>${items.join('')}</build>
</model>`;
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    '3D/3dmodel.model': strToU8(model),
  });
}

const r = (n: number) => String(Math.round(n * 1e4) / 1e4);
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

// ---------- what goes where ----------

export interface PartIndex {
  /** tile id → [plate number, section number] (1-based). */
  tilePlate: Map<number, number>;
  tileSection: Map<number, number>;
}

export function partIndex(d: Design): PartIndex {
  const tilePlate = new Map<number, number>();
  const tileSection = new Map<number, number>();
  for (const pl of d.plates) if (pl.kind === 'tiles') for (const it of pl.items) tilePlate.set(it.ref, pl.id + 1);
  for (const s of d.sections) for (const id of s.tiles) tileSection.set(id, s.id + 1);
  return { tilePlate, tileSection };
}

function textColor(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return l > 0.55 ? '#1d1d1f' : '#ffffff';
}

/** Board seen from the front: tile numbers, colours and backplate sections. */
export function assemblyMapSVG(d: Design): string {
  const b = bbox(d.outline);
  const pad = 30;
  const W = b.maxX - b.minX + pad * 2;
  const H = b.maxY - b.minY + pad * 2 + 40;
  const X = (x: number) => (x - b.minX + pad).toFixed(2);
  const Y = (y: number) => (b.maxY - y + pad + 40).toFixed(2);
  const pts = (poly: number[][], dx = 0, dy = 0) => poly.map(([x, y]) => `${X(x + dx)},${Y(y + dy)}`).join(' ');
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${(W / 2).toFixed(0)}mm" height="${(H / 2).toFixed(0)}mm" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  const p = d.params;
  out.push(`<text x="${pad}" y="26" font-size="16" font-weight="bold" fill="#1d1d1f">3D ArtBoard · ${p.width} × ${p.height} mm · ${d.tiles.length} tiles · seen from the front · scale 1:2</text>`);
  out.push(`<polygon points="${pts(d.outline)}" fill="#efece6" stroke="#8d877c" stroke-width="1"/>`);
  for (const t of d.tiles) {
    const hex = d.palette[t.color];
    out.push(`<polygon points="${pts(t.base, t.center[0], t.center[1])}" fill="${hex}" stroke="#55514a" stroke-width="0.4"/>`);
  }
  for (const s of d.sections) {
    out.push(`<polygon points="${pts(s.poly)}" fill="none" stroke="#1f6f78" stroke-width="2.5" stroke-dasharray="8 5"/>`);
  }
  for (const t of d.tiles) {
    const hex = d.palette[t.color];
    const size = Math.max(4, Math.min(14, p.tiles.size * 0.22));
    out.push(`<text x="${X(t.center[0])}" y="${Y(t.center[1])}" font-size="${size.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="${textColor(hex)}">${t.id + 1}</text>`);
  }
  for (const s of d.sections) {
    const [cx, cy] = centroid(s.poly);
    out.push(`<text x="${X(cx)}" y="${Y(cy)}" font-size="30" font-weight="bold" fill="#1f6f78" fill-opacity="0.9" stroke="#ffffff" stroke-width="5" stroke-opacity="0.85" paint-order="stroke" text-anchor="middle" dominant-baseline="central">S${s.id + 1}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

/** Printable plate sheet: where each numbered tile sits on the bed. */
export function plateMapSVG(d: Design, plateId: number): string {
  const pl = d.plates[plateId];
  const { bedX, bedY } = d.params.printer;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bedX} ${bedY + 20}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#fff"/><rect y="20" width="${bedX}" height="${bedY}" fill="#f4f4f4" stroke="#999"/>`);
  out.push(`<text x="4" y="14" font-size="10" font-weight="bold">Plate ${pl.id + 1} · ${pl.kind === 'keys' ? 'bowtie keys' : `colour ${pl.color + 1} ${d.palette[pl.color]}`}</text>`);
  for (const it of pl.items) {
    if (pl.kind === 'keys') continue;
    const t = d.tiles[it.ref];
    const pts = t.base.map(([x, y]) => `${(x + it.x).toFixed(2)},${(bedY - (y + it.y) + 20).toFixed(2)}`).join(' ');
    out.push(`<polygon points="${pts}" fill="${d.palette[t.color]}" stroke="#333" stroke-width="0.4"/>`);
    out.push(`<text x="${it.x.toFixed(1)}" y="${(bedY - it.y + 20).toFixed(1)}" font-size="${Math.max(3, Math.min(9, d.params.tiles.size * 0.2)).toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="${textColor(d.palette[t.color])}">${t.id + 1}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

// ---------- the print pack ----------

export type MeshFormat = 'stl' | '3mf';

export interface PackOptions {
  format: MeshFormat;
  onProgress?: (done: number, total: number, label: string) => void;
}

const pad3 = (n: number) => String(n).padStart(3, '0');

export function plateMeshes(d: Design, plateId: number): { name: string; mesh: Mesh; color: string }[] {
  const pl = d.plates[plateId];
  if (pl.kind === 'keys') {
    const key = keySolid(d);
    return pl.items.map((it, k) => ({ name: `key ${k + 1}`, mesh: key.translated(it.x, it.y), color: '#d8d4cc' }));
  }
  return pl.items.map((it) => {
    const t = d.tiles[it.ref];
    return { name: `tile ${t.id + 1}`, mesh: tileSolid(t, tileOptions(d, t)).translated(it.x, it.y), color: d.palette[t.color] };
  });
}

export function sectionMesh(d: Design, sectionId: number): Mesh {
  const s = d.sections[sectionId];
  const b = bbox(s.poly);
  const m = d.params.printer.margin;
  return sectionSolid(d, s).translated(m - b.minX, m - b.minY);
}

function writeMesh(objs: { name: string; mesh: Mesh; color?: string }[], format: MeshFormat, name: string): Uint8Array {
  return format === 'stl' ? toBinarySTL(objs.map((o) => o.mesh), name) : to3MF(objs);
}

/** Everything needed to print and assemble the board, as one zip. Yields between parts. */
export async function buildPrintPack(d: Design, opts: PackOptions): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const ext = opts.format;
  const total = d.sections.length + d.plates.length + 3;
  let done = 0;
  const step = async (label: string) => {
    done++;
    opts.onProgress?.(done, total, label);
    await new Promise((r) => setTimeout(r, 0));
  };
  const idx = partIndex(d);

  for (const s of d.sections) {
    files[`backplate/section-${pad3(s.id + 1)}.${ext}`] = writeMesh([{ name: `section ${s.id + 1}`, mesh: sectionMesh(d, s.id), color: '#d8d4cc' }], ext, `section ${s.id + 1}`);
    await step(`Backplate section ${s.id + 1}`);
  }
  for (const pl of d.plates) {
    const objs = plateMeshes(d, pl.id);
    const dir = pl.kind === 'keys' ? 'keys' : `tiles/colour-${pl.color + 1}-${d.palette[pl.color].slice(1)}`;
    files[`${dir}/plate-${pad3(pl.id + 1)}.${ext}`] = writeMesh(objs, ext, `plate ${pl.id + 1}`);
    if (pl.kind === 'tiles') files[`${dir}/plate-${pad3(pl.id + 1)}-map.svg`] = strToU8(plateMapSVG(d, pl.id));
    await step(`Plate ${pl.id + 1}`);
  }
  if (d.params.mount.type === 'pressfit') {
    files[`fit-test.${ext}`] = writeMesh([{ name: 'fit test', mesh: fitTestSolids(d), color: '#d8d4cc' }], ext, 'fit test');
  }
  await step('Fit test');

  files['assembly-map.svg'] = strToU8(assemblyMapSVG(d));
  files['artboard.scad'] = strToU8(toScad(d));
  files['design.json'] = strToU8(JSON.stringify(d.params, null, 2));
  const rows = ['tile,colour,colour_hex,plate,section,x_mm,y_mm,height_mm,mount'];
  for (const t of d.tiles) {
    rows.push([t.id + 1, t.color + 1, d.palette[t.color], idx.tilePlate.get(t.id) ?? '', idx.tileSection.get(t.id) ?? '', t.center[0].toFixed(1), t.center[1].toFixed(1), t.height.toFixed(1), t.socket ? 'pin' : 'glue'].join(','));
  }
  files['tiles.csv'] = strToU8(rows.join('\n') + '\n');
  files['README.txt'] = strToU8(packReadme(d, ext));
  await step('Assembly map');

  return zipSync(files, { level: 6 });
}

function packReadme(d: Design, ext: string): string {
  const p = d.params;
  const s = d.stats;
  const kg = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(1)} kg` : `${g} g`);
  const lines = [
    '3D ArtBoard print pack',
    '======================',
    '',
    `Board: ${p.width} x ${p.height} mm, depth ${p.depth} mm, ${p.outline} outline.`,
    `Tiles: ${s.tiles} ${p.tiles.shape} tiles, ${d.palette.length} colour(s), ${p.mount.type === 'pressfit' ? 'press-fit pins' : 'glue'}.`,
    `Backplate: ${s.sections} section(s), ${s.keys} bowtie key(s).`,
    `Plates: ${s.plates} (bed ${p.printer.bedX} x ${p.printer.bedY} mm).`,
    '',
    'Filament (rough estimate, ~15% infill):',
    ...d.palette.map((hex, i) => `  colour ${i + 1} ${hex}: ${s.tilesPerColor[i]} tiles, ${kg(s.gramsPerColor[i])}`),
    `  backplate: ${kg(s.backplateGrams)}`,
    '',
    'What is in here',
    '---------------',
    ...([
      [`backplate/section-NNN.${ext}`, 'one file per backplate section, already flat on the bed'],
      ['tiles/colour-N-RRGGBB/', `one folder per colour; plate-NNN.${ext} is a full bed of tiles`],
      ['', 'and plate-NNN-map.svg shows which tile number sits where'],
      ['keys/', `bowtie keys that join backplate sections (${s.keys} needed)`],
      ...(p.mount.type === 'pressfit' ? [[`fit-test.${ext}`, 'print this first (see below)']] : []),
      ['assembly-map.svg', 'the board seen from the front, every tile numbered, sections S1, S2, ...'],
      ['tiles.csv', 'tile number, colour, plate, section and position'],
      ['artboard.scad', 'the same design as OpenSCAD code (part/index select what to render)'],
      ['design.json', 'load this in the app to change the design later'],
    ] as string[][]).map(([a, b]) => `${a.padEnd(30)}${b}`),
    '',
    'How to build it',
    '---------------',
  ];
  if (p.mount.type === 'pressfit') {
    lines.push(
      '1. Print fit-test first. The blocks get taller as the socket gets looser',
      '   (0.05, 0.10, 0.15, 0.20, 0.30 mm). Pick the block that pushes on firmly,',
      `   set that as "Fit clearance" in the app (now ${p.mount.clearance} mm) and export again if it changed.`,
    );
  } else {
    lines.push('1. Glue mode: the backplate has the outline of every tile engraved on top as a placing guide.');
  }
  lines.push(
    '2. Print the backplate sections and the keys. Lay the sections face down: the layout is then',
    '   the assembly map mirrored left to right. Press a key into each bowtie pocket across the',
    '   seams and glue it.',
    '3. Print the tile plates. Keep each plate\'s tiles together: plates hold neighbouring tiles',
    '   in reading order (top row first, left to right), and the plate maps show the numbers.',
    '4. Turn the backplate over and fit the tiles using assembly-map.svg, starting at the top left.',
    '',
    'Print tips: tiles print base-down with no supports. Use 2-3 walls and 10-15% infill.',
  );
  return lines.join('\n') + '\n';
}
