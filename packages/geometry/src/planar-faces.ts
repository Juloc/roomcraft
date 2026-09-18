export interface PlanarVertex {
  id: string;
  xMm: number;
  yMm: number;
}

export interface PlanarEdge {
  id: string;
  startVertexId: string;
  endVertexId: string;
}

export interface DerivedPlanarFace {
  key: string;
  vertexIds: string[];
  points: Array<{ xMm: number; yMm: number }>;
  areaMm2: number;
  centroid: { xMm: number; yMm: number };
}

export type PlanarGraphIssue =
  | {
      type: "zero-length-edge";
      edgeIds: [string];
      point: { xMm: number; yMm: number };
    }
  | {
      type: "unsplit-intersection";
      edgeIds: [string, string];
      point: { xMm: number; yMm: number };
    };

export interface PlanarFaceAnalysis {
  faces: DerivedPlanarFace[];
  issues: PlanarGraphIssue[];
}

interface HalfEdge {
  id: string;
  edgeId: string;
  fromId: string;
  toId: string;
  angle: number;
}

/**
 * Derives bounded faces from a straight-line planar graph.
 *
 * The input must express every real intersection as a shared vertex. If two
 * edges intersect without sharing a vertex, no faces are returned and the
 * intersection is reported as an issue rather than guessing topology.
 */
export function analyzePlanarFaces(
  vertices: readonly PlanarVertex[],
  edges: readonly PlanarEdge[],
): PlanarFaceAnalysis {
  const vertexById = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const issues: PlanarGraphIssue[] = [];
  const validEdges: Array<PlanarEdge & { start: PlanarVertex; end: PlanarVertex }> = [];

  for (const edge of edges) {
    const start = vertexById.get(edge.startVertexId);
    const end = vertexById.get(edge.endVertexId);
    if (!start || !end) {
      throw new Error(`Edge ${edge.id} references a missing vertex.`);
    }

    if (samePoint(start, end)) {
      issues.push({
        type: "zero-length-edge",
        edgeIds: [edge.id],
        point: { xMm: start.xMm, yMm: start.yMm },
      });
      continue;
    }

    validEdges.push({ ...edge, start, end });
  }

  for (let i = 0; i < validEdges.length; i += 1) {
    const first = validEdges[i];
    if (!first) continue;

    for (let j = i + 1; j < validEdges.length; j += 1) {
      const second = validEdges[j];
      if (!second) continue;
      if (shareVertex(first, second)) continue;

      const intersection = segmentIntersection(first.start, first.end, second.start, second.end);
      if (!intersection) continue;

      issues.push({
        type: "unsplit-intersection",
        edgeIds: [first.id, second.id],
        point: intersection,
      });
    }
  }

  if (issues.length > 0) return { faces: [], issues };

  const outgoing = new Map<string, HalfEdge[]>();
  const halfEdges: HalfEdge[] = [];

  for (const edge of validEdges) {
    const forward = makeHalfEdge(edge.id, edge.start, edge.end, "forward");
    const reverse = makeHalfEdge(edge.id, edge.end, edge.start, "reverse");
    halfEdges.push(forward, reverse);
    addOutgoing(outgoing, forward);
    addOutgoing(outgoing, reverse);
  }

  for (const list of outgoing.values()) {
    list.sort((a, b) => a.angle - b.angle || a.id.localeCompare(b.id));
  }

  const visited = new Set<string>();
  const faces: DerivedPlanarFace[] = [];

  for (const startHalfEdge of halfEdges) {
    if (visited.has(startHalfEdge.id)) continue;

    const cycle = traceFace(startHalfEdge, outgoing, visited);
    if (!cycle || cycle.length < 3) continue;

    const cycleVertices = cycle.map((halfEdge) => {
      const vertex = vertexById.get(halfEdge.fromId);
      if (!vertex) throw new Error(`Half-edge references missing vertex ${halfEdge.fromId}.`);
      return vertex;
    });

    const signedAreaMm2 = signedPolygonAreaMm2(cycleVertices);
    if (signedAreaMm2 <= 0) continue;

    const centroid = polygonCentroid(cycleVertices, signedAreaMm2);
    const vertexIds = cycleVertices.map((vertex) => vertex.id);

    faces.push({
      key: createFaceKey(vertexIds),
      vertexIds,
      points: cycleVertices.map((vertex) => ({ xMm: vertex.xMm, yMm: vertex.yMm })),
      areaMm2: signedAreaMm2,
      centroid,
    });
  }

  faces.sort((a, b) => a.key.localeCompare(b.key));
  return { faces, issues };
}

function makeHalfEdge(
  edgeId: string,
  from: PlanarVertex,
  to: PlanarVertex,
  direction: "forward" | "reverse",
): HalfEdge {
  return {
    id: `${edgeId}:${direction}`,
    edgeId,
    fromId: from.id,
    toId: to.id,
    angle: Math.atan2(to.yMm - from.yMm, to.xMm - from.xMm),
  };
}

