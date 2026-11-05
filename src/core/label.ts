// Seven-segment digits for engraving tile numbers. Plain rectangles, so the
// OpenSCAD file draws exactly the same shapes without needing a font.
import { Polygon } from './geometry';

/** Segments a..g for 0-9. */
export const SEG7 = [
  [1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 0, 0, 0, 0],
  [1, 1, 0, 1, 1, 0, 1],
  [1, 1, 1, 1, 0, 0, 1],
  [0, 1, 1, 0, 0, 1, 1],
  [1, 0, 1, 1, 0, 1, 1],
  [1, 0, 1, 1, 1, 1, 1],
  [1, 1, 1, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 0, 1, 1],
];

export function glyphMetrics(h: number) {
  return { s: Math.max(0.7, 0.16 * h), w: 0.55 * h, gap: 0.25 * h };
}

export function labelSize(text: string, h: number): { w: number; h: number } {
  const { w, gap } = glyphMetrics(h);
  return { w: text.length * w + (text.length - 1) * gap, h };
}

/** Segment rectangles [x0, y0, x1, y1] for a digit with its bottom-left at the origin. */
export function segments(h: number): [number, number, number, number][] {
  const { s, w } = glyphMetrics(h);
  return [
    [0, h - s, w, h],
    [w - s, (h - s) / 2, w, h],
    [w - s, 0, w, (h + s) / 2],
    [0, 0, w, s],
    [0, 0, s, (h + s) / 2],
    [0, (h - s) / 2, s, h],
    [0, (h - s) / 2, w, (h + s) / 2],
  ];
}

/**
 * Rectangles for a number, centred on (cx, cy). Mirrored left-right so it
 * reads correctly when you look at the bottom of the tile.
 */
export function labelRects(text: string, h: number, cx: number, cy: number): Polygon[] {
  const { w, gap } = glyphMetrics(h);
  const total = labelSize(text, h).w;
  const segs = segments(h);
  const out: Polygon[] = [];
  [...text].forEach((ch, k) => {
    const on = SEG7[ch.charCodeAt(0) - 48];
    if (!on) return;
    const ox = -total / 2 + k * (w + gap);
    const oy = -h / 2;
    on.forEach((bit, i) => {
      if (!bit) return;
      const [x0, y0, x1, y1] = segs[i];
      // Mirror x: u -> -u.
      const X0 = cx - (ox + x1);
      const X1 = cx - (ox + x0);
      out.push([
        [X0, cy + oy + y0],
        [X1, cy + oy + y0],
        [X1, cy + oy + y1],
        [X0, cy + oy + y1],
      ]);
    });
  });
  return out;
}
