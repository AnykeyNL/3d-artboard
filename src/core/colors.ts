// Automatic colour mapping: turn each tile into one of 1..8 palette colours.
import { DesignParams, LIMITS } from './params';
import { FieldSample } from './patterns';
import { Vec2, hash01 } from './geometry';

export function colorValue(p: DesignParams, pos: Vec2, s: FieldSample, i: number, j: number): number {
  const R = Math.max(p.width, p.height) / 2;
  const cx = (p.pattern.centerX * p.width) / 2;
  const cy = (p.pattern.centerY * p.height) / 2;
  const x = (pos[0] - cx) / R;
  const y = (pos[1] - cy) / R;
  switch (p.colors.mode) {
    case 'pattern':
      return s.c;
    case 'height':
      return s.h;
    case 'radial':
      return Math.min(1, Math.hypot(x, y));
    case 'angle':
      return (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
    case 'horizontal':
      return (pos[0] / p.width + 0.5);
    case 'vertical':
      return (pos[1] / p.height + 0.5);
    case 'diagonal':
      return (pos[0] / p.width + pos[1] / p.height) / 2 + 0.5;
    case 'random':
      return hash01(i, j, p.pattern.seed, 99);
  }
}

export function colorIndex(p: DesignParams, value: number, i: number, j: number): number {
  const n = clampCount(p.colors.count);
  if (n === 1) return 0;
  const reps = Math.max(1, Math.round(p.colors.repeats));
  let v = value * reps;
  v = v - Math.floor(v);
  if (p.colors.jitter > 0) {
    v += (hash01(i, j, p.pattern.seed, 77) - 0.5) * p.colors.jitter * (2 / n);
    v = ((v % 1) + 1) % 1;
  }
  return Math.min(n - 1, Math.floor(v * n));
}

export function clampCount(n: number): number {
  return Math.max(LIMITS.minColors, Math.min(LIMITS.maxColors, Math.round(n)));
}

export function paletteFor(p: DesignParams): string[] {
  const n = clampCount(p.colors.count);
  const out: string[] = [];
  for (let k = 0; k < n; k++) out.push(p.colors.palette[k] ?? '#cccccc');
  return out;
}
