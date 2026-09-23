export * from "./segment-topology";
export * from "./planar-faces";

export interface Point2Mm {
  xMm: number;
  yMm: number;
}

export const GEOMETRY_EPSILON_MM = 0.01;

export function mmToMetres(valueMm: number): number {
  return valueMm / 1000;
}

export function metresToMm(valueMetres: number): number {
  return Math.round(valueMetres * 1000);
}

export function distanceMm(a: Point2Mm, b: Point2Mm): number {
  return Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
}

export function almostEqualMm(a: number, b: number, toleranceMm = GEOMETRY_EPSILON_MM): boolean {
  return Math.abs(a - b) <= toleranceMm;
}

export function snapToGrid(valueMm: number, gridSizeMm: number): number {
  if (!Number.isSafeInteger(gridSizeMm) || gridSizeMm <= 0) {
    throw new Error("gridSizeMm must be a positive integer.");
  }

  return Math.round(valueMm / gridSizeMm) * gridSizeMm;
}
