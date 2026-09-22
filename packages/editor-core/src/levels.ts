import type { EntityId, Level } from "@roomcraft/document";

export interface DuplicateLevelShellOptions {
  levelId: EntityId;
  name: string;
  elevationMm: number;
  createId(prefix: "vertex" | "wall" | "opening"): EntityId;
}

export function duplicateLevelShell(
  source: Level,
  options: DuplicateLevelShellOptions,
): Level {
  const vertexIdMap = new Map<EntityId, EntityId>();
  const wallIdMap = new Map<EntityId, EntityId>();

  const vertices = source.vertices.map((vertex) => {
    const id = options.createId("vertex");
    vertexIdMap.set(vertex.id, id);
    return { ...vertex, id };
  });

  const walls = source.walls.map((wall) => {
    const startVertexId = vertexIdMap.get(wall.startVertexId);
    const endVertexId = vertexIdMap.get(wall.endVertexId);
    if (!startVertexId || !endVertexId) {
      throw new Error(`Wall ${wall.id} references a missing source vertex.`);
    }

    const id = options.createId("wall");
    wallIdMap.set(wall.id, id);
    return {
      ...wall,
      id,
      startVertexId,
      endVertexId,
    };
  });

  const openings = source.openings.map((opening) => {
    const wallId = wallIdMap.get(opening.wallId);
    if (!wallId) {
      throw new Error(`Opening ${opening.id} references a missing source wall.`);
    }

    return {
      ...opening,
      id: options.createId("opening"),
      wallId,
    };
  });

  return {
    id: options.levelId,
    name: options.name,
    elevationMm: options.elevationMm,
    defaultWallHeightMm: source.defaultWallHeightMm,
    floorThicknessMm: source.floorThicknessMm,
    vertices,
    walls,
    openings,
    objects: [],
    blueprints: [],
  };
}
