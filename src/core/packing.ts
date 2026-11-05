// Lay parts out on print plates (simple shelf packing by bounding box).
import { DesignParams } from './params';
import { Tile } from './tile';
import { bbox } from './geometry';
import { KEY } from './backplate';

export interface PlateItem {
  /** Tile id, or -1 for a key. */
  ref: number;
  /** Where the part's local origin goes on the plate (mm from bed corner). */
  x: number;
  y: number;
}

export interface Plate {
  id: number;
  kind: 'tiles' | 'keys';
  color: number;
  items: PlateItem[];
}

interface Box {
  ref: number;
  w: number;
  h: number;
  /** Offset from bbox corner to the part origin. */
  ox: number;
  oy: number;
}

function shelfPack(boxes: Box[], W: number, H: number, margin: number, gap: number): PlateItem[][] {
  const sorted = [...boxes].sort((a, b) => b.h - a.h || b.w - a.w);
  const plates: PlateItem[][] = [];
  let items: PlateItem[] = [];
  let x = margin;
  let y = margin;
  let shelf = 0;
  for (const b of sorted) {
    if (x + b.w > W - margin + 1e-9) {
      x = margin;
      y += shelf + gap;
      shelf = 0;
    }
    if (y + b.h > H - margin + 1e-9) {
      plates.push(items);
      items = [];
      x = margin;
      y = margin;
      shelf = 0;
    }
    items.push({ ref: b.ref, x: x + b.ox, y: y + b.oy });
    x += b.w + gap;
    shelf = Math.max(shelf, b.h);
  }
  if (items.length) plates.push(items);
  return plates;
}

export function packPlates(p: DesignParams, tiles: Tile[], keyCount: number, colorCount: number): Plate[] {
  const plates: Plate[] = [];
  const { bedX, bedY, margin, spacing } = p.printer;
  for (let c = 0; c < colorCount; c++) {
    const boxes: Box[] = tiles
      .filter((t) => t.color === c)
      .map((t) => {
        const b = bbox([...t.base, ...t.top]);
        return { ref: t.id, w: b.maxX - b.minX, h: b.maxY - b.minY, ox: -b.minX, oy: -b.minY };
      });
    for (const items of shelfPack(boxes, bedX, bedY, margin, spacing)) {
      plates.push({ id: plates.length, kind: 'tiles', color: c, items });
    }
  }
  if (keyCount > 0) {
    const boxes: Box[] = Array.from({ length: keyCount }, () => ({
      ref: -1,
      w: KEY.length,
      h: KEY.endWidth,
      ox: KEY.length / 2,
      oy: KEY.endWidth / 2,
    }));
    for (const items of shelfPack(boxes, bedX, bedY, margin, spacing)) {
      plates.push({ id: plates.length, kind: 'keys', color: 0, items });
    }
  }
  return plates;
}
