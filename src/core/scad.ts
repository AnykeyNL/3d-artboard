// Emit a single self-contained OpenSCAD file for a design. Open it in OpenSCAD
// and pick what to render with `part` and `index`, e.g.
//   openscad -D 'part="section"' -D index=0 -o section0.stl artboard.scad
import { Design } from './design';
import { KEY } from './backplate';
import { bbox } from './geometry';
import { PAD, padSpokes, padCentres } from './mesh';
import { LABEL, pinSpec } from './params';
import type { Section } from './backplate';

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

module socket(d) {
  translate([0, 0, -0.01]) cylinder(d = d, h = SOCKET_H + 0.01);
  translate([0, 0, -0.01]) cylinder(d1 = d + 0.8, d2 = d, h = 0.41);
}

// Seven-segment digits, mirrored so the number reads right on the tile's bottom.
SEG7 = [[1,1,1,1,1,1,0],[0,1,1,0,0,0,0],[1,1,0,1,1,0,1],[1,1,1,1,0,0,1],[0,1,1,0,0,1,1],
        [1,0,1,1,0,1,1],[1,0,1,1,1,1,1],[1,1,1,0,0,0,0],[1,1,1,1,1,1,1],[1,1,1,1,0,1,1]];

module digit7(n, h) {
  s = max(0.7, 0.16 * h); w = 0.55 * h;
  segs = [[0, h-s, w, h], [w-s, (h-s)/2, w, h], [w-s, 0, w, (h+s)/2], [0, 0, w, s],
          [0, 0, s, (h+s)/2], [0, (h-s)/2, s, h], [0, (h-s)/2, w, (h+s)/2]];
  for (k = [0:6]) if (SEG7[n][k] == 1)
    translate([segs[k][0], segs[k][1]]) square([segs[k][2] - segs[k][0], segs[k][3] - segs[k][1]]);
}

module label2d(num, h) {
  st = str(num);
  w = 0.55 * h; gap = 0.25 * h;
  total = len(st) * w + (len(st) - 1) * gap;
  mirror([1, 0]) for (k = [0:len(st)-1])
    translate([-total / 2 + k * (w + gap), -h / 2]) digit7(ord(st[k]) - 48, h);
}

// TILES[i]: socket in the centre (t[5]), offset key socket (t[6]) so the tile
// fits one way only, and the tile number engraved in the bottom (t[7]).
module tile(i) {
  t = TILES[i];
  difference() {
    tile_body(t[3], t[4]);
    if (t[5] == 1) socket(SOCKET_D);
    if (len(t[6]) > 0) translate(t[6]) socket(KEY_SOCKET_D);
    if (len(t[7]) > 0) translate([t[7][0], t[7][1], -0.01]) linear_extrude(LABEL_DEPTH + 0.01) label2d(i + 1, t[7][2]);
  }
}

module pin(d = PIN_D) {
  cylinder(d = d, h = PIN_H - 0.6);
  translate([0, 0, PIN_H - 0.6]) cylinder(d1 = d, d2 = d - 1, h = 0.6);
}

module bowtie(grow = 0) {
  offset(delta = grow) polygon(KEY_SHAPE);
}

module key() {
  linear_extrude(KEY_T) bowtie();
}

// Backplate outline in 2D: solid, or an open honeycomb that keeps a solid rim,
// pads with spokes under pins (glue mode: under tile centres) and around key pockets.
HC_R = HC_CELL / sqrt(3);
HC_DX = 1.5 * HC_R;
HC_DY = sqrt(3) * HC_R;
HC_HOLE = (HC_CELL / 2 - HC_RIB / 2) * 2 / sqrt(3);

module hc_holes(lo, hi) {
  for (i = [floor(lo[0] / HC_DX) - 1 : ceil(hi[0] / HC_DX) + 1])
    for (j = [floor(lo[1] / HC_DY) - 1 : ceil(hi[1] / HC_DY) + 1])
      translate([i * HC_DX, j * HC_DY + (i % 2 == 0 ? 0 : HC_DY / 2)]) circle(r = HC_HOLE, $fn = 6);
}

module hc_solids(s) {
  pad_r = (PINS ? PIN_D : 8) / 2 + PAD_MARGIN;
  centres = PINS ? concat(s[2], s[7]) : [for (ti = s[4]) [TILES[ti][0], TILES[ti][1]]];
  for (c = centres) translate(c) circle(r = pad_r, $fn = 20);
  for (sp = s[6]) translate([sp[0], sp[1]]) rotate(sp[2]) translate([0, -HC_RIB / 2]) square([sp[3], HC_RIB]);
  for (k = s[3]) translate([k[0], k[1]]) rotate(k[2]) bowtie(PAD_MARGIN);
}

module web2d(i) {
  s = SECTIONS[i];
  if (BACKPLATE == "honeycomb")
    difference() {
      polygon(s[1]);
      difference() {
        intersection() { hc_holes(s[0], s[5]); offset(delta = -HC_RIM) polygon(s[1]); }
        hc_solids(s);
      }
    }
  else polygon(s[1]);
}

