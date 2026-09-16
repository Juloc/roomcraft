import type { Level, Opening, ProjectDocument, Wall } from "./schema";

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
    const vertexById = new Map(level.vertices.map((vertex) => [vertex.id, vertex]));
    for (const vertex of level.vertices) {
      assertIntegerMillimetres(vertex.xMm, "vertex.xMm");
      assertIntegerMillimetres(vertex.yMm, "vertex.yMm");
    }

    const wallById = new Map(level.walls.map((wall) => [wall.id, wall]));
    for (const wall of level.walls) {
      if (!vertexIds.has(wall.startVertexId) || !vertexIds.has(wall.endVertexId)) {
        throw new Error(`Wall ${wall.id} references a missing vertex.`);
      }
      assertIntegerMillimetres(wall.thicknessMm, "wall.thicknessMm");
      if (wall.heightMm !== null) assertIntegerMillimetres(wall.heightMm, "wall.heightMm");
    }

    for (const opening of level.openings) {
      const wall = wallById.get(opening.wallId);
      if (!wall) throw new Error(`Opening ${opening.id} references a missing wall.`);
      validateOpening(level, wall, opening, vertexById);
    }

    for (let index = 0; index < level.openings.length; index += 1) {
      const opening = level.openings[index];
      if (!opening) continue;
      const openingStartMm = opening.offsetMm - opening.widthMm / 2;
      const openingEndMm = opening.offsetMm + opening.widthMm / 2;

      for (let otherIndex = index + 1; otherIndex < level.openings.length; otherIndex += 1) {
        const other = level.openings[otherIndex];
        if (!other || other.wallId !== opening.wallId) continue;
        const otherStartMm = other.offsetMm - other.widthMm / 2;
        const otherEndMm = other.offsetMm + other.widthMm / 2;
        if (openingStartMm < otherEndMm && openingEndMm > otherStartMm) {
          throw new Error(`Openings ${opening.id} and ${other.id} overlap.`);
        }
      }
    }
  }
}

function validateOpening(
  level: Level,
  wall: Wall,
  opening: Opening,
  vertexById: Map<string, Level["vertices"][number]>,
): void {
  assertIntegerMillimetres(opening.offsetMm, "opening.offsetMm");
  assertIntegerMillimetres(opening.widthMm, "opening.widthMm");
  assertIntegerMillimetres(opening.heightMm, "opening.heightMm");
  assertIntegerMillimetres(opening.sillHeightMm, "opening.sillHeightMm");

  if (opening.widthMm <= 0 || opening.heightMm <= 0 || opening.sillHeightMm < 0) {
    throw new Error(`Opening ${opening.id} dimensions are invalid.`);
  }

  const start = vertexById.get(wall.startVertexId);
  const end = vertexById.get(wall.endVertexId);
  if (!start || !end) throw new Error(`Wall ${wall.id} references a missing vertex.`);

  const wallLengthMm = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
  const wallHeightMm = wall.heightMm ?? level.defaultWallHeightMm;
  const openingStartMm = opening.offsetMm - opening.widthMm / 2;
  const openingEndMm = opening.offsetMm + opening.widthMm / 2;

  if (openingStartMm < 0 || openingEndMm > wallLengthMm) {
    throw new Error(`Opening ${opening.id} does not fit inside wall ${wall.id}.`);
  }
  if (opening.sillHeightMm + opening.heightMm > wallHeightMm) {
    throw new Error(`Opening ${opening.id} exceeds wall ${wall.id} height.`);
  }
}
