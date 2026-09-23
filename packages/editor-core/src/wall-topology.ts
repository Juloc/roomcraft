import {
  validateProjectDocument,
  type EntityId,
  type Level,
  type Opening,
  type ProjectDocument,
  type Vertex,
  type Wall,
} from "@roomcraft/document";
import {
  distanceMm,
  isInteriorParameter,
  pointAlong,
  segmentIntersection,
  type Point2Mm,
  type Segment2Mm,
} from "@roomcraft/geometry";
import {
  MoveVertexCommand,
  type CommandResult,
  type EditorCommand,
  type WallEndpoint,
} from "./commands";

export interface InsertWallWithTopologyInput {
  levelId: EntityId;
  wallId: EntityId;
  start: WallEndpoint;
  end: WallEndpoint;
  thicknessMm: number;
  heightMm?: number | null;
  leftMaterialId?: EntityId | null;
  rightMaterialId?: EntityId | null;
  createId(prefix: "vertex" | "wall"): EntityId;
  mergeToleranceMm?: number;
}

export class InsertWallWithTopologyCommand implements EditorCommand {
  readonly type = "InsertWallWithTopology";

  constructor(private readonly input: InsertWallWithTopologyInput) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.input.levelId);
    const mergeToleranceMm = this.input.mergeToleranceMm ?? 5;
    if (!Number.isFinite(mergeToleranceMm) || mergeToleranceMm < 0) {
      throw new Error("mergeToleranceMm must be a non-negative finite number.");
    }
    if (!Number.isSafeInteger(this.input.thicknessMm) || this.input.thicknessMm <= 0) {
      throw new Error("Wall thickness must be a positive integer millimetre value.");
    }
    if (level.walls.some((wall) => wall.id === this.input.wallId)) {
      throw new Error(`Wall ${this.input.wallId} already exists.`);
    }

    const before = geometrySnapshot(level);
    const vertices = [...level.vertices];
    const vertexById = new Map(vertices.map((vertex) => [vertex.id, vertex] as const));
    const usedIds = new Set<string>([
      ...vertices.map((vertex) => vertex.id),
      ...level.walls.map((wall) => wall.id),
    ]);

    const createUniqueId = (prefix: "vertex" | "wall"): EntityId => {
      for (let attempt = 0; attempt < 128; attempt += 1) {
        const id = this.input.createId(prefix);
        if (!usedIds.has(id)) {
          usedIds.add(id);
          return id;
        }
      }
      throw new Error(`Unable to create a unique ${prefix} id.`);
    };

    const resolveEndpoint = (endpoint: WallEndpoint): Vertex => {
      if (endpoint.kind === "existing") {
        const existing = vertexById.get(endpoint.vertexId);
        if (!existing) throw new Error(`Vertex ${endpoint.vertexId} does not exist.`);
        return existing;
      }

      const point = endpoint.vertex;
      const nearest = nearestVertex(vertices, point, mergeToleranceMm);
      if (nearest) return nearest;
      if (usedIds.has(point.id)) throw new Error(`Vertex ${point.id} already exists.`);
      usedIds.add(point.id);
      vertices.push(point);
      vertexById.set(point.id, point);
      return point;
    };

    const start = resolveEndpoint(this.input.start);
    const end = resolveEndpoint(this.input.end);
    if (start.id === end.id || distanceMm(start, end) < 1) {
      throw new Error("A wall needs two distinct endpoints at least 1 mm apart.");
    }

    const proposed: Segment2Mm = { start, end };
    const proposedCuts = new Map<number, EntityId>([
      [0, start.id],
      [1, end.id],
    ]);
    const wallCuts = new Map<EntityId, Map<number, EntityId>>();
    const intersectionVertexByPoint = new Map<string, EntityId>();

    const getIntersectionVertex = (
      point: Point2Mm,
      proposedT: number,
      wall: Wall,
      wallT: number,
    ): EntityId => {
      if (!isInteriorParameter(proposedT)) {
        return proposedT <= 0.5 ? start.id : end.id;
      }
      if (!isInteriorParameter(wallT)) {
        return wallT <= 0.5 ? wall.startVertexId : wall.endVertexId;
      }

      const rounded = { xMm: Math.round(point.xMm), yMm: Math.round(point.yMm) };
      const existing = nearestVertex(vertices, rounded, mergeToleranceMm);
      if (existing) return existing.id;

      const key = `${rounded.xMm}:${rounded.yMm}`;
      const known = intersectionVertexByPoint.get(key);
      if (known) return known;

      const vertex: Vertex = {
        id: createUniqueId("vertex"),
        xMm: rounded.xMm,
        yMm: rounded.yMm,
      };
      vertices.push(vertex);
      vertexById.set(vertex.id, vertex);
      intersectionVertexByPoint.set(key, vertex.id);
      return vertex.id;
    };

    for (const wall of level.walls) {
      const wallStart = vertexById.get(wall.startVertexId);
      const wallEnd = vertexById.get(wall.endVertexId);
      if (!wallStart || !wallEnd) {
        throw new Error(`Wall ${wall.id} references a missing vertex.`);
      }

      const intersection = segmentIntersection(proposed, {
        start: wallStart,
        end: wallEnd,
      });
      if (!intersection) continue;
      if (intersection.kind === "overlap") {
        throw new Error("The new wall overlaps an existing wall.");
      }

      const vertexId = getIntersectionVertex(
        intersection.point,
        intersection.aT,
        wall,
        intersection.bT,
      );
      proposedCuts.set(normalizeT(intersection.aT), vertexId);

      if (isInteriorParameter(intersection.bT)) {
        let cuts = wallCuts.get(wall.id);
        if (!cuts) {
          cuts = new Map();
          wallCuts.set(wall.id, cuts);
        }
        cuts.set(normalizeT(intersection.bT), vertexId);
      }
    }

    const nextWalls: Wall[] = [];
    const nextOpenings: Opening[] = [];
    const openingsByWall = new Map<EntityId, Opening[]>();
    for (const opening of level.openings) {
      const items = openingsByWall.get(opening.wallId) ?? [];
      items.push(opening);
      openingsByWall.set(opening.wallId, items);
    }

    for (const wall of level.walls) {
      const cuts = wallCuts.get(wall.id);
      if (!cuts || cuts.size === 0) {
        nextWalls.push(wall);
        nextOpenings.push(...(openingsByWall.get(wall.id) ?? []));
        continue;
      }

      const wallStart = vertexById.get(wall.startVertexId);
      const wallEnd = vertexById.get(wall.endVertexId);
      if (!wallStart || !wallEnd) {
        throw new Error(`Wall ${wall.id} references a missing vertex.`);
      }
      const lengthMm = distanceMm(wallStart, wallEnd);
      const sortedCuts = [...cuts.entries()]
        .filter(([t]) => isInteriorParameter(t))
        .sort(([a], [b]) => a - b);
      const markers: Array<{ t: number; vertexId: EntityId }> = [
        { t: 0, vertexId: wall.startVertexId },
        ...sortedCuts.map(([t, vertexId]) => ({ t, vertexId })),
        { t: 1, vertexId: wall.endVertexId },
      ];

      const splitWalls: Array<{ wall: Wall; fromMm: number; toMm: number }> = [];
      for (let index = 0; index < markers.length - 1; index += 1) {
        const from = markers[index]!;
        const to = markers[index + 1]!;
        const segmentLength = (to.t - from.t) * lengthMm;
        if (segmentLength < 1 || from.vertexId === to.vertexId) continue;

        const splitWall: Wall = {
          ...wall,
          id: index === 0 ? wall.id : createUniqueId("wall"),
          startVertexId: from.vertexId,
          endVertexId: to.vertexId,
        };
        nextWalls.push(splitWall);
        splitWalls.push({
          wall: splitWall,
          fromMm: from.t * lengthMm,
          toMm: to.t * lengthMm,
        });
      }

      for (const opening of openingsByWall.get(wall.id) ?? []) {
        const openingStartMm = opening.offsetMm - opening.widthMm / 2;
        const openingEndMm = opening.offsetMm + opening.widthMm / 2;
        for (const [t] of sortedCuts) {
          const cutMm = t * lengthMm;
          if (cutMm > openingStartMm + 0.01 && cutMm < openingEndMm - 0.01) {
            throw new Error(
              `Cannot create a wall junction through opening ${opening.id}.`,
            );
          }
        }

        const target = splitWalls.find(
          (segment) =>
            openingStartMm >= segment.fromMm - 0.01 &&
            openingEndMm <= segment.toMm + 0.01,
        );
        if (!target) {
          throw new Error(`Opening ${opening.id} cannot be preserved after splitting wall ${wall.id}.`);
        }
        nextOpenings.push({
          ...opening,
          wallId: target.wall.id,
          offsetMm: Math.round(opening.offsetMm - target.fromMm),
        });
      }
    }

    const proposedMarkers = [...proposedCuts.entries()]
      .sort(([a], [b]) => a - b)
      .reduce<Array<{ t: number; vertexId: EntityId }>>((items, [t, vertexId]) => {
        const previous = items.at(-1);
        if (previous && Math.abs(previous.t - t) <= 1e-8) {
          previous.vertexId = vertexId;
          return items;
        }
        items.push({ t, vertexId });
        return items;
      }, []);

    for (let index = 0; index < proposedMarkers.length - 1; index += 1) {
      const from = proposedMarkers[index]!;
      const to = proposedMarkers[index + 1]!;
      if (from.vertexId === to.vertexId) continue;
      const fromVertex = vertexById.get(from.vertexId);
      const toVertex = vertexById.get(to.vertexId);
      if (!fromVertex || !toVertex || distanceMm(fromVertex, toVertex) < 1) continue;

      const wall: Wall = {
        id: index === 0 ? this.input.wallId : createUniqueId("wall"),
        startVertexId: from.vertexId,
        endVertexId: to.vertexId,
        thicknessMm: this.input.thicknessMm,
        heightMm: this.input.heightMm ?? null,
        leftMaterialId: this.input.leftMaterialId ?? null,
        rightMaterialId: this.input.rightMaterialId ?? null,
      };
      if (hasDuplicateWall(nextWalls, wall)) {
        throw new Error("A wall already exists between these endpoints.");
      }
      nextWalls.push(wall);
    }

    if (!nextWalls.some((wall) => wall.id === this.input.wallId)) {
      throw new Error("The new wall does not create a valid segment.");
    }

    const referencedVertexIds = new Set(
      nextWalls.flatMap((wall) => [wall.startVertexId, wall.endVertexId]),
    );
    const nextLevel: Level = {
      ...level,
      vertices: vertices.filter((vertex) => referencedVertexIds.has(vertex.id)),
      walls: nextWalls,
      openings: nextOpenings,
    };
    const nextDocument = replaceLevel(document, nextLevel);
    validateProjectDocument(nextDocument);

    return {
      document: nextDocument,
      inverse: new RestoreLevelGeometryCommand(this.input.levelId, before),
    };
  }
}

