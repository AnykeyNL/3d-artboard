// Emit a single self-contained OpenSCAD file for a design. Open it in OpenSCAD
// and pick what to render with `part` and `index`, e.g.
//   openscad -D 'part="section"' -D index=0 -o section0.stl artboard.scad
import { Design } from './design';
import { KEY } from './backplate';
import { bbox } from './geometry';

const f = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const v2 = (p: number[]) => `[${f(p[0])},${f(p[1])}]`;
const v3 = (p: number[]) => `[${f(p[0])},${f(p[1])},${f(p[2])}]`;
const list = <T>(xs: T[], fn: (x: T) => string, sep = ',') => `[${xs.map(fn).join(sep)}]`;

export const SCAD_LIBRARY = String.raw`
// ---------- library ----------
module tile_body(b, t) {
  n = len(b);
  m = len(t);
  pts = concat([for (p = b) [p[0], p[1], 0]], [for (p = b) [p[0], p[1], WALL]], t);
  bottom = [for (i = [1:n-2]) [0, i, i+1]];
  walls = [for (i = [0:n-1]) let(j = (i+1) % n) each [[i, n+i, n+j], [i, n+j, j]]];
  top = m == 1
    ? [for (i = [0:n-1]) [n+i, 2*n, n + (i+1) % n]]
    : concat(
        [for (i = [0:n-1]) let(j = (i+1) % n) each [[n+i, 2*n+i, 2*n+j], [n+i, 2*n+j, n+j]]],
        [for (i = [1:m-2]) [2*n, 2*n+i+1, 2*n+i]]);
  polyhedron(points = pts, faces = concat(bottom, walls, top), convexity = 4);
}

module tile(i) {
  t = TILES[i];
  difference() {
    tile_body(t[3], t[4]);
    if (t[5] == 1) {
      translate([0, 0, -0.01]) cylinder(d = SOCKET_D, h = SOCKET_H + 0.01);
      translate([0, 0, -0.01]) cylinder(d1 = SOCKET_D + 0.8, d2 = SOCKET_D, h = 0.41);
    }
  }
}

module pin() {
  cylinder(d = PIN_D, h = PIN_H - 0.6);
  translate([0, 0, PIN_H - 0.6]) cylinder(d1 = PIN_D, d2 = PIN_D - 1, h = 0.6);
}

module bowtie(grow = 0) {
  offset(delta = grow) polygon(KEY_SHAPE);
}

module key() {
  linear_extrude(KEY_T) bowtie();
}

// Section in board coordinates.
module section_abs(i) {
  s = SECTIONS[i];
  difference() {
    linear_extrude(PLATE_T) polygon(s[1]);
    if (len(s[3]) > 0)
      for (k = s[3]) translate([k[0], k[1], -0.01]) rotate(k[2])
        linear_extrude(KEY_T + 0.2 + 0.01) bowtie(KEY_CLEAR);
    if (MOUNT == "glue" && GUIDES && len(s[4]) > 0)
      for (ti = s[4]) let(t = TILES[ti])
        translate([t[0], t[1], PLATE_T - GUIDE_DEPTH])
          linear_extrude(GUIDE_DEPTH + 0.01)
            difference() { offset(delta = GUIDE_W / 2) polygon(t[3]); offset(delta = -GUIDE_W / 2) polygon(t[3]); }
  }
  if (len(s[2]) > 0) for (q = s[2]) translate([q[0], q[1], PLATE_T - 0.01]) pin();
}

// Section moved to the print-bed origin.
module section(i) {
  translate([BED_MARGIN - SECTIONS[i][0][0], BED_MARGIN - SECTIONS[i][0][1], 0]) section_abs(i);
}

module plate(i) {
  pl = PLATES[i];
  for (it = pl[2]) translate([it[1], it[2], 0]) {
    if (pl[0] == "tiles") tile(it[0]); else key();
  }
}

module assembly() {
  for (i = [0:len(SECTIONS)-1]) color(PLATE_COLOR) section_abs(i);
  for (i = [0:len(TILES)-1]) let(t = TILES[i])
    color(COLORS[t[2]]) translate([t[0], t[1], PLATE_T]) tile(i);
}

// Small test strip: one pin per clearance so you can find the right fit
// before printing hundreds of tiles. Clearances from left to right; the blocks
// get taller (and have more dots) as the socket gets looser.
module fit_test() {
  cl = [0.05, 0.1, 0.15, 0.2, 0.3];
  difference() {
    cube([len(cl) * 14 + 4, 14, PLATE_T]);
    for (k = [0:len(cl)-1]) for (d = [0:k]) translate([6 + k * 14 + d * 1.6 - k * 0.8, 2, PLATE_T - 0.6]) cylinder(d = 1, h = 1, $fn = 8);
  }
  for (k = [0:len(cl)-1]) translate([9 + k * 14, 8, PLATE_T - 0.01]) pin();
  for (k = [0:len(cl)-1]) translate([9 + k * 14, 30, 0]) difference() {
    translate([-6, -6, 0]) cube([12, 12, PIN_H + 2 + k]);
    translate([0, 0, -0.01]) cylinder(d = PIN_D + cl[k], h = PIN_H + 0.4);
    for (d = [0:k]) translate([-4 + d * 1.6, 5.5, PIN_H + 1.5 + k]) cube([1, 1, 1]);
  }
}

if (part == "assembly") assembly();
else if (part == "section") section(index);
else if (part == "tile") tile(index);
else if (part == "plate") plate(index);
else if (part == "key") key();
else if (part == "fit_test") fit_test();
`;

