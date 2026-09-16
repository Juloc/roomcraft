import type { EntityId, Level, ProjectDocument, Vertex, Wall } from "@roomcraft/document";

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
