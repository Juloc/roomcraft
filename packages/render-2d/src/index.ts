import type { EntityId, ProjectDocument } from "@roomcraft/document";

export interface ProjectedWall2D {
  id: EntityId;
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
  thicknessMm: number;
}

export interface PlanProjection2D {
  levelId: EntityId;
  walls: ProjectedWall2D[];
}

export function projectLevel2D(document: ProjectDocument, levelId: EntityId): PlanProjection2D {
  const level = document.levels.find((candidate) => candidate.id === levelId);
  if (!level) throw new Error(`Level ${levelId} does not exist.`);

  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, vertex]));

  return {
    levelId,
    walls: level.walls.map((wall) => {
      const start = vertices.get(wall.startVertexId);
      const end = vertices.get(wall.endVertexId);
      if (!start || !end) throw new Error(`Wall ${wall.id} references a missing vertex.`);

      return {
        id: wall.id,
        x1Mm: start.xMm,
        y1Mm: start.yMm,
        x2Mm: end.xMm,
        y2Mm: end.yMm,
        thicknessMm: wall.thicknessMm,
      };
    }),
  };
}
