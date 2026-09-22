import type { EntityId, OpeningType, ProjectDocument } from "@roomcraft/document";
import { analyzePlanarFaces, type PlanarGraphIssue } from "@roomcraft/geometry";

export interface ProjectedWall2D {
  id: EntityId;
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
  lengthMm: number;
  thicknessMm: number;
}

export interface ProjectedOpening2D {
  id: EntityId;
  wallId: EntityId;
  type: OpeningType;
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
  centerXmm: number;
  centerYmm: number;
  widthMm: number;
  wallThicknessMm: number;
  flip: boolean;
  swing: "left" | "right" | "none";
}

export interface ProjectedRoom2D {
  key: string;
  points: Array<{ xMm: number; yMm: number }>;
  centerXmm: number;
  centerYmm: number;
  areaMm2: number;
}

export interface ProjectedBlueprint2D {
  id: EntityId;
  assetId: EntityId;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
}

export interface PlanProjection2D {
  levelId: EntityId;
  blueprints: ProjectedBlueprint2D[];
  walls: ProjectedWall2D[];
  openings: ProjectedOpening2D[];
  rooms: ProjectedRoom2D[];
  topologyIssues: PlanarGraphIssue[];
}

export function projectLevel2D(document: ProjectDocument, levelId: EntityId): PlanProjection2D {
  const level = document.levels.find((candidate) => candidate.id === levelId);
  if (!level) throw new Error(`Level ${levelId} does not exist.`);

  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, vertex]));
  const wallById = new Map(level.walls.map((wall) => [wall.id, wall]));
  const roomAnalysis = analyzePlanarFaces(level.vertices, level.walls);

  const walls = level.walls.map((wall) => {
    const start = vertices.get(wall.startVertexId);
    const end = vertices.get(wall.endVertexId);
    if (!start || !end) throw new Error(`Wall ${wall.id} references a missing vertex.`);

    return {
      id: wall.id,
      x1Mm: start.xMm,
      y1Mm: start.yMm,
      x2Mm: end.xMm,
      y2Mm: end.yMm,
      lengthMm: Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm),
      thicknessMm: wall.thicknessMm,
    } satisfies ProjectedWall2D;
  });

  const openings = level.openings.map((opening) => {
    const wall = wallById.get(opening.wallId);
    if (!wall) throw new Error(`Opening ${opening.id} references a missing wall.`);
    const start = vertices.get(wall.startVertexId);
    const end = vertices.get(wall.endVertexId);
    if (!start || !end) throw new Error(`Wall ${wall.id} references a missing vertex.`);

    const dx = end.xMm - start.xMm;
    const dy = end.yMm - start.yMm;
    const wallLengthMm = Math.hypot(dx, dy);
    if (wallLengthMm <= 0) throw new Error(`Wall ${wall.id} has zero length.`);

    const ux = dx / wallLengthMm;
    const uy = dy / wallLengthMm;
    const halfWidthMm = opening.widthMm / 2;
    const openingStartMm = opening.offsetMm - halfWidthMm;
    const openingEndMm = opening.offsetMm + halfWidthMm;

    return {
      id: opening.id,
      wallId: opening.wallId,
      type: opening.type,
      x1Mm: start.xMm + ux * openingStartMm,
      y1Mm: start.yMm + uy * openingStartMm,
      x2Mm: start.xMm + ux * openingEndMm,
      y2Mm: start.yMm + uy * openingEndMm,
      centerXmm: start.xMm + ux * opening.offsetMm,
      centerYmm: start.yMm + uy * opening.offsetMm,
      widthMm: opening.widthMm,
      wallThicknessMm: wall.thicknessMm,
      flip: opening.flip,
      swing: opening.swing,
    } satisfies ProjectedOpening2D;
  });

  const rooms = roomAnalysis.faces.map(
    (face) =>
      ({
        key: face.key,
        points: face.points,
        centerXmm: face.centroid.xMm,
        centerYmm: face.centroid.yMm,
        areaMm2: face.areaMm2,
      }) satisfies ProjectedRoom2D,
  );

  const blueprints = level.blueprints.map(
    (blueprint) =>
      ({
        id: blueprint.id,
        assetId: blueprint.assetId,
        xMm: blueprint.originXmm,
        yMm: blueprint.originYmm,
        widthMm: blueprint.sourceWidthPx * blueprint.millimetresPerPixel,
        heightMm: blueprint.sourceHeightPx * blueprint.millimetresPerPixel,
        rotationDeg: blueprint.rotationDeg,
        opacity: blueprint.opacity,
        locked: blueprint.locked,
        visible: blueprint.visible,
      }) satisfies ProjectedBlueprint2D,
  );

  return {
    levelId,
    blueprints,
    walls,
    openings,
    rooms,
    topologyIssues: roomAnalysis.issues,
  };
}
