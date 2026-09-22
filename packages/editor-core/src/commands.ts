import {
  validateProjectDocument,
  type BlueprintReference,
  type EntityId,
  type Level,
  type ObjectInstance,
  type Opening,
  type ParametricFurnitureDefinition,
  type ProjectDocument,
  type Vertex,
  type Wall,
} from "@roomcraft/document";
import { distanceMm, type Point2Mm } from "@roomcraft/geometry";
import { calibrateBlueprintReference } from "./blueprints";

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

export interface AddLevelInput {
  level: Level;
  index?: number;
}

export class AddLevelCommand implements EditorCommand {
  readonly type = "AddLevel";

  constructor(private readonly input: AddLevelInput) {}

  execute(document: ProjectDocument): CommandResult {
    if (document.levels.some((level) => level.id === this.input.level.id)) {
      throw new Error(`Level ${this.input.level.id} already exists.`);
    }

    const index = this.input.index ?? document.levels.length;
    if (!Number.isSafeInteger(index) || index < 0 || index > document.levels.length) {
      throw new Error("Level insertion index is invalid.");
    }

    const levels = [...document.levels];
    levels.splice(index, 0, this.input.level);
    const nextDocument = { ...document, levels };
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new RemoveLevelCommand(this.input.level.id),
    };
  }
}

export interface UpdateLevelInput {
  levelId: EntityId;
  name?: string;
  elevationMm?: number;
  defaultWallHeightMm?: number;
  floorThicknessMm?: number;
}

export class UpdateLevelCommand implements EditorCommand {
  readonly type = "UpdateLevel";

  constructor(private readonly input: UpdateLevelInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    const previous: UpdateLevelInput = {
      levelId: level.id,
      name: level.name,
      elevationMm: level.elevationMm,
      defaultWallHeightMm: level.defaultWallHeightMm,
      floorThicknessMm: level.floorThicknessMm,
    };

    const nextLevel: Level = {
      ...level,
      name: this.input.name ?? level.name,
      elevationMm: this.input.elevationMm ?? level.elevationMm,
      defaultWallHeightMm:
        this.input.defaultWallHeightMm ?? level.defaultWallHeightMm,
      floorThicknessMm:
        this.input.floorThicknessMm ?? level.floorThicknessMm,
    };
    const nextDocument = replaceLevel(document, nextLevel);
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new UpdateLevelCommand(previous),
    };
  }
}

export class RemoveLevelCommand implements EditorCommand {
  readonly type = "RemoveLevel";

  constructor(private readonly levelId: EntityId) {}

  execute(document: ProjectDocument): CommandResult {
    if (document.levels.length <= 1) {
      throw new Error("A project must keep at least one level.");
    }

    const index = document.levels.findIndex((level) => level.id === this.levelId);
    if (index < 0) throw new Error(`Level ${this.levelId} does not exist.`);
    const level = document.levels[index];
    if (!level) throw new Error(`Level ${this.levelId} does not exist.`);

    const nextDocument = {
      ...document,
      levels: document.levels.filter((candidate) => candidate.id !== this.levelId),
    };
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new AddLevelCommand({ level, index }),
    };
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
  leftMaterialId?: EntityId | null;
  rightMaterialId?: EntityId | null;
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
      leftMaterialId: this.input.leftMaterialId ?? null,
      rightMaterialId: this.input.rightMaterialId ?? null,
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

export interface MoveVertexInput {
  levelId: EntityId;
  vertexId: EntityId;
  xMm: number;
  yMm: number;
}

export class MoveVertexCommand implements EditorCommand {
  readonly type = "MoveVertex";

  constructor(private readonly input: MoveVertexInput) {}

