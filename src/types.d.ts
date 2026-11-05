declare module 'earcut' {
  export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number>, dim?: number): number[];
  export function deviation(data: ArrayLike<number>, holeIndices: ArrayLike<number> | undefined, dim: number, triangles: ArrayLike<number>): number;
}
declare module 'clipper-lib' {
  const ClipperLib: any;
  export default ClipperLib;
}
