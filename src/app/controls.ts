// Parameter panel definition. Each group becomes a collapsible section.
import { DesignParams, PATTERNS } from '../core/index';

export type Control =
  | { kind: 'range'; path: string; label: string; hint?: string; min: number; max: number; step: number; unit?: string; showIf?: (p: DesignParams) => boolean }
  | { kind: 'select'; path: string; label: string; hint?: string; options: { value: string; label: string }[]; showIf?: (p: DesignParams) => boolean }
  | { kind: 'segmented'; path: string; label: string; hint?: string; options: { value: string; label: string; icon?: string }[]; showIf?: (p: DesignParams) => boolean }
  | { kind: 'toggle'; path: string; label: string; hint?: string; showIf?: (p: DesignParams) => boolean }
  | { kind: 'palette'; path: string; label: string }
  | { kind: 'seed'; path: string; label: string };

export interface Group {
  id: string;
  title: string;
  summary: (p: DesignParams) => string;
  controls: Control[];
}

const outlineLabel: Record<string, string> = { square: 'Square', rounded: 'Rounded', oval: 'Oval', circle: 'Circle' };
const tileLabel: Record<string, string> = { square: 'Squares', hex: 'Hexagons', triangle: 'Triangles' };

export const GROUPS: Group[] = [
  {
    id: 'size',
    title: 'Size',
    summary: (p) =>
      `${p.outline === 'circle' ? `⌀ ${Math.min(p.width, p.height) / 10}` : `${p.width / 10} × ${p.height / 10}`} cm · ${outlineLabel[p.outline]}`,
    controls: [
      {
        kind: 'segmented', path: 'outline', label: 'Shape',
        options: [
          { value: 'square', label: 'Square', icon: '▢' },
          { value: 'rounded', label: 'Rounded', icon: '▢' },
          { value: 'oval', label: 'Oval', icon: '⬭' },
          { value: 'circle', label: 'Circle', icon: '◯' },
        ],
      },
      { kind: 'range', path: 'width', label: 'Width', min: 100, max: 2000, step: 10, unit: 'mm' },
      { kind: 'range', path: 'height', label: 'Height', min: 100, max: 2000, step: 10, unit: 'mm' },
      { kind: 'range', path: 'depth', label: 'Depth', hint: 'backplate + tallest tile', min: 15, max: 200, step: 1, unit: 'mm' },
      { kind: 'range', path: 'cornerRadius', label: 'Corner radius', min: 5, max: 500, step: 5, unit: 'mm', showIf: (p) => p.outline === 'rounded' },
    ],
  },
  {
    id: 'tiles',
    title: 'Pieces',
    summary: (p) => `${tileLabel[p.tiles.shape]} · ${p.tiles.size} mm · ${p.tiles.topScale < 0.02 ? 'pointed' : 'flat top'}`,
    controls: [
      {
        kind: 'segmented', path: 'tiles.shape', label: 'Tile shape',
        options: [
          { value: 'square', label: 'Squares', icon: '■' },
          { value: 'hex', label: 'Hexagons', icon: '⬢' },
          { value: 'triangle', label: 'Triangles', icon: '▲' },
        ],
      },
      { kind: 'range', path: 'tiles.size', label: 'Tile size', hint: 'centre to centre', min: 15, max: 190, step: 1, unit: 'mm' },
      { kind: 'range', path: 'tiles.topScale', label: 'Top', hint: '0 = pointed, higher = flat top', min: 0, max: 0.9, step: 0.05 },
      { kind: 'range', path: 'tiles.gap', label: 'Gap', hint: 'between tiles', min: 0, max: 4, step: 0.1, unit: 'mm' },
      { kind: 'range', path: 'tiles.wall', label: 'Base wall', hint: 'straight part at the bottom', min: 2, max: 30, step: 0.5, unit: 'mm' },
      { kind: 'range', path: 'tiles.minRise', label: 'Lowest rise', hint: 'flattest tile above its wall', min: 0.5, max: 60, step: 0.5, unit: 'mm' },
      { kind: 'range', path: 'tiles.minEdgeFraction', label: 'Smallest edge piece', hint: 'drop slivers at the outline', min: 0.05, max: 0.8, step: 0.05 },
      { kind: 'toggle', path: 'tiles.clampOverhang', label: 'Keep tips inside the base', hint: 'no overhangs, prints without supports' },
    ],
  },
  {
    id: 'pattern',
    title: 'Surface',
    summary: (p) => `${PATTERNS.find((x) => x.id === p.pattern.type)?.label} · depth ${p.depth} mm`,
    controls: [
      { kind: 'select', path: 'pattern.type', label: 'Pattern', options: PATTERNS.map((x) => ({ value: x.id, label: `${x.label}: ${x.hint}` })) },
      { kind: 'range', path: 'pattern.scale', label: 'Scale', hint: 'repeats across the board', min: 0.2, max: 8, step: 0.1 },
      { kind: 'range', path: 'pattern.lean', label: 'Lean', hint: 'how far tips bend', min: 0, max: 1, step: 0.05 },
      { kind: 'range', path: 'pattern.twist', label: 'Twist', hint: 'swirl for vortex and burst', min: -1, max: 1, step: 0.05, showIf: (p) => p.pattern.type === 'vortex' || p.pattern.type === 'burst' },
      { kind: 'range', path: 'pattern.variation', label: 'Variation', hint: 'random wobble', min: 0, max: 1, step: 0.05 },
      { kind: 'range', path: 'pattern.centerX', label: 'Centre, horizontal', min: -1, max: 1, step: 0.05 },
      { kind: 'range', path: 'pattern.centerY', label: 'Centre, vertical', min: -1, max: 1, step: 0.05 },
      { kind: 'toggle', path: 'pattern.invert', label: 'Invert heights' },
      { kind: 'seed', path: 'pattern.seed', label: 'Random seed' },
    ],
  },
  {
    id: 'colors',
    title: 'Colours',
    summary: (p) => `${p.colors.count} colour${p.colors.count > 1 ? 's' : ''} · by ${p.colors.mode}`,
    controls: [
      { kind: 'range', path: 'colors.count', label: 'Number of colours', min: 1, max: 8, step: 1 },
      { kind: 'palette', path: 'colors.palette', label: 'Palette' },
      {
        kind: 'select', path: 'colors.mode', label: 'Map colours by',
        options: [
          { value: 'pattern', label: 'Pattern (follows the surface)' },
          { value: 'height', label: 'Height' },
          { value: 'radial', label: 'Rings from the centre' },
          { value: 'angle', label: 'Angle around the centre' },
          { value: 'horizontal', label: 'Left to right' },
          { value: 'vertical', label: 'Bottom to top' },
          { value: 'diagonal', label: 'Diagonal' },
          { value: 'random', label: 'Random' },
        ],
      },
      { kind: 'range', path: 'colors.repeats', label: 'Repeats', hint: 'cycle the colours', min: 1, max: 8, step: 1 },
      { kind: 'range', path: 'colors.jitter', label: 'Mix at borders', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    id: 'mount',
    title: 'Mounting & backplate',
    summary: (p) => (p.mount.type === 'pressfit' ? `Press-fit pins ⌀${p.mount.pinDiameter} mm` : 'Glue') + ` · ${p.backplate.style} backplate ${p.backplate.thickness} mm`,
    controls: [
      {
        kind: 'segmented', path: 'mount.type', label: 'Attach tiles with',
        options: [
          { value: 'pressfit', label: 'Press-fit pins' },
          { value: 'glue', label: 'Glue' },
        ],
      },
      { kind: 'range', path: 'mount.pinDiameter', label: 'Pin diameter', min: 3, max: 10, step: 0.5, unit: 'mm', showIf: (p) => p.mount.type === 'pressfit' },
      { kind: 'range', path: 'mount.pinHeight', label: 'Pin height', min: 2, max: 10, step: 0.5, unit: 'mm', showIf: (p) => p.mount.type === 'pressfit' },
      { kind: 'range', path: 'mount.clearance', label: 'Fit clearance', hint: 'print the fit test to tune', min: 0, max: 0.5, step: 0.05, unit: 'mm', showIf: (p) => p.mount.type === 'pressfit' },
      { kind: 'toggle', path: 'mount.guides', label: 'Engrave tile outlines on the backplate', showIf: (p) => p.mount.type === 'glue' },
      { kind: 'toggle', path: 'mount.locators', label: 'Short locator pins', hint: 'tiles still go in one place only', showIf: (p) => p.mount.type === 'glue' },
      { kind: 'toggle', path: 'mount.keyPin', label: 'One-way fit', hint: 'second offset pin, so a tile only fits the right way round', showIf: (p) => p.mount.type === 'pressfit' || p.mount.locators },
      { kind: 'toggle', path: 'mount.labels', label: 'Engrave tile numbers on the bottom', hint: '0.4 mm deep' },
      {
        kind: 'segmented', path: 'backplate.style', label: 'Backplate',
        options: [
          { value: 'honeycomb', label: 'Honeycomb', icon: '⬡' },
          { value: 'solid', label: 'Solid', icon: '▬' },
        ],
      },
      { kind: 'range', path: 'backplate.thickness', label: 'Backplate thickness', min: 3, max: 12, step: 0.5, unit: 'mm' },
      { kind: 'range', path: 'backplate.cell', label: 'Cell size', hint: 'across the flats', min: 8, max: 80, step: 1, unit: 'mm', showIf: (p) => p.backplate.style === 'honeycomb' },
      { kind: 'range', path: 'backplate.rib', label: 'Wall width', min: 0.8, max: 6, step: 0.1, unit: 'mm', showIf: (p) => p.backplate.style === 'honeycomb' },
      { kind: 'range', path: 'backplate.rim', label: 'Solid edge', hint: 'band around each section', min: 2, max: 20, step: 0.5, unit: 'mm', showIf: (p) => p.backplate.style === 'honeycomb' },
      { kind: 'toggle', path: 'backplate.keys', label: 'Bowtie keys between sections' },
    ],
  },
  {
    id: 'printer',
    title: 'Printer',
    summary: (p) => `Bed ${p.printer.bedX} × ${p.printer.bedY} mm`,
    controls: [
      { kind: 'range', path: 'printer.bedX', label: 'Bed width', min: 150, max: 400, step: 1, unit: 'mm' },
      { kind: 'range', path: 'printer.bedY', label: 'Bed depth', min: 150, max: 400, step: 1, unit: 'mm' },
      { kind: 'range', path: 'printer.bedZ', label: 'Max print height', min: 100, max: 400, step: 1, unit: 'mm' },
      { kind: 'range', path: 'printer.margin', label: 'Edge margin', min: 0, max: 20, step: 1, unit: 'mm' },
      { kind: 'range', path: 'printer.spacing', label: 'Space between parts', min: 1, max: 10, step: 0.5, unit: 'mm' },
    ],
  },
];

export function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function setPath(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}