export interface SetWallAngleInput {
  levelId: EntityId;
  wallId: EntityId;
  angleDeg: number;
  anchor?: "start" | "end";
}

export class SetWallAngleCommand implements EditorCommand {
  readonly type = "SetWallAngle";

  constructor(private readonly input: SetWallAngleInput) {}

  execute(document: ProjectDocument): CommandResult {
    if (!Number.isFinite(this.input.angleDeg)) throw new Error("Wall angle must be finite.");

    const level = getLevel(document, this.input.levelId);
    const wall = findWall(level, this.input.wallId);
    const start = findVertex(level, wall.startVertexId);
    const end = findVertex(level, wall.endVertexId);
    const anchor = this.input.anchor ?? "start";
    const fixed = anchor === "start" ? start : end;
    const moving = anchor === "start" ? end : start;
    const lengthMm = distanceMm(start, end);
    if (lengthMm < 1) throw new Error(`Wall ${wall.id} has zero length.`);

    const radians = (this.input.angleDeg * Math.PI) / 180;
    const direction = anchor === "start" ? 1 : -1;
    return new MoveVertexCommand({
      levelId: level.id,
      vertexId: moving.id,
      xMm: Math.round(fixed.xMm + direction * Math.cos(radians) * lengthMm),
      yMm: Math.round(fixed.yMm + direction * Math.sin(radians) * lengthMm),
    }).execute(document);
  }
}