export function toScad(d: Design): string {
  const p = d.params;
  const socketD = p.mount.pinDiameter + p.mount.clearance;
  const lines: string[] = [];
  lines.push('// 3D ArtBoard — generated OpenSCAD design. Do not edit the data by hand;');
  lines.push('// change the parameters in the app and generate again.');
  lines.push(`// Board ${p.width} x ${p.height} x ${p.depth} mm, ${p.outline}, ${p.tiles.shape} tiles ${p.tiles.size} mm,`);
  lines.push(`// pattern ${p.pattern.type}, ${d.palette.length} colour(s), ${p.mount.type} mount.`);
  lines.push(`// ${d.stats.tiles} tiles, ${d.stats.sections} backplate section(s), ${d.stats.keys} key(s), ${d.stats.plates} plate(s).`);
  lines.push('//');
  lines.push('// part: assembly | section | tile | plate | key | fit_test');
  lines.push('part = "assembly";');
  lines.push('index = 0;');
  lines.push('$fn = 32;');
  lines.push('');
  lines.push(`PARAMS_JSON = ${JSON.stringify(JSON.stringify(p))};`);
  lines.push(`WALL = ${f(p.tiles.wall)};`);
  lines.push(`PLATE_T = ${f(p.backplate.thickness)};`);
  lines.push(`MOUNT = "${p.mount.type}";`);
  lines.push(`PIN_D = ${f(p.mount.pinDiameter)};`);
  lines.push(`PIN_H = ${f(p.mount.pinHeight)};`);
  lines.push(`SOCKET_D = ${f(socketD)};`);
  lines.push(`SOCKET_H = ${f(p.mount.pinHeight + 0.4)};`);
  lines.push(`GUIDES = ${p.mount.guides ? 'true' : 'false'};`);
  lines.push('GUIDE_DEPTH = 0.6;');
  lines.push('GUIDE_W = 0.8;');
  lines.push(`KEY_T = ${f(p.backplate.thickness / 2 - 0.2)};`);
  lines.push(`KEY_CLEAR = ${f(KEY.clearance)};`);
  lines.push(`KEY_SHAPE = ${list(keyShape(), v2)};`);
  lines.push(`BED_MARGIN = ${f(p.printer.margin)};`);
  lines.push('PLATE_COLOR = "#d8d4cc";');
  lines.push(`COLORS = ${list(d.palette, (c) => JSON.stringify(c))};`);
  lines.push('');
  lines.push('// TILES[i] = [x, y, colour, base polygon, top points, has socket]');
  lines.push('TILES = [');
  lines.push(
    d.tiles
      .map((t) => `  [${f(t.center[0])},${f(t.center[1])},${t.color},${list(t.base, v2)},${list(t.top, v3)},${t.socket ? 1 : 0}]`)
      .join(',\n'),
  );
  lines.push('];');
  lines.push('');
  lines.push('// SECTIONS[i] = [[minX, minY] of outline, outline, pins, key pockets [x, y, angle], tile ids]');
  lines.push('SECTIONS = [');
  lines.push(
    d.sections
      .map(
        (s) =>
          `  [${v2([bbox(s.poly).minX, bbox(s.poly).minY])},${list(s.poly, v2)},${list(s.pins, v2)},${list(s.keys, v3)},[${s.tiles.join(',')}]]`,
      )
      .join(',\n'),
  );
  lines.push('];');
  lines.push('');
  lines.push('// PLATES[i] = [kind, colour, [[tile id, x, y], ...]]');
  lines.push('PLATES = [');
  lines.push(
    d.plates
      .map((pl) => `  ["${pl.kind}",${pl.color},${list(pl.items, (it) => `[${it.ref},${f(it.x)},${f(it.y)}]`)}]`)
      .join(',\n'),
  );
  lines.push('];');
  lines.push(SCAD_LIBRARY);
  return lines.join('\n');
}

function keyShape(): number[][] {
  const L = KEY.length / 2;
  const W = KEY.endWidth / 2;
  const w = KEY.waist / 2;
  return [
    [-L, -W],
    [0, -w],
    [L, -W],
    [L, W],
    [0, w],
    [-L, W],
  ];
}
