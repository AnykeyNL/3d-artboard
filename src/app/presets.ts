import { PartialParams } from '../core/index';

export const PRESETS: { name: string; params: PartialParams }[] = [
  {
    name: 'Red vortex',
    params: {
      width: 600, height: 600, depth: 45, outline: 'circle',
      tiles: { shape: 'hex', size: 36 },
      pattern: { type: 'vortex', twist: 0.75, lean: 0.9, scale: 2 },
      colors: { count: 3, palette: ['#d9432f', '#f3ede3', '#e98b5a'], mode: 'pattern', jitter: 0.25 },
    },
  },
  {
    name: 'Burst oval',
    params: {
      width: 1200, height: 650, depth: 70, outline: 'oval',
      tiles: { shape: 'hex', size: 45 },
      pattern: { type: 'burst', twist: 0.15, lean: 1 },
      colors: { count: 3, palette: ['#e8463a', '#f4f1ea', '#1d1d1f'], mode: 'radial', repeats: 2, jitter: 0.1 },
    },
  },
  {
    name: 'Sand tiles',
    params: {
      width: 480, height: 480, depth: 40, outline: 'square',
      tiles: { shape: 'square', size: 120, topScale: 0.55, wall: 8 },
      pattern: { type: 'facets', lean: 0.8, variation: 0.2 },
      colors: { count: 4, palette: ['#f1ece4', '#e8d3b3', '#d6a76a', '#b9813f'], mode: 'diagonal', jitter: 0.3 },
    },
  },
  {
    name: 'Ocean hexes',
    params: {
      width: 500, height: 500, depth: 45, outline: 'square',
      tiles: { shape: 'hex', size: 110, wall: 8 },
      pattern: { type: 'ripple', scale: 0.8, lean: 0.6 },
      colors: { count: 4, palette: ['#e9eef2', '#3aa0b8', '#1f5f8b', '#163a5c'], mode: 'radial', jitter: 0.1 },
    },
  },
  {
    name: 'Dunes',
    params: {
      width: 800, height: 500, depth: 50, outline: 'rounded', cornerRadius: 40,
      tiles: { shape: 'square', size: 40 },
      pattern: { type: 'dunes', scale: 1.6, lean: 0.9, variation: 0.05 },
      colors: { count: 4, palette: ['#f4f1ea', '#a9cfe0', '#4f8fc0', '#1f4f86'], mode: 'height', jitter: 0.15 },
    },
  },
  {
    name: 'Crystal triangles',
    params: {
      width: 600, height: 600, depth: 50, outline: 'square',
      tiles: { shape: 'triangle', size: 90 },
      pattern: { type: 'facets', lean: 0.9, variation: 0.3 },
      colors: { count: 1, palette: ['#1d1d1f'] },
    },
  },
];
