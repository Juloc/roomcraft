import type {
  EntityId,
  Level,
  Opening,
  ProjectDocument,
  Vertex,
  Wall,
} from "@roomcraft/document";

export interface CommandResult {
  document: ProjectDocument;
  inverse: EditorCommand;
}

export interface EditorCommand {
  readonly type: string;
  execute(document: ProjectDocument): CommandResult;
}

export class CommandHistory {
  private undoStack: EditorCommand[] = [];
  private redoStack: EditorCommand[] = [];

  constructor(private documentValue: ProjectDocument) {}

  get document(): ProjectDocument {
    return this.documentValue;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  execute(command: EditorCommand): ProjectDocument {
    const result = command.execute(this.documentValue);
    this.documentValue = result.document;
    this.undoStack.push(result.inverse);
    this.redoStack = [];
    return this.documentValue;
  }

  undo(): ProjectDocument {
    const command = this.undoStack.pop();
    if (!command) return this.documentValue;

    const result = command.execute(this.documentValue);
    this.documentValue = result.document;
    this.redoStack.push(result.inverse);
    return this.documentValue;
  }

  redo(): ProjectDocument {
    const command = this.redoStack.pop();
    if (!command) return this.documentValue;

    const result = command.execute(this.documentValue);
    this.documentValue = result.document;
    this.undoStack.push(result.inverse);
    return this.documentValue;
  }
}

export type WallEndpoint =
  | { kind: "existing"; vertexId: EntityId }
  | { kind: "new"; vertex: Vertex };

export interface AddWallInput {
  levelId: EntityId;
  wallId: EntityId;
  start: WallEndpoint;
  end: WallEndpoint;
  thicknessMm: number;
  heightMm?: number | null;
}

export class AddWallCommand implements EditorCommand {
  readonly type = "AddWall";

  constructor(private readonly input: AddWallInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    const addedVertices = [this.input.start, this.input.end]
      .filter((endpoint): endpoint is Extract<WallEndpoint, { kind: "new" }> => endpoint.kind === "new")
      .map((endpoint) => endpoint.vertex);

    const existingIds = new Set(level.vertices.map((vertex) => vertex.id));
    for (const vertex of addedVertices) {
      if (existingIds.has(vertex.id)) throw new Error(`Vertex ${vertex.id} already exists.`);
      existingIds.add(vertex.id);
    }

    const startVertexId = endpointId(this.input.start);
    const endVertexId = endpointId(this.input.end);
    if (startVertexId === endVertexId) throw new Error("A wall needs two distinct vertices.");

    for (const endpoint of [this.input.start, this.input.end]) {
      if (endpoint.kind === "existing" && !existingIds.has(endpoint.vertexId)) {
        throw new Error(`Vertex ${endpoint.vertexId} does not exist.`);
      }
    }

    if (level.walls.some((wall) => wall.id === this.input.wallId)) {
      throw new Error(`Wall ${this.input.wallId} already exists.`);
    }

    const wall: Wall = {
      id: this.input.wallId,
      startVertexId,
      endVertexId,
      thicknessMm: this.input.thicknessMm,
      heightMm: this.input.heightMm ?? null,
    };

    const nextLevel: Level = {
      ...level,
      vertices: [...level.vertices, ...addedVertices],
      walls: [...level.walls, wall],
    };

    return {
      document: replaceLevel(document, nextLevel),
      inverse: new RemoveWallCommand(this.input.levelId, wall, addedVertices),
    };
  }
}

export interface AddOpeningInput {
  levelId: EntityId;
  opening: Opening;
}

export class AddOpeningCommand implements EditorCommand {
  readonly type = "AddOpening";

  constructor(private readonly input: AddOpeningInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    const opening = this.input.opening;

    if (level.openings.some((candidate) => candidate.id === opening.id)) {
      throw new Error(`Opening ${opening.id} already exists.`);
    }

    const wall = level.walls.find((candidate) => candidate.id === opening.wallId);
    if (!wall) throw new Error(`Wall ${opening.wallId} does not exist.`);

    validateOpeningGeometry(level, wall, opening);

    const openingStartMm = opening.offsetMm - opening.widthMm / 2;
    const openingEndMm = opening.offsetMm + opening.widthMm / 2;
    for (const candidate of level.openings) {
      if (candidate.wallId !== opening.wallId) continue;
      const candidateStartMm = candidate.offsetMm - candidate.widthMm / 2;
      const candidateEndMm = candidate.offsetMm + candidate.widthMm / 2;
      if (openingStartMm < candidateEndMm && openingEndMm > candidateStartMm) {
        throw new Error(`Opening ${opening.id} overlaps opening ${candidate.id}.`);
      }
    }

    const nextLevel: Level = {
      ...level,
      openings: [...level.openings, opening],
    };

    return {
      document: replaceLevel(document, nextLevel),
      inverse: new RemoveOpeningCommand(this.input.levelId, opening),
    };
  }
}

class RemoveOpeningCommand implements EditorCommand {
  readonly type = "RemoveOpening";