  execute(document: ProjectDocument): CommandResult {
    if (!Number.isSafeInteger(this.input.xMm) || !Number.isSafeInteger(this.input.yMm)) {
      throw new Error("Vertex coordinates must be integer millimetre values.");
    }

    const level = getLevel(document, this.input.levelId);
    const existing = level.vertices.find((vertex) => vertex.id === this.input.vertexId);
    if (!existing) throw new Error(`Vertex ${this.input.vertexId} does not exist.`);

    if (existing.xMm === this.input.xMm && existing.yMm === this.input.yMm) {
      return {
        document,
        inverse: new MoveVertexCommand({
          levelId: this.input.levelId,
          vertexId: existing.id,
          xMm: existing.xMm,
          yMm: existing.yMm,
        }),
      };
    }

    const moved: Vertex = {
      ...existing,
      xMm: this.input.xMm,
      yMm: this.input.yMm,
    };
    const nextLevel: Level = {
      ...level,
      vertices: level.vertices.map((vertex) => (vertex.id === moved.id ? moved : vertex)),
    };

    validateIncidentWallGeometry(nextLevel, moved.id);

    return {
      document: replaceLevel(document, nextLevel),
      inverse: new MoveVertexCommand({
        levelId: this.input.levelId,
        vertexId: existing.id,
        xMm: existing.xMm,
        yMm: existing.yMm,
      }),
    };
  }
}

export interface SetWallLengthInput {
  levelId: EntityId;
  wallId: EntityId;
  lengthMm: number;
  anchor?: "start" | "end";
}

export class SetWallLengthCommand implements EditorCommand {
  readonly type = "SetWallLength";

  constructor(private readonly input: SetWallLengthInput) {}

  execute(document: ProjectDocument): CommandResult {
    if (!Number.isSafeInteger(this.input.lengthMm) || this.input.lengthMm <= 0) {
      throw new Error("Wall length must be a positive integer millimetre value.");
    }

    const level = getLevel(document, this.input.levelId);
    const wall = level.walls.find((candidate) => candidate.id === this.input.wallId);
    if (!wall) throw new Error(`Wall ${this.input.wallId} does not exist.`);

    const start = level.vertices.find((vertex) => vertex.id === wall.startVertexId);
    const end = level.vertices.find((vertex) => vertex.id === wall.endVertexId);
    if (!start || !end) throw new Error(`Wall ${wall.id} references a missing vertex.`);

    const anchor = this.input.anchor ?? "start";
    const fixed = anchor === "start" ? start : end;
    const moving = anchor === "start" ? end : start;
    const currentLengthMm = distanceMm(fixed, moving);
    if (currentLengthMm <= 0) throw new Error(`Wall ${wall.id} has zero length.`);

    const scale = this.input.lengthMm / currentLengthMm;
    const xMm = Math.round(fixed.xMm + (moving.xMm - fixed.xMm) * scale);
    const yMm = Math.round(fixed.yMm + (moving.yMm - fixed.yMm) * scale);

    return new MoveVertexCommand({
      levelId: this.input.levelId,
      vertexId: moving.id,
      xMm,
      yMm,
    }).execute(document);
  }
}

export interface AddBlueprintInput {
  levelId: EntityId;
  blueprint: BlueprintReference;
  index?: number;
}

export class AddBlueprintCommand implements EditorCommand {
  readonly type = "AddBlueprint";

  constructor(private readonly input: AddBlueprintInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    if (level.blueprints.some((candidate) => candidate.id === this.input.blueprint.id)) {
      throw new Error(`Blueprint ${this.input.blueprint.id} already exists.`);
    }

    const index = this.input.index ?? level.blueprints.length;
    if (!Number.isSafeInteger(index) || index < 0 || index > level.blueprints.length) {
      throw new Error("Blueprint insertion index is invalid.");
    }

    const blueprints = [...level.blueprints];
    blueprints.splice(index, 0, this.input.blueprint);
    const nextLevel: Level = {
      ...level,
      blueprints,
    };
    const nextDocument = replaceLevel(document, nextLevel);
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new RemoveBlueprintCommand(this.input.levelId, this.input.blueprint.id),
    };
  }
}

export interface UpdateBlueprintInput {
  levelId: EntityId;
  blueprint: BlueprintReference;
}

export class UpdateBlueprintCommand implements EditorCommand {
  readonly type = "UpdateBlueprint";

  constructor(private readonly input: UpdateBlueprintInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    const previous = level.blueprints.find(
      (candidate) => candidate.id === this.input.blueprint.id,
    );
    if (!previous) throw new Error(`Blueprint ${this.input.blueprint.id} does not exist.`);
    if (previous.assetId !== this.input.blueprint.assetId) {
      throw new Error("Blueprint assetId is immutable. Add a new blueprint instead.");
    }

    const nextLevel: Level = {
      ...level,
      blueprints: level.blueprints.map((candidate) =>
        candidate.id === this.input.blueprint.id ? this.input.blueprint : candidate,
      ),
    };
    const nextDocument = replaceLevel(document, nextLevel);
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new UpdateBlueprintCommand({
        levelId: this.input.levelId,
        blueprint: previous,
      }),
    };
  }
}

