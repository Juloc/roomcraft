import type { EntityId, Level } from "@roomcraft/document";
import { distanceMm, snapToGrid, type Point2Mm } from "@roomcraft/geometry";

export type SnapSource = "vertex" | "object" | "grid";

export interface PlanSnapResult {
  point: Point2Mm;
  source: SnapSource;
  vertexId?: EntityId;
  objectId?: EntityId;
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


export interface ObjectSnapSubject {
  id?: EntityId;
  widthMm: number;
  depthMm: number;
  rotationDeg: number;
}

export interface ObjectSnapOptions {
  gridSizeMm: number;
  objectToleranceMm?: number;
}

export function snapObjectPosition(
  point: Point2Mm,
  subject: ObjectSnapSubject,
  level: Pick<Level, "objects">,
  options: ObjectSnapOptions,
): PlanSnapResult {
  if (
    !Number.isFinite(subject.widthMm) ||
    subject.widthMm <= 0 ||
    !Number.isFinite(subject.depthMm) ||
    subject.depthMm <= 0 ||
    !Number.isFinite(subject.rotationDeg)
  ) {
    throw new Error("Object snap subject is invalid.");
  }

  const toleranceMm = options.objectToleranceMm ?? 140;
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0) {
    throw new Error("objectToleranceMm must be a non-negative finite number.");
  }

  const subjectHalf = rotatedHalfExtents(
    subject.widthMm,
    subject.depthMm,
    subject.rotationDeg,
  );
  const gridPoint = {
    xMm: snapToGrid(Math.round(point.xMm), options.gridSizeMm),
    yMm: snapToGrid(Math.round(point.yMm), options.gridSizeMm),
  };

  let bestX: AxisSnap | null = null;
  let bestY: AxisSnap | null = null;

  for (const object of level.objects) {
    if (subject.id && object.id === subject.id) continue;

    const targetHalf = rotatedHalfExtents(
      object.widthMm,
      object.depthMm,
      object.rotationDeg,
    );

    const xCandidates = [
      object.xMm,
      object.xMm - targetHalf.xMm + subjectHalf.xMm,
      object.xMm + targetHalf.xMm - subjectHalf.xMm,
      object.xMm - targetHalf.xMm - subjectHalf.xMm,
      object.xMm + targetHalf.xMm + subjectHalf.xMm,
    ];
    const yCandidates = [
      object.yMm,
      object.yMm - targetHalf.yMm + subjectHalf.yMm,
      object.yMm + targetHalf.yMm - subjectHalf.yMm,
      object.yMm - targetHalf.yMm - subjectHalf.yMm,
      object.yMm + targetHalf.yMm + subjectHalf.yMm,
    ];

    bestX = chooseAxisSnap(bestX, point.xMm, xCandidates, object.id, toleranceMm);
    bestY = chooseAxisSnap(bestY, point.yMm, yCandidates, object.id, toleranceMm);
  }

  const objectId =
    bestX && bestY
      ? bestX.distanceMm <= bestY.distanceMm
        ? bestX.objectId
        : bestY.objectId
      : bestX?.objectId ?? bestY?.objectId;

  return {
    point: {
      xMm: bestX?.valueMm ?? gridPoint.xMm,
      yMm: bestY?.valueMm ?? gridPoint.yMm,
    },
    source: bestX || bestY ? "object" : "grid",
    ...(objectId ? { objectId } : {}),
  };
}

interface AxisSnap {
  valueMm: number;
  distanceMm: number;
  objectId: EntityId;
}

function chooseAxisSnap(
  current: AxisSnap | null,
  rawValueMm: number,
  candidates: readonly number[],
  objectId: EntityId,
  toleranceMm: number,
): AxisSnap | null {
  let best = current;

  for (const valueMm of candidates) {
    const distance = Math.abs(rawValueMm - valueMm);
    if (distance > toleranceMm) continue;
    if (
      !best ||
      distance < best.distanceMm ||
      (distance === best.distanceMm && objectId.localeCompare(best.objectId) < 0)
    ) {
      best = { valueMm: Math.round(valueMm), distanceMm: distance, objectId };
    }
  }

  return best;
}

function rotatedHalfExtents(
  widthMm: number,
  depthMm: number,
  rotationDeg: number,
): { xMm: number; yMm: number } {
  const radians = (rotationDeg * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));

  return {
    xMm: (cosine * widthMm + sine * depthMm) / 2,
    yMm: (sine * widthMm + cosine * depthMm) / 2,
  };
}
