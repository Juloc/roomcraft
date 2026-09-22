import { CURRENT_SCHEMA_VERSION, type Level, type Opening, type ProjectDocument, type Wall } from "./schema";

export function assertIntegerMillimetres(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} must be an integer millimetre value.`);
  }
}

export function validateProjectDocument(document: ProjectDocument): void {
  if (document.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version: ${document.schemaVersion}`);
  }
  if (document.levels.length === 0) {
    throw new Error("Project document must contain at least one level.");
  }

  const levelIds = new Set<string>();
  for (const level of document.levels) {
    if (!level.id || levelIds.has(level.id)) {
      throw new Error(`Level id ${level.id || "(empty)"} must be unique and non-empty.`);
    }
    levelIds.add(level.id);
    if (!level.name.trim()) {
      throw new Error(`Level ${level.id} name is required.`);
    }
    assertIntegerMillimetres(level.elevationMm, "level.elevationMm");
    assertIntegerMillimetres(level.defaultWallHeightMm, "level.defaultWallHeightMm");
    assertIntegerMillimetres(level.floorThicknessMm, "level.floorThicknessMm");
    if (level.defaultWallHeightMm <= 0) {
      throw new Error(`Level ${level.id} defaultWallHeightMm must be positive.`);
    }
    if (level.floorThicknessMm < 0) {
      throw new Error(`Level ${level.id} floorThicknessMm cannot be negative.`);
    }

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

    const objectIds = new Set<string>();
    for (const object of level.objects) {
      if (!object.id || objectIds.has(object.id)) {
        throw new Error(
          `Object id ${object.id || "(empty)"} must be unique and non-empty on level ${level.id}.`,
        );
      }
      objectIds.add(object.id);
      if (!object.assetId) {
        throw new Error(`Object ${object.id} assetId is required.`);
      }

      for (const [field, value] of [
        ["xMm", object.xMm],
        ["yMm", object.yMm],
        ["zMm", object.zMm],
        ["widthMm", object.widthMm],
        ["depthMm", object.depthMm],
        ["heightMm", object.heightMm],
      ] as const) {
        assertIntegerMillimetres(value, `object.${field}`);
      }

      if (object.zMm < 0) {
        throw new Error(`Object ${object.id} zMm cannot be negative.`);
      }
      if (
        object.widthMm <= 0 ||
        object.depthMm <= 0 ||
        object.heightMm <= 0
      ) {
        throw new Error(`Object ${object.id} dimensions must be positive.`);
      }
      if (!Number.isFinite(object.rotationDeg)) {
        throw new Error(`Object ${object.id} rotationDeg must be finite.`);
      }
    }

        for (const blueprint of level.blueprints) {
      if (!blueprint.id || !blueprint.assetId) {
        throw new Error("Blueprint id and assetId are required.");
      }
      if (!Number.isSafeInteger(blueprint.sourceWidthPx) || blueprint.sourceWidthPx <= 0) {
        throw new Error(`Blueprint ${blueprint.id} sourceWidthPx must be a positive integer.`);
      }
      if (!Number.isSafeInteger(blueprint.sourceHeightPx) || blueprint.sourceHeightPx <= 0) {
        throw new Error(`Blueprint ${blueprint.id} sourceHeightPx must be a positive integer.`);
      }
      assertIntegerMillimetres(blueprint.originXmm, "blueprint.originXmm");
      assertIntegerMillimetres(blueprint.originYmm, "blueprint.originYmm");
      if (!Number.isFinite(blueprint.millimetresPerPixel) || blueprint.millimetresPerPixel <= 0) {
        throw new Error(`Blueprint ${blueprint.id} millimetresPerPixel must be positive and finite.`);
      }
      if (!Number.isFinite(blueprint.rotationDeg)) {
        throw new Error(`Blueprint ${blueprint.id} rotationDeg must be finite.`);
      }
      if (!Number.isFinite(blueprint.opacity) || blueprint.opacity < 0 || blueprint.opacity > 1) {
        throw new Error(`Blueprint ${blueprint.id} opacity must be between 0 and 1.`);
      }
      if (!blueprint.crop || typeof blueprint.crop !== "object") {
        throw new Error(`Blueprint ${blueprint.id} crop is required.`);
      }
      for (const [field, value] of [
        ["leftPx", blueprint.crop.leftPx],
        ["topPx", blueprint.crop.topPx],
        ["widthPx", blueprint.crop.widthPx],
        ["heightPx", blueprint.crop.heightPx],
      ] as const) {
        if (!Number.isSafeInteger(value)) {
          throw new Error(`Blueprint ${blueprint.id} crop.${field} must be an integer pixel value.`);
        }
      }
      if (
        blueprint.crop.leftPx < 0 ||
        blueprint.crop.topPx < 0 ||
        blueprint.crop.widthPx <= 0 ||
        blueprint.crop.heightPx <= 0 ||
        blueprint.crop.leftPx + blueprint.crop.widthPx > blueprint.sourceWidthPx ||
        blueprint.crop.topPx + blueprint.crop.heightPx > blueprint.sourceHeightPx
      ) {
        throw new Error(`Blueprint ${blueprint.id} crop must stay inside the source image.`);
      }
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