  constructor(
    private readonly levelId: EntityId,
    private readonly opening: Opening,
  ) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.levelId);
    if (!level.openings.some((candidate) => candidate.id === this.opening.id)) {
      throw new Error(`Opening ${this.opening.id} does not exist.`);
    }

    const nextLevel: Level = {
      ...level,
      openings: level.openings.filter((candidate) => candidate.id !== this.opening.id),
    };

    return {
      document: replaceLevel(document, nextLevel),
      inverse: new AddOpeningCommand({ levelId: this.levelId, opening: this.opening }),
    };
  }
}

class RemoveWallCommand implements EditorCommand {
  readonly type = "RemoveWall";

  constructor(
    private readonly levelId: EntityId,
    private readonly wall: Wall,
    private readonly originallyAddedVertices: Vertex[],
  ) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.levelId);
    if (!level.walls.some((candidate) => candidate.id === this.wall.id)) {
      throw new Error(`Wall ${this.wall.id} does not exist.`);
    }
    if (level.openings.some((opening) => opening.wallId === this.wall.id)) {
      throw new Error(`Wall ${this.wall.id} still contains openings.`);
    }

    const remainingWalls = level.walls.filter((candidate) => candidate.id !== this.wall.id);
    const removableIds = new Set(this.originallyAddedVertices.map((vertex) => vertex.id));
    const referencedIds = new Set(
      remainingWalls.flatMap((candidate) => [candidate.startVertexId, candidate.endVertexId]),
    );

    const nextLevel: Level = {
      ...level,
      walls: remainingWalls,
      vertices: level.vertices.filter(
        (vertex) => !removableIds.has(vertex.id) || referencedIds.has(vertex.id),
      ),
    };

    const vertexById = new Map(level.vertices.map((vertex) => [vertex.id, vertex]));
    const start = toEndpoint(this.wall.startVertexId, removableIds, vertexById);
    const end = toEndpoint(this.wall.endVertexId, removableIds, vertexById);

    return {
      document: replaceLevel(document, nextLevel),
      inverse: new AddWallCommand({
        levelId: this.levelId,
        wallId: this.wall.id,
        start,
        end,
        thicknessMm: this.wall.thicknessMm,
        heightMm: this.wall.heightMm,
      }),
    };
  }
}

function validateOpeningGeometry(level: Level, wall: Wall, opening: Opening): void {
  for (const [field, value] of [
    ["offsetMm", opening.offsetMm],
    ["widthMm", opening.widthMm],
    ["heightMm", opening.heightMm],
    ["sillHeightMm", opening.sillHeightMm],
  ] as const) {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Opening ${opening.id} ${field} must be an integer millimetre value.`);
    }
  }

  if (opening.widthMm <= 0 || opening.heightMm <= 0 || opening.sillHeightMm < 0) {
    throw new Error(`Opening ${opening.id} dimensions are invalid.`);
  }

  const start = level.vertices.find((vertex) => vertex.id === wall.startVertexId);
  const end = level.vertices.find((vertex) => vertex.id === wall.endVertexId);
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

function endpointId(endpoint: WallEndpoint): EntityId {
  return endpoint.kind === "existing" ? endpoint.vertexId : endpoint.vertex.id;
}

function getLevel(document: ProjectDocument, levelId: EntityId): Level {
  const level = document.levels.find((candidate) => candidate.id === levelId);
  if (!level) throw new Error(`Level ${levelId} does not exist.`);
  return level;
}

function replaceLevel(document: ProjectDocument, level: Level): ProjectDocument {
  return {
    ...document,
    levels: document.levels.map((candidate) => (candidate.id === level.id ? level : candidate)),
  };
}

function toEndpoint(
  vertexId: EntityId,
  removableIds: Set<EntityId>,
  vertexById: Map<EntityId, Vertex>,
): WallEndpoint {
  if (!removableIds.has(vertexId)) return { kind: "existing", vertexId };
  const vertex = vertexById.get(vertexId);
  if (!vertex) throw new Error(`Vertex ${vertexId} does not exist.`);
  return { kind: "new", vertex };
}