export interface CalibrateBlueprintInput {
  levelId: EntityId;
  blueprintId: EntityId;
  firstPlanPoint: Point2Mm;
  secondPlanPoint: Point2Mm;
  knownLengthMm: number;
}

export class CalibrateBlueprintCommand implements EditorCommand {
  readonly type = "CalibrateBlueprint";

  constructor(private readonly input: CalibrateBlueprintInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    const blueprint = level.blueprints.find(
      (candidate) => candidate.id === this.input.blueprintId,
    );
    if (!blueprint) throw new Error(`Blueprint ${this.input.blueprintId} does not exist.`);

    const calibrated = calibrateBlueprintReference(
      blueprint,
      this.input.firstPlanPoint,
      this.input.secondPlanPoint,
      this.input.knownLengthMm,
    );

    return new UpdateBlueprintCommand({
      levelId: this.input.levelId,
      blueprint: calibrated,
    }).execute(document);
  }
}

export class RemoveBlueprintCommand implements EditorCommand {
  readonly type = "RemoveBlueprint";

  constructor(
    private readonly levelId: EntityId,
    private readonly blueprintId: EntityId,
  ) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.levelId);
    const index = level.blueprints.findIndex(
      (candidate) => candidate.id === this.blueprintId,
    );
    if (index < 0) {
      throw new Error(`Blueprint ${this.blueprintId} does not exist.`);
    }

    const blueprint = level.blueprints[index];
    if (!blueprint) {
      throw new Error(`Blueprint ${this.blueprintId} does not exist.`);
    }

    const nextLevel: Level = {
      ...level,
      blueprints: level.blueprints.filter(
        (candidate) => candidate.id !== this.blueprintId,
      ),
    };

    return {
      document: replaceLevel(document, nextLevel),
      inverse: new AddBlueprintCommand({
        levelId: this.levelId,
        blueprint,
        index,
      }),
    };
  }
}

export interface MoveBlueprintLayerInput {
  levelId: EntityId;
  blueprintId: EntityId;
  toIndex: number;
}

export class MoveBlueprintLayerCommand implements EditorCommand {
  readonly type = "MoveBlueprintLayer";

  constructor(private readonly input: MoveBlueprintLayerInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    if (
      !Number.isSafeInteger(this.input.toIndex) ||
      this.input.toIndex < 0 ||
      this.input.toIndex >= level.blueprints.length
    ) {
      throw new Error("Blueprint target index is invalid.");
    }

    const fromIndex = level.blueprints.findIndex(
      (candidate) => candidate.id === this.input.blueprintId,
    );
    if (fromIndex < 0) {
      throw new Error(`Blueprint ${this.input.blueprintId} does not exist.`);
    }

    if (fromIndex === this.input.toIndex) {
      return {
        document,
        inverse: new MoveBlueprintLayerCommand({
          ...this.input,
          toIndex: fromIndex,
        }),
      };
    }

    const blueprints = [...level.blueprints];
    const [blueprint] = blueprints.splice(fromIndex, 1);
    if (!blueprint) {
      throw new Error(`Blueprint ${this.input.blueprintId} does not exist.`);
    }
    blueprints.splice(this.input.toIndex, 0, blueprint);

    const nextLevel: Level = {
      ...level,
      blueprints,
    };

    return {
      document: replaceLevel(document, nextLevel),
      inverse: new MoveBlueprintLayerCommand({
        levelId: this.input.levelId,
        blueprintId: this.input.blueprintId,
        toIndex: fromIndex,
      }),
    };
  }
}

export interface AddParametricAssetInput {
  definition: ParametricFurnitureDefinition;
  index?: number;
}

export class AddParametricAssetCommand implements EditorCommand {
  readonly type = "AddParametricAsset";

  constructor(private readonly input: AddParametricAssetInput) {}

  execute(document: ProjectDocument): CommandResult {
    if (
      document.parametricAssets.some(
        (candidate) => candidate.id === this.input.definition.id,
      )
    ) {
      throw new Error(
        `Parametric asset ${this.input.definition.id} already exists.`,
      );
    }

    const index = this.input.index ?? document.parametricAssets.length;
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index > document.parametricAssets.length
    ) {
      throw new Error("Parametric asset insertion index is invalid.");
    }

    const parametricAssets = [...document.parametricAssets];
    parametricAssets.splice(index, 0, this.input.definition);
    const nextDocument: ProjectDocument = {
      ...document,
      parametricAssets,
    };
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new RemoveParametricAssetCommand(this.input.definition.id),
    };
  }
}