export interface SetWallThicknessInput {
  levelId: EntityId;
  wallId: EntityId;
  thicknessMm: number;
}

export class SetWallThicknessCommand implements EditorCommand {
  readonly type = "SetWallThickness";

  constructor(private readonly input: SetWallThicknessInput) {}

  execute(document: ProjectDocument): CommandResult {
    if (!Number.isSafeInteger(this.input.thicknessMm) || this.input.thicknessMm <= 0) {
      throw new Error("Wall thickness must be a positive integer millimetre value.");
    }
    const level = getLevel(document, this.input.levelId);
    const wall = findWall(level, this.input.wallId);
    const nextWall = { ...wall, thicknessMm: this.input.thicknessMm };
    const nextLevel = {
      ...level,
      walls: level.walls.map((candidate) => candidate.id === wall.id ? nextWall : candidate),
    };
    const nextDocument = replaceLevel(document, nextLevel);
    validateProjectDocument(nextDocument);
    return {
      document: nextDocument,
      inverse: new SetWallThicknessCommand({
        levelId: level.id,
        wallId: wall.id,
        thicknessMm: wall.thicknessMm,
      }),
    };
  }
}

export class RemoveWallByIdCommand implements EditorCommand {
  readonly type = "RemoveWallById";

  constructor(
    private readonly levelId: EntityId,
    private readonly wallId: EntityId,
  ) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.levelId);
    findWall(level, this.wallId);
    const before = geometrySnapshot(level);
    const walls = level.walls.filter((wall) => wall.id !== this.wallId);
    const referencedVertexIds = new Set(
      walls.flatMap((wall) => [wall.startVertexId, wall.endVertexId]),
    );
    const nextLevel: Level = {
      ...level,
      walls,
      openings: level.openings.filter((opening) => opening.wallId !== this.wallId),
      vertices: level.vertices.filter((vertex) => referencedVertexIds.has(vertex.id)),
    };
    const nextDocument = replaceLevel(document, nextLevel);
    validateProjectDocument(nextDocument);
    return {
      document: nextDocument,
      inverse: new RestoreLevelGeometryCommand(this.levelId, before),
    };
  }
}

