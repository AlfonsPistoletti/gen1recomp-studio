export type Rgb = [number, number, number];

export const MONO: Rgb[] = [[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]];

export function rgb(c: Rgb, alpha = 1): string {
  return alpha === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