export interface UpdateParametricAssetInput {
  definition: ParametricFurnitureDefinition;
}

export class UpdateParametricAssetCommand implements EditorCommand {
  readonly type = "UpdateParametricAsset";

  constructor(private readonly input: UpdateParametricAssetInput) {}

  execute(document: ProjectDocument): CommandResult {
    const previous = document.parametricAssets.find(
      (candidate) => candidate.id === this.input.definition.id,
    );
    if (!previous) {
      throw new Error(
        `Parametric asset ${this.input.definition.id} does not exist.`,
      );
    }
    if (previous.kind !== this.input.definition.kind) {
      throw new Error("Parametric asset kind is immutable. Replace the asset instead.");
    }

    const nextDocument: ProjectDocument = {
      ...document,
      parametricAssets: document.parametricAssets.map((candidate) =>
        candidate.id === this.input.definition.id
          ? this.input.definition
          : candidate,
      ),
    };
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new UpdateParametricAssetCommand({ definition: previous }),
    };
  }
}

export class RemoveParametricAssetCommand implements EditorCommand {
  readonly type = "RemoveParametricAsset";

  constructor(private readonly definitionId: EntityId) {}

  execute(document: ProjectDocument): CommandResult {
    const index = document.parametricAssets.findIndex(
      (candidate) => candidate.id === this.definitionId,
    );
    if (index < 0) {
      throw new Error(`Parametric asset ${this.definitionId} does not exist.`);
    }

    const assetId = `parametric:${this.definitionId}`;
    const referencedBy = document.levels
      .flatMap((level) => level.objects)
      .find((object) => object.assetId === assetId);
    if (referencedBy) {
      throw new Error(
        `Parametric asset ${this.definitionId} is still used by object ${referencedBy.id}.`,
      );
    }

    const definition = document.parametricAssets[index];
    if (!definition) {
      throw new Error(`Parametric asset ${this.definitionId} does not exist.`);
    }

    const nextDocument: ProjectDocument = {
      ...document,
      parametricAssets: document.parametricAssets.filter(
        (candidate) => candidate.id !== this.definitionId,
      ),
    };
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new AddParametricAssetCommand({ definition, index }),
    };
  }
}

export interface AddObjectInput {
  levelId: EntityId;
  object: ObjectInstance;
  index?: number;
}

export class AddObjectCommand implements EditorCommand {
  readonly type = "AddObject";

  constructor(private readonly input: AddObjectInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    if (level.objects.some((candidate) => candidate.id === this.input.object.id)) {
      throw new Error(`Object ${this.input.object.id} already exists.`);
    }

    const index = this.input.index ?? level.objects.length;
    if (!Number.isSafeInteger(index) || index < 0 || index > level.objects.length) {
      throw new Error("Object insertion index is invalid.");
    }

    const objects = [...level.objects];
    objects.splice(index, 0, this.input.object);
    const nextDocument = replaceLevel(document, { ...level, objects });
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new RemoveObjectCommand(this.input.levelId, this.input.object.id),
    };
  }
}

export interface UpdateObjectInput {
  levelId: EntityId;
  object: ObjectInstance;
}

export class UpdateObjectCommand implements EditorCommand {
  readonly type = "UpdateObject";

  constructor(private readonly input: UpdateObjectInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    const previous = level.objects.find(
      (candidate) => candidate.id === this.input.object.id,
    );
    if (!previous) throw new Error(`Object ${this.input.object.id} does not exist.`);
    if (previous.assetId !== this.input.object.assetId) {
      throw new Error("Object assetId is immutable. Replace the object instead.");
    }

    const nextDocument = replaceLevel(document, {
      ...level,
      objects: level.objects.map((candidate) =>
        candidate.id === this.input.object.id ? this.input.object : candidate,
      ),
    });
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new UpdateObjectCommand({
        levelId: this.input.levelId,
        object: previous,
      }),
    };
  }
}

export class RemoveObjectCommand implements EditorCommand {
  readonly type = "RemoveObject";

  constructor(
    private readonly levelId: EntityId,
    private readonly objectId: EntityId,
  ) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.levelId);
    const index = level.objects.findIndex(
      (candidate) => candidate.id === this.objectId,
    );
    if (index < 0) throw new Error(`Object ${this.objectId} does not exist.`);

    const object = level.objects[index];
    if (!object) throw new Error(`Object ${this.objectId} does not exist.`);

    const nextDocument = replaceLevel(document, {
      ...level,
      objects: level.objects.filter((candidate) => candidate.id !== this.objectId),
    });
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new AddObjectCommand({
        levelId: this.levelId,
        object,
        index,
      }),
    };
  }
}

