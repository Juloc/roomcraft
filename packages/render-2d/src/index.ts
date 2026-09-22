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
  leftMaterialId: EntityId | null;
  rightMaterialId: EntityId | null;
  leftColorHex: string | null;
  rightColorHex: string | null;
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
  floorMaterialId: EntityId | null;
  ceilingMaterialId: EntityId | null;
  floorColorHex: string | null;
  ceilingColorHex: string | null;
}

export interface ProjectedBlueprint2D {
  id: EntityId;
  assetId: EntityId;
  xMm: number;
  yMm: number;
  drawXmm: number;
  drawYmm: number;
  widthMm: number;
  heightMm: number;
  sourceWidthPx: number;
  sourceHeightPx: number;
  cropLeftPx: number;
  cropTopPx: number;
  cropWidthPx: number;
  cropHeightPx: number;
  millimetresPerPixel: number;
  rotationDeg: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
}

export interface ProjectedObject2D {
  id: EntityId;
  assetId: EntityId;
  centerXmm: number;
  centerYmm: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  zMm: number;
  rotationDeg: number;
  locked: boolean;
}

export interface PlanProjection2D {
  levelId: EntityId;
  blueprints: ProjectedBlueprint2D[];
  objects: ProjectedObject2D[];
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
  const materialById = new Map(document.materials.map((material) => [material.id, material]));
  const roomFinishByKey = new Map(
    level.roomFinishes.map((finish) => [finish.roomKey, finish]),
  );
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
      leftMaterialId: wall.leftMaterialId ?? null,
      rightMaterialId: wall.rightMaterialId ?? null,
      leftColorHex:
        materialById.get(wall.leftMaterialId ?? "")?.baseColorHex ?? null,
      rightColorHex:
        materialById.get(wall.rightMaterialId ?? "")?.baseColorHex ?? null,
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

  const rooms = roomAnalysis.faces.map((face) => {
    const finish = roomFinishByKey.get(face.key);
    const floorMaterialId = finish?.floorMaterialId ?? null;
    const ceilingMaterialId = finish?.ceilingMaterialId ?? null;

    return {
      key: face.key,
      points: face.points,
      centerXmm: face.centroid.xMm,
      centerYmm: face.centroid.yMm,
      areaMm2: face.areaMm2,
      floorMaterialId,
      ceilingMaterialId,
      floorColorHex:
        materialById.get(floorMaterialId ?? "")?.baseColorHex ?? null,
      ceilingColorHex:
        materialById.get(ceilingMaterialId ?? "")?.baseColorHex ?? null,
    } satisfies ProjectedRoom2D;
  });

  const blueprints = level.blueprints.map(
    (blueprint) =>
      ({
        id: blueprint.id,
        assetId: blueprint.assetId,
        xMm: blueprint.originXmm,
        yMm: blueprint.originYmm,
        drawXmm:
          blueprint.originXmm + blueprint.crop.leftPx * blueprint.millimetresPerPixel,
        drawYmm:
          blueprint.originYmm + blueprint.crop.topPx * blueprint.millimetresPerPixel,
        widthMm: blueprint.crop.widthPx * blueprint.millimetresPerPixel,
        heightMm: blueprint.crop.heightPx * blueprint.millimetresPerPixel,
        sourceWidthPx: blueprint.sourceWidthPx,
        sourceHeightPx: blueprint.sourceHeightPx,
        cropLeftPx: blueprint.crop.leftPx,
        cropTopPx: blueprint.crop.topPx,
        cropWidthPx: blueprint.crop.widthPx,
        cropHeightPx: blueprint.crop.heightPx,
        millimetresPerPixel: blueprint.millimetresPerPixel,
        rotationDeg: blueprint.rotationDeg,
        opacity: blueprint.opacity,
        locked: blueprint.locked,
        visible: blueprint.visible,
      }) satisfies ProjectedBlueprint2D,
  );

  const objects = level.objects.map(
    (object) =>
      ({
        id: object.id,
        assetId: object.assetId,
        centerXmm: object.xMm,
        centerYmm: object.yMm,
        widthMm: object.widthMm,
        depthMm: object.depthMm,
        heightMm: object.heightMm,
        zMm: object.zMm,
        rotationDeg: object.rotationDeg,
        locked: object.locked,
      }) satisfies ProjectedObject2D,
  );

  return {
    levelId,
    blueprints,
    objects,
    walls,
    openings,
    rooms,
    topologyIssues: roomAnalysis.issues,
  };
}
