import type { Point2Mm } from "./index";

export interface Segment2Mm {
  start: Point2Mm;
  end: Point2Mm;
}

export interface SegmentPointIntersection {
  kind: "point";
  point: Point2Mm;
  aT: number;
  bT: number;
}

export interface SegmentOverlapIntersection {
  kind: "overlap";
  aStartT: number;
  aEndT: number;
  bStartT: number;
  bEndT: number;
}

export type SegmentIntersection =
  | SegmentPointIntersection
  | SegmentOverlapIntersection
  | null;

export function segmentIntersection(
  a: Segment2Mm,
  b: Segment2Mm,
  epsilon = 0.01,
): SegmentIntersection {
  const ax = a.end.xMm - a.start.xMm;
  const ay = a.end.yMm - a.start.yMm;
  const bx = b.end.xMm - b.start.xMm;
  const by = b.end.yMm - b.start.yMm;
  const aLengthSquared = ax * ax + ay * ay;
  const bLengthSquared = bx * bx + by * by;

  if (aLengthSquared <= epsilon * epsilon || bLengthSquared <= epsilon * epsilon) {
    return null;
  }

  const cross = ax * by - ay * bx;
  const qx = b.start.xMm - a.start.xMm;
  const qy = b.start.yMm - a.start.yMm;
  const qCrossA = qx * ay - qy * ax;
  const tolerance = epsilon * Math.max(1, Math.sqrt(aLengthSquared), Math.sqrt(bLengthSquared));

  if (Math.abs(cross) <= tolerance) {
    if (Math.abs(qCrossA) > tolerance) return null;

    const aStartT = projectParameter(a, b.start);
    const aEndT = projectParameter(a, b.end);
    const overlapStart = Math.max(0, Math.min(aStartT, aEndT));
    const overlapEnd = Math.min(1, Math.max(aStartT, aEndT));

    if (overlapEnd < overlapStart - epsilon) return null;
    if (Math.abs(overlapEnd - overlapStart) <= epsilon) {
      const aT = clamp01((overlapStart + overlapEnd) / 2);
      const point = pointAlong(a, aT);
      return {
        kind: "point",
        point,
        aT,
        bT: clamp01(projectParameter(b, point)),
      };
    }

    const startPoint = pointAlong(a, overlapStart);
    const endPoint = pointAlong(a, overlapEnd);
    return {
      kind: "overlap",
      aStartT: overlapStart,
      aEndT: overlapEnd,
      bStartT: Math.min(projectParameter(b, startPoint), projectParameter(b, endPoint)),
      bEndT: Math.max(projectParameter(b, startPoint), projectParameter(b, endPoint)),
    };
  }

  const aT = (qx * by - qy * bx) / cross;
  const bT = (qx * ay - qy * ax) / cross;
  if (aT < -epsilon || aT > 1 + epsilon || bT < -epsilon || bT > 1 + epsilon) {
    return null;
  }

  return {
    kind: "point",
    point: pointAlong(a, clamp01(aT)),
    aT: clamp01(aT),
    bT: clamp01(bT),
  };
}

export function pointAlong(segment: Segment2Mm, t: number): Point2Mm {
  return {
    xMm: segment.start.xMm + (segment.end.xMm - segment.start.xMm) * t,
    yMm: segment.start.yMm + (segment.end.yMm - segment.start.yMm) * t,
  };
}

export function projectParameter(segment: Segment2Mm, point: Point2Mm): number {
  const dx = segment.end.xMm - segment.start.xMm;
  const dy = segment.end.yMm - segment.start.yMm;
  const denominator = dx * dx + dy * dy;
  if (denominator === 0) return 0;
  return (
    ((point.xMm - segment.start.xMm) * dx +
      (point.yMm - segment.start.yMm) * dy) /
    denominator
  );
}

export function isInteriorParameter(t: number, epsilon = 1e-6): boolean {
  return t > epsilon && t < 1 - epsilon;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
