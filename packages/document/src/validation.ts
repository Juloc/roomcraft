import type { ProjectDocument } from "./schema";

export function assertIntegerMillimetres(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} must be an integer millimetre value.`);
  }
}

export function validateProjectDocument(document: ProjectDocument): void {
  if (document.schemaVersion !== 1) {
    throw new Error(`Unsupported schema version: ${document.schemaVersion}`);
  }

  for (const level of document.levels) {
    assertIntegerMillimetres(level.elevationMm, "level.elevationMm");
    assertIntegerMillimetres(level.defaultWallHeightMm, "level.defaultWallHeightMm");

    const vertexIds = new Set(level.vertices.map((vertex) => vertex.id));
    for (const vertex of level.vertices) {
      assertIntegerMillimetres(vertex.xMm, "vertex.xMm");
      assertIntegerMillimetres(vertex.yMm, "vertex.yMm");
    }

    for (const wall of level.walls) {
      if (!vertexIds.has(wall.startVertexId) || !vertexIds.has(wall.endVertexId)) {
        throw new Error(`Wall ${wall.id} references a missing vertex.`);
      }
      assertIntegerMillimetres(wall.thicknessMm, "wall.thicknessMm");
      if (wall.heightMm !== null) assertIntegerMillimetres(wall.heightMm, "wall.heightMm");
    }
  }
}
