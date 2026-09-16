import type { EntityId, Level } from "@roomcraft/document";
import { distanceMm, type Point2Mm } from "@roomcraft/geometry";

export interface OpeningWallPlacement {
  wallId: EntityId;
  offsetMm: number;
  point: Point2Mm;
  distanceMm: number;
}

export interface OpeningPlacementOptions {
  widthMm: number;
  maxDistanceMm?: number;
}

export function snapOpeningToWall(
  point: Point2Mm,
  level: Pick<Level, "vertices" | "walls">,
  options: OpeningPlacementOptions,
): OpeningWallPlacement | null {
  if (!Number.isSafeInteger(options.widthMm) || options.widthMm <= 0) {
    throw new Error("widthMm must be a positive integer.");
  }

  const maxDistanceMm = options.maxDistanceMm ?? 320;
  if (!Number.isFinite(maxDistanceMm) || maxDistanceMm < 0) {
    throw new Error("maxDistanceMm must be a non-negative finite number.");
  }

  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, vertex]));
  let best: OpeningWallPlacement | null = null;

  for (const wall of level.walls) {
    const start = vertices.get(wall.startVertexId);
    const end = vertices.get(wall.endVertexId);
    if (!start || !end) continue;

    const dx = end.xMm - start.xMm;
    const dy = end.yMm - start.yMm;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 0) continue;

    const lengthMm = Math.sqrt(lengthSquared);
    if (lengthMm < options.widthMm) continue;

    const rawT = ((point.xMm - start.xMm) * dx + (point.yMm - start.yMm) * dy) / lengthSquared;
    const halfWidthMm = options.widthMm / 2;
    const minT = halfWidthMm / lengthMm;
    const maxT = 1 - minT;
    const t = Math.min(maxT, Math.max(minT, rawT));
    const snappedPoint = {
      xMm: start.xMm + dx * t,
      yMm: start.yMm + dy * t,
    };
    const candidateDistance = distanceMm(point, snappedPoint);
    if (candidateDistance > maxDistanceMm) continue;

    const candidate: OpeningWallPlacement = {
      wallId: wall.id,
      offsetMm: Math.round(t * lengthMm),
      point: {
        xMm: Math.round(snappedPoint.xMm),
        yMm: Math.round(snappedPoint.yMm),
      },
      distanceMm: candidateDistance,
    };

    if (!best || candidate.distanceMm < best.distanceMm) best = candidate;
  }

  return best;
}