function addOutgoing(outgoing: Map<string, HalfEdge[]>, halfEdge: HalfEdge): void {
  const list = outgoing.get(halfEdge.fromId);
  if (list) {
    list.push(halfEdge);
  } else {
    outgoing.set(halfEdge.fromId, [halfEdge]);
  }
}

function traceFace(
  start: HalfEdge,
  outgoing: ReadonlyMap<string, readonly HalfEdge[]>,
  visited: Set<string>,
): HalfEdge[] | null {
  const cycle: HalfEdge[] = [];
  let current = start;
  const safetyLimit = Math.max(16, [...outgoing.values()].reduce((sum, list) => sum + list.length, 0) + 1);

  for (let step = 0; step < safetyLimit; step += 1) {
    if (visited.has(current.id)) {
      return current.id === start.id ? cycle : null;
    }

    visited.add(current.id);
    cycle.push(current);

    const candidates = outgoing.get(current.toId);
    if (!candidates || candidates.length === 0) return null;

    const twinIndex = candidates.findIndex(
      (candidate) => candidate.edgeId === current.edgeId && candidate.toId === current.fromId,
    );
    if (twinIndex < 0) throw new Error(`Missing twin half-edge for ${current.id}.`);

    // Taking the edge immediately clockwise from the twin keeps the bounded
    // face on the left side of the traversed half-edge.
    current = candidates[(twinIndex - 1 + candidates.length) % candidates.length] ?? start;
  }

  throw new Error("Planar face traversal exceeded its safety limit.");
}

function signedPolygonAreaMm2(vertices: readonly PlanarVertex[]): number {
  let twiceArea = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    if (!current || !next) continue;
    twiceArea += current.xMm * next.yMm - next.xMm * current.yMm;
  }
  return twiceArea / 2;
}

function polygonCentroid(
  vertices: readonly PlanarVertex[],
  signedAreaMm2: number,
): { xMm: number; yMm: number } {
  let xAccumulator = 0;
  let yAccumulator = 0;

  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    if (!current || !next) continue;
    const cross = current.xMm * next.yMm - next.xMm * current.yMm;
    xAccumulator += (current.xMm + next.xMm) * cross;
    yAccumulator += (current.yMm + next.yMm) * cross;
  }

  const divisor = 6 * signedAreaMm2;
  return {
    xMm: xAccumulator / divisor,
    yMm: yAccumulator / divisor,
  };
}

function createFaceKey(vertexIds: readonly string[]): string {
  if (vertexIds.length === 0) throw new Error("Cannot create a face key without vertices.");

  let best = vertexIds.slice();
  for (let offset = 1; offset < vertexIds.length; offset += 1) {
    const rotated = [...vertexIds.slice(offset), ...vertexIds.slice(0, offset)];
    if (compareStringArrays(rotated, best) < 0) best = rotated;
  }

  return `room:${best.join("|")}`;
}

function compareStringArrays(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const comparison = (a[i] ?? "").localeCompare(b[i] ?? "");
    if (comparison !== 0) return comparison;
  }
  return a.length - b.length;
}

function shareVertex(
  first: PlanarEdge,
  second: PlanarEdge,
): boolean {
  return (
    first.startVertexId === second.startVertexId ||
    first.startVertexId === second.endVertexId ||
    first.endVertexId === second.startVertexId ||
    first.endVertexId === second.endVertexId
  );
}

function samePoint(a: PlanarVertex, b: PlanarVertex): boolean {
  return a.xMm === b.xMm && a.yMm === b.yMm;
}

function segmentIntersection(
  a: PlanarVertex,
  b: PlanarVertex,
  c: PlanarVertex,
  d: PlanarVertex,
): { xMm: number; yMm: number } | null {
  const rX = b.xMm - a.xMm;
  const rY = b.yMm - a.yMm;
  const sX = d.xMm - c.xMm;
  const sY = d.yMm - c.yMm;
  const denominator = cross(rX, rY, sX, sY);
  const cax = c.xMm - a.xMm;
  const cay = c.yMm - a.yMm;

  if (denominator === 0) {
    if (cross(cax, cay, rX, rY) !== 0) return null;

    const points = [a, b, c, d];
    for (const point of points) {
      if (pointOnSegment(point, a, b) && pointOnSegment(point, c, d)) {
        return { xMm: point.xMm, yMm: point.yMm };
      }
    }
    return null;
  }

  const t = cross(cax, cay, sX, sY) / denominator;
  const u = cross(cax, cay, rX, rY) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return {
    xMm: a.xMm + t * rX,
    yMm: a.yMm + t * rY,
  };
}

function pointOnSegment(point: PlanarVertex, start: PlanarVertex, end: PlanarVertex): boolean {
  if (cross(point.xMm - start.xMm, point.yMm - start.yMm, end.xMm - start.xMm, end.yMm - start.yMm) !== 0) {
    return false;
  }

  return (
    point.xMm >= Math.min(start.xMm, end.xMm) &&
    point.xMm <= Math.max(start.xMm, end.xMm) &&
    point.yMm >= Math.min(start.yMm, end.yMm) &&
    point.yMm <= Math.max(start.yMm, end.yMm)
  );
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}