interface LevelGeometrySnapshot {
  vertices: Vertex[];
  walls: Wall[];
  openings: Opening[];
}

class RestoreLevelGeometryCommand implements EditorCommand {
  readonly type = "RestoreLevelGeometry";

  constructor(
    private readonly levelId: EntityId,
    private readonly snapshot: LevelGeometrySnapshot,
  ) {}

  execute(document: ProjectDocument): CommandResult {
    const level = getLevel(document, this.levelId);
    const before = geometrySnapshot(level);
    const nextDocument = replaceLevel(document, {
      ...level,
      vertices: this.snapshot.vertices,
      walls: this.snapshot.walls,
      openings: this.snapshot.openings,
    });
    validateProjectDocument(nextDocument);
    return {
      document: nextDocument,
      inverse: new RestoreLevelGeometryCommand(this.levelId, before),
    };
  }
}

function geometrySnapshot(level: Level): LevelGeometrySnapshot {
  return {
    vertices: level.vertices.map((vertex) => ({ ...vertex })),
    walls: level.walls.map((wall) => ({ ...wall })),
    openings: level.openings.map((opening) => ({ ...opening })),
  };
}

function getLevel(document: ProjectDocument, levelId: EntityId): Level {
  const level = document.levels.find((candidate) => candidate.id === levelId);
  if (!level) throw new Error(`Level ${levelId} does not exist.`);
  return level;
}

function replaceLevel(document: ProjectDocument, level: Level): ProjectDocument {
  return {
    ...document,
    levels: document.levels.map((candidate) => candidate.id === level.id ? level : candidate),
  };
}

function findWall(level: Level, wallId: EntityId): Wall {
  const wall = level.walls.find((candidate) => candidate.id === wallId);
  if (!wall) throw new Error(`Wall ${wallId} does not exist.`);
  return wall;
}

function findVertex(level: Level, vertexId: EntityId): Vertex {
  const vertex = level.vertices.find((candidate) => candidate.id === vertexId);
  if (!vertex) throw new Error(`Vertex ${vertexId} does not exist.`);
  return vertex;
}

function nearestVertex(
  vertices: readonly Vertex[],
  point: Point2Mm,
  toleranceMm: number,
): Vertex | null {
  let best: { vertex: Vertex; distance: number } | null = null;
  for (const vertex of vertices) {
    const distance = distanceMm(vertex, point);
    if (distance > toleranceMm) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && vertex.id.localeCompare(best.vertex.id) < 0)
    ) {
      best = { vertex, distance };
    }
  }
  return best?.vertex ?? null;
}

function normalizeT(value: number): number {
  if (value <= 1e-8) return 0;
  if (value >= 1 - 1e-8) return 1;
  return Math.round(value * 1e10) / 1e10;
}

function hasDuplicateWall(walls: readonly Wall[], wall: Wall): boolean {
  return walls.some(
    (candidate) =>
      (candidate.startVertexId === wall.startVertexId &&
        candidate.endVertexId === wall.endVertexId) ||
      (candidate.startVertexId === wall.endVertexId &&
        candidate.endVertexId === wall.startVertexId),
  );
}
