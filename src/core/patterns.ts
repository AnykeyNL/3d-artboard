// Pattern fields. Each pattern looks at a tile centre and decides how tall the
// tile is, which way its tip leans, and a value used for colouring.
import { DesignParams, PatternType } from './params';
import { Vec2, hash01 } from './geometry';

export interface FieldSample {
  /** Height, 0..1. */
  h: number;
  /** Lean of the tip, as a vector of length 0..1 (fraction of what fits). */
  ox: number;
  oy: number;
  /** Colour value, 0..1. */
  c: number;
}

export const PATTERNS: { id: PatternType; label: string; hint: string }[] = [
  { id: 'pyramids', label: 'Pyramids', hint: 'Even pyramids, the classic look' },
  { id: 'facets', label: 'Facets', hint: 'Random crystal-like tips' },
  { id: 'dunes', label: 'Dunes', hint: 'Wind-blown waves across the board' },
  { id: 'ripple', label: 'Ripple', hint: 'Rings spreading from the centre' },
  { id: 'burst', label: 'Burst', hint: 'Tips flare out from the centre' },
  { id: 'vortex', label: 'Vortex', hint: 'Tips swirl around the centre' },
  { id: 'waves', label: 'Waves', hint: 'Egg-crate hills and valleys' },
  { id: 'noise', label: 'Noise', hint: 'Soft random terrain' },
];

const TAU = Math.PI * 2;

function smoothNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const v00 = hash01(xi, yi, seed);
  const v10 = hash01(xi + 1, yi, seed);
  const v01 = hash01(xi, yi + 1, seed);
  const v11 = hash01(xi + 1, yi + 1, seed);
  const a = v00 + (v10 - v00) * s(fx);
  const b = v01 + (v11 - v01) * s(fx);
  return a + (b - a) * s(fy);
}

function fbm(x: number, y: number, seed: number): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 3; o++) {
    v += amp * smoothNoise(x * f, y * f, seed + o * 101);
    amp /= 2;
    f *= 2;
  }
  return v / 0.875;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const frac = (v: number) => v - Math.floor(v);

/** Sample the pattern at board position `pos` (mm, origin at board centre). */
export function samplePattern(p: DesignParams, pos: Vec2, cellI: number, cellJ: number): FieldSample {
  const pat = p.pattern;
  const R = Math.max(p.width, p.height) / 2;
  const cx = (pat.centerX * p.width) / 2;
  const cy = (pat.centerY * p.height) / 2;
  const x = (pos[0] - cx) / R;
  const y = (pos[1] - cy) / R;
  const r = Math.hypot(x, y);
  const theta = Math.atan2(y, x);
  const rx = r > 1e-9 ? x / r : 0;
  const ry = r > 1e-9 ? y / r : 0;
  const rand = (k: number) => hash01(cellI, cellJ, pat.seed, k);
  const k = Math.max(0.1, pat.scale);

  let h = 1;
  let ox = 0;
  let oy = 0;
  let c = 0;

  switch (pat.type) {
    case 'pyramids':
      h = 1;
      c = rand(1);
      break;
    case 'facets': {
      h = 0.35 + 0.65 * rand(2);
      const a = rand(3) * TAU;
      const m = 0.4 + 0.6 * rand(4);
      ox = Math.cos(a) * m;
      oy = Math.sin(a) * m;
      c = rand(1);
      break;
    }
    case 'dunes': {
      const phase = TAU * k * (x * 0.5 + 0.18 * Math.sin(TAU * y * k * 0.35 + pat.seed));
      h = 0.5 + 0.5 * Math.sin(phase);
      // Tips lean down-wind, like sand ripples.
      const slope = Math.cos(phase);
      ox = 0.9 * slope;
      oy = 0.25 * Math.sin(phase * 0.5);
      c = h;
      break;
    }
    case 'ripple': {
      const phase = TAU * k * r;
      h = 0.5 + 0.5 * Math.cos(phase);
      const s = Math.sin(phase);
      ox = rx * s;
      oy = ry * s;
      c = frac(k * r);
      break;
    }
    case 'burst': {
      h = clamp01(1 - 0.75 * Math.abs(r - 0.45) / 0.55);
      const tw = pat.twist;
      ox = rx * (1 - Math.abs(tw)) - ry * tw;
      oy = ry * (1 - Math.abs(tw)) + rx * tw;
      const m = clamp01(r * 2.2);
      ox *= m;
      oy *= m;
      c = clamp01(r);
      break;
    }
    case 'vortex': {
      // Tips follow a spiral: mostly tangential, some radial.
      const tw = pat.twist === 0 ? 0.6 : pat.twist;
      const tx = -ry * Math.sign(tw);
      const ty = rx * Math.sign(tw);
      const blend = Math.min(1, Math.abs(tw));
      ox = tx * blend + rx * (1 - blend) * 0.6;
      oy = ty * blend + ry * (1 - blend) * 0.6;
      const m = clamp01(r * 3);
      ox *= m;
      oy *= m;
      h = clamp01(0.25 + 0.75 * (1 - Math.abs(r - 0.55) / 0.75));
      // Spiral colour bands: angle plus radius gives arms.
      c = frac(theta / TAU + r * k * tw * 0.8);
      break;
    }
    case 'waves': {
      const a = Math.sin(TAU * k * x * 0.5);
      const b = Math.sin(TAU * k * y * 0.5);
      h = 0.5 + 0.5 * a * b;
      ox = Math.cos(TAU * k * x * 0.5) * b;
      oy = a * Math.cos(TAU * k * y * 0.5);
      c = h;
      break;
    }
    case 'noise': {
      const e = 0.05;
      const f = (u: number, v: number) => fbm(u * k * 1.5 + 10, v * k * 1.5 + 10, pat.seed);
      h = f(x, y);
      ox = (f(x + e, y) - f(x - e, y)) * 6;
      oy = (f(x, y + e) - f(x, y - e)) * 6;
      c = h;
      break;
    }
  }

  if (pat.variation > 0) {
    h = clamp01(h + pat.variation * (rand(5) - 0.5));
    ox += pat.variation * (rand(6) - 0.5);
    oy += pat.variation * (rand(7) - 0.5);
  }
  if (pat.invert) h = 1 - h;

  const lean = clamp01(pat.lean);
  ox *= lean;
  oy *= lean;
  const m = Math.hypot(ox, oy);
  if (m > 1) {
    ox /= m;
    oy /= m;
  }
  return { h: clamp01(h), ox, oy, c: clamp01(c) };
}