// Section in board coordinates.
module section_abs(i) {
  s = SECTIONS[i];
  difference() {
    linear_extrude(PLATE_T) web2d(i);
    if (len(s[3]) > 0)
      for (k = s[3]) translate([k[0], k[1], -0.01]) rotate(k[2])
        linear_extrude(KEY_T + 0.2 + 0.01) bowtie(KEY_CLEAR);
    if (MOUNT == "glue" && GUIDES && len(s[4]) > 0)
      for (ti = s[4]) let(t = TILES[ti])
        translate([t[0], t[1], PLATE_T - GUIDE_DEPTH])
          linear_extrude(GUIDE_DEPTH + 0.01)
            difference() { offset(delta = GUIDE_W / 2) polygon(t[3]); offset(delta = -GUIDE_W / 2) polygon(t[3]); }
  }
  if (PINS) {
    for (q = s[2]) translate([q[0], q[1], PLATE_T - 0.01]) pin();
    for (q = s[7]) translate([q[0], q[1], PLATE_T - 0.01]) pin(KEY_PIN_D);
  }
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
  const spec = pinSpec(p);
  const pin = spec ?? { d: p.mount.pinDiameter, h: p.mount.pinHeight, clearance: p.mount.clearance, keyD: 3 };
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
  lines.push(`PINS = ${spec ? 'true' : 'false'}; // pins on the backplate (press-fit, or short locators in glue mode)`);
  lines.push(`PIN_D = ${f(pin.d)};`);
  lines.push(`PIN_H = ${f(pin.h)};`);
  lines.push(`KEY_PIN_D = ${f(pin.keyD)};`);
  lines.push(`SOCKET_D = ${f(pin.d + pin.clearance)};`);
  lines.push(`KEY_SOCKET_D = ${f(pin.keyD + pin.clearance)};`);
  lines.push(`SOCKET_H = ${f(pin.h + 0.4)};`);
  lines.push(`LABEL_DEPTH = ${f(LABEL.depth)};`);
  lines.push(`GUIDES = ${p.mount.guides ? 'true' : 'false'};`);
  lines.push('GUIDE_DEPTH = 0.6;');
  lines.push('GUIDE_W = 0.8;');
  lines.push(`BACKPLATE = "${p.backplate.style}";`);
  lines.push(`HC_CELL = ${f(p.backplate.cell)};`);
  lines.push(`HC_RIB = ${f(p.backplate.rib)};`);
  lines.push(`HC_RIM = ${f(p.backplate.rim)};`);
  lines.push(`PAD_MARGIN = ${PAD.margin};`);
  lines.push(`KEY_T = ${f(p.backplate.thickness / 2 - 0.2)};`);
  lines.push(`KEY_CLEAR = ${f(KEY.clearance)};`);
  lines.push(`KEY_SHAPE = ${list(keyShape(), v2)};`);
  lines.push(`BED_MARGIN = ${f(p.printer.margin)};`);
  lines.push('PLATE_COLOR = "#d8d4cc";');
  lines.push(`COLORS = ${list(d.palette, (c) => JSON.stringify(c))};`);
  lines.push('');
  lines.push('// TILES[i] = [x, y, colour, base polygon, top points, has socket, key socket [x, y], label [x, y, height]]');
  lines.push('TILES = [');
  lines.push(
    d.tiles
      .map((t) => `  [${f(t.center[0])},${f(t.center[1])},${t.color},${list(t.base, v2)},${list(t.top, v3)},${t.socket ? 1 : 0},${t.key ? v2(t.key) : '[]'},${t.label ? v3([t.label.x, t.label.y, t.label.h]) : '[]'}]`)
      .join(',\n'),
  );
  lines.push('];');
  lines.push('');
  lines.push('// SECTIONS[i] = [[minX, minY] of outline, outline, pins, key pockets [x, y, angle], tile ids, [maxX, maxY], pad spokes [x, y, angle, length], key pins]');
  lines.push('SECTIONS = [');
  lines.push(
    d.sections
      .map(
        (s) =>
          `  [${v2([bbox(s.poly).minX, bbox(s.poly).minY])},${list(s.poly, v2)},${list(s.pins, v2)},${list(s.keys, v3)},[${s.tiles.join(',')}],${v2([bbox(s.poly).maxX, bbox(s.poly).maxY])},${list(spokesFor(d, s), (q) => `[${q.map(f).join(',')}]`)},${list(s.keyPins, v2)}]`,
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

function spokesFor(d: Design, s: Section): number[][] {
  const p = d.params;
  if (p.backplate.style !== 'honeycomb') return [];
  const centres = padCentres(d, s);
  return centres.flatMap(([x, y]) => padSpokes(p, x, y).map(([a, len]) => [x, y, a, len]));
}
