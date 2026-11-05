// Everything a user can change about a design. All lengths are millimetres.

export type OutlineShape = 'square' | 'rounded' | 'oval' | 'circle';
export type TileShape = 'square' | 'hex' | 'triangle';
export type PatternType =
  | 'pyramids'
  | 'facets'
  | 'dunes'
  | 'ripple'
  | 'burst'
  | 'vortex'
  | 'waves'
  | 'noise';
export type ColorMode = 'pattern' | 'height' | 'radial' | 'angle' | 'horizontal' | 'vertical' | 'diagonal' | 'random';
export type MountType = 'pressfit' | 'glue';
export type BackplateStyle = 'honeycomb' | 'solid';

export interface DesignParams {
  /** Overall size of the finished board. Max 2000 × 2000 × 200. */
  width: number;
  height: number;
  /** Total depth: backplate + tallest tile. */
  depth: number;
  outline: OutlineShape;
  /** Corner radius for the "rounded" outline. */
  cornerRadius: number;

  tiles: {
    shape: TileShape;
    /** Distance between tile centres. */
    size: number;
    /** Gap between neighbouring tiles. */
    gap: number;
    /** Height of the straight wall at the bottom of each tile. */
    wall: number;
    /** Lowest rise of a tile top above its wall. */
    minRise: number;
    /** 0 = pointed pyramid, up to 0.9 = flat top (frustum). */
    topScale: number;
    /** Keep apexes inside the footprint so nothing overhangs when printing. */
    clampOverhang: boolean;
    /** Drop edge tiles smaller than this fraction of a full tile. */
    minEdgeFraction: number;
  };

  pattern: {
    type: PatternType;
    /** How many repeats/rings across the board. */
    scale: number;
    /** How strongly tips lean (0..1). */
    lean: number;
    /** Swirl for vortex/burst (-1..1). */
    twist: number;
    /** Random variation added on top (0..1). */
    variation: number;
    seed: number;
    /** Pattern centre, -1..1 across the board. */
    centerX: number;
    centerY: number;
    /** Invert heights. */
    invert: boolean;
  };

  colors: {
    /** 1..8 */
    count: number;
    palette: string[];
    mode: ColorMode;
    /** Mixes tiles across colour boundaries (0..1). */
    jitter: number;
    /** Number of colour bands the mode repeats over. */
    repeats: number;
  };

  mount: {
    type: MountType;
    /** Press-fit pin on the backplate. */
    pinDiameter: number;
    pinHeight: number;
    /** Extra socket diameter in the tile. 0.1–0.2 suits most PLA printers. */
    clearance: number;
    /** Glue mode: engrave tile outlines into the backplate to help placing. */
    guides: boolean;
    /** Second, offset pin so each tile fits only one way round. */
    keyPin: boolean;
    /** Glue mode: short locator pins so tiles still go in the right place and orientation. */
    locators: boolean;
    /** Engrave each tile's number into its bottom. */
    labels: boolean;
  };

  backplate: {
    thickness: number;
    /** Bowtie keys that lock backplate sections together. */
    keys: boolean;
    /** Open honeycomb web (saves filament and print time) or a solid plate. */
    style: BackplateStyle;
    /** Honeycomb cell size, across the flats. */
    cell: number;
    /** Honeycomb wall width. */
    rib: number;
    /** Solid band around each section's edge. */
    rim: number;
  };

  printer: {
    bedX: number;
    bedY: number;
    bedZ: number;
    /** Keep this far from the bed edges. */
    margin: number;
    /** Space between parts on a plate. */
    spacing: number;
  };
}

export const LIMITS = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxDepth: 200,
  minColors: 1,
  maxColors: 8,
};

export const DEFAULT_PALETTE = [
  '#e8463a', // red
  '#f4f1ea', // white
  '#1d1d1f', // black
  '#2f6fb3', // blue
  '#f2a93b', // orange
  '#3aa27a', // green
  '#8a5cc2', // purple
  '#9aa3ad', // grey
];

export function defaultParams(): DesignParams {
  return {
    width: 500,
    height: 500,
    depth: 40,
    outline: 'square',
    cornerRadius: 60,
    tiles: {
      shape: 'square',
      size: 50,
      gap: 0.6,
      wall: 6,
      minRise: 3,
      topScale: 0,
      clampOverhang: true,
      minEdgeFraction: 0.2,
    },
    pattern: {
      type: 'vortex',
      scale: 2,
      lean: 0.7,
      twist: 0.6,
      variation: 0.15,
      seed: 1,
      centerX: 0,
      centerY: 0,
      invert: false,
    },
    colors: {
      count: 3,
      palette: [...DEFAULT_PALETTE],
      mode: 'pattern',
      jitter: 0.15,
      repeats: 1,
    },
    mount: {
      type: 'pressfit',
      pinDiameter: 5,
      pinHeight: 4,
      clearance: 0.15,
      guides: true,
      keyPin: true,
      locators: true,
      labels: true,
    },
    backplate: {
      thickness: 5,
      keys: true,
      style: 'honeycomb',
      cell: 22,
      rib: 2,
      rim: 6,
    },
    printer: {
      bedX: 250,
      bedY: 250,
      bedZ: 250,
      margin: 5,
      spacing: 3,
    },
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };
export type PartialParams = DeepPartial<DesignParams>;

export function withDefaults(p: PartialParams = {}): DesignParams {
  const d = defaultParams();
  const merge = (base: any, over: any): any => {
    if (over === undefined) return base;
    if (Array.isArray(base) || typeof base !== 'object' || base === null) return over;
    const out: any = { ...base };
    for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
    return out;
  };
  return merge(d, p);
}

/** Pins on the backplate (and sockets in the tiles), or null when tiles are only glued. */
export interface PinSpec {
  d: number;
  h: number;
  clearance: number;
  /** Diameter of the offset key pin. */
  keyD: number;
}

export function pinSpec(p: DesignParams): PinSpec | null {
  const m = p.mount;
  let spec: Omit<PinSpec, 'keyD'> | null = null;
  if (m.type === 'pressfit') spec = { d: m.pinDiameter, h: m.pinHeight, clearance: m.clearance };
  else if (m.locators) spec = { d: 4, h: 1.6, clearance: m.clearance + 0.2 };
  if (!spec) return null;
  return { ...spec, keyD: Math.max(2.4, Math.round(spec.d * 0.6 * 10) / 10) };
}

/** Number engraving on tile bottoms. */
export const LABEL = { depth: 0.4, maxHeight: 6, minHeight: 2.5 };
