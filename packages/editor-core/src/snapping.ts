import type { EntityId, Level } from "@roomcraft/document";
import { distanceMm, snapToGrid, type Point2Mm } from "@roomcraft/geometry";

export type SnapSource = "vertex" | "grid";

export interface PlanSnapResult {
  point: Point2Mm;
  source: SnapSource;
  vertexId?: EntityId;
}

export interface PlanSnapOptions {
  gridSizeMm: number;
  vertexToleranceMm?: number;
}

export function snapPlanPoint(
  point: Point2Mm,
  level: Pick<Level, "vertices">,
  options: PlanSnapOptions,
): PlanSnapResult {
  const vertexToleranceMm = options.vertexToleranceMm ?? 160;
  if (!Number.isFinite(vertexToleranceMm) || vertexToleranceMm < 0) {
    throw new Error("vertexToleranceMm must be a non-negative finite number.");
  }

  let nearestVertex: { id: EntityId; point: Point2Mm; distanceMm: number } | null = null;

  for (const vertex of level.vertices) {
    const vertexPoint = { xMm: vertex.xMm, yMm: vertex.yMm };
    const candidateDistance = distanceMm(point, vertexPoint);
    if (candidateDistance > vertexToleranceMm) continue;

    if (!nearestVertex || candidateDistance < nearestVertex.distanceMm) {
      nearestVertex = {
        id: vertex.id,
        point: vertexPoint,
        distanceMm: candidateDistance,
      };
    }
  }

  if (nearestVertex) {
    return {
      point: nearestVertex.point,
      source: "vertex",
      vertexId: nearestVertex.id,
    };
  }

  return {
    point: {
      xMm: snapToGrid(Math.round(point.xMm), options.gridSizeMm),
      yMm: snapToGrid(Math.round(point.yMm), options.gridSizeMm),
    },
    source: "grid",
  };
}