export interface SetWallMaterialsInput {
  levelId: EntityId;
  wallId: EntityId;
  leftMaterialId?: EntityId | null;
  rightMaterialId?: EntityId | null;
}

export class SetWallMaterialsCommand implements EditorCommand {
  readonly type = "SetWallMaterials";

  constructor(private readonly input: SetWallMaterialsInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    const wall = level.walls.find((candidate) => candidate.id === this.input.wallId);
    if (!wall) throw new Error(`Wall ${this.input.wallId} does not exist.`);

    const previous: SetWallMaterialsInput = {
      levelId: level.id,
      wallId: wall.id,
      leftMaterialId: wall.leftMaterialId ?? null,
      rightMaterialId: wall.rightMaterialId ?? null,
    };

    const nextWall: Wall = {
      ...wall,
      leftMaterialId:
        this.input.leftMaterialId === undefined
          ? wall.leftMaterialId ?? null
          : this.input.leftMaterialId,
      rightMaterialId:
        this.input.rightMaterialId === undefined
          ? wall.rightMaterialId ?? null
          : this.input.rightMaterialId,
    };
    const nextLevel: Level = {
      ...level,
      walls: level.walls.map((candidate) =>
        candidate.id === wall.id ? nextWall : candidate,
      ),
    };
    const nextDocument = replaceLevel(document, nextLevel);
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new SetWallMaterialsCommand(previous),
    };
  }
}

export interface SetRoomSurfaceMaterialsInput {
  levelId: EntityId;
  roomKey: string;
  floorMaterialId?: EntityId | null;
  ceilingMaterialId?: EntityId | null;
}

export class SetRoomSurfaceMaterialsCommand implements EditorCommand {
  readonly type = "SetRoomSurfaceMaterials";

  constructor(private readonly input: SetRoomSurfaceMaterialsInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    const existing = level.roomFinishes.find(
      (finish) => finish.roomKey === this.input.roomKey,
    );

    const previous: SetRoomSurfaceMaterialsInput = {
      levelId: level.id,
      roomKey: this.input.roomKey,
      floorMaterialId: existing?.floorMaterialId ?? null,
      ceilingMaterialId: existing?.ceilingMaterialId ?? null,
    };

    const floorMaterialId =
      this.input.floorMaterialId === undefined
        ? existing?.floorMaterialId ?? null
        : this.input.floorMaterialId;
    const ceilingMaterialId =
      this.input.ceilingMaterialId === undefined
        ? existing?.ceilingMaterialId ?? null
        : this.input.ceilingMaterialId;

    let roomFinishes = level.roomFinishes.filter(
      (finish) => finish.roomKey !== this.input.roomKey,
    );
    if (floorMaterialId !== null || ceilingMaterialId !== null) {
      roomFinishes = [
        ...roomFinishes,
        {
          roomKey: this.input.roomKey,
          floorMaterialId,
          ceilingMaterialId,
        },
      ];
    }

    const nextDocument = replaceLevel(document, {
      ...level,
      roomFinishes,
    });
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new SetRoomSurfaceMaterialsCommand(previous),
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
        leftMaterialId: this.wall.leftMaterialId ?? null,
        rightMaterialId: this.wall.rightMaterialId ?? null,
      }),
    };
  }
}

function validateIncidentWallGeometry(level: Level, vertexId: EntityId): void {
  const vertex = level.vertices.find((candidate) => candidate.id === vertexId);
  if (!vertex) throw new Error(`Vertex ${vertexId} does not exist.`);

  for (const wall of level.walls) {
    if (wall.startVertexId !== vertexId && wall.endVertexId !== vertexId) continue;

    const otherVertexId =
      wall.startVertexId === vertexId ? wall.endVertexId : wall.startVertexId;
    const other = level.vertices.find((candidate) => candidate.id === otherVertexId);
    if (!other) throw new Error(`Wall ${wall.id} references a missing vertex.`);

    if (distanceMm(vertex, other) <= 0) {
      throw new Error(`Moving vertex ${vertexId} would collapse wall ${wall.id}.`);
    }

    for (const opening of level.openings) {
      if (opening.wallId === wall.id) validateOpeningGeometry(level, wall, opening);
    }
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
