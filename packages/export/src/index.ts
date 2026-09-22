import {
  parseProjectDocument,
  validateProjectDocument,
  type EntityId,
  type ProjectDocument,
} from "@roomcraft/document";
import { projectLevel2D } from "@roomcraft/render-2d";

export interface SvgFloorPlanOptions {
  paddingMm?: number;
  includeFurniture?: boolean;
  includeRoomLabels?: boolean;
}

export function serializeRoomCraftDocument(document: ProjectDocument): string {
  validateProjectDocument(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseRoomCraftDocumentFile(source: string): ProjectDocument {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("RoomCraft file is not valid JSON.");
  }
  return parseProjectDocument(value);
}

export function roomCraftFileName(document: ProjectDocument): string {
  return `${safeFileStem(document.name || "roomcraft-project")}.roomcraft`;
}

export function svgFloorPlanFileName(
  document: ProjectDocument,
  levelId: EntityId,
): string {
  const level = document.levels.find((candidate) => candidate.id === levelId);
  const levelName = level?.name || "level";
  return `${safeFileStem(document.name)}-${safeFileStem(levelName)}.svg`;
}

export function exportLevelSvg(
  document: ProjectDocument,
  levelId: EntityId,
  options: SvgFloorPlanOptions = {},
): string {
  validateProjectDocument(document);
  const projection = projectLevel2D(document, levelId);
  const level = document.levels.find((candidate) => candidate.id === levelId);
  if (!level) throw new Error(`Level ${levelId} does not exist.`);

  const paddingMm = options.paddingMm ?? 500;
  if (!Number.isFinite(paddingMm) || paddingMm < 0) {
    throw new Error("SVG padding must be a non-negative finite number.");
  }

  const includeFurniture = options.includeFurniture ?? true;
  const includeRoomLabels = options.includeRoomLabels ?? true;
  const bounds = projectionBounds(projection, includeFurniture);
  const x = bounds.minXmm - paddingMm;
  const y = bounds.minYmm - paddingMm;
  const width = Math.max(1000, bounds.maxXmm - bounds.minXmm + paddingMm * 2);
  const height = Math.max(1000, bounds.maxYmm - bounds.minYmm + paddingMm * 2);

  const roomSvg = projection.rooms
    .map((room) => {
      const points = room.points
        .map((point) => `${round(point.xMm)},${round(point.yMm)}`)
        .join(" ");
      const fill = room.floorColorHex ?? "#f4f2ee";
      const label = includeRoomLabels
        ? `<text x="${round(room.centerXmm)}" y="${round(room.centerYmm)}" class="room-label">${escapeXml(formatArea(room.areaMm2))} m²</text>`
        : "";
      return `<g data-room-key="${escapeXml(room.key)}"><polygon points="${points}" fill="${fill}" class="room"/>${label}</g>`;
    })
    .join("");

  const wallSvg = projection.walls
    .map(
      (wall) =>
        `<line data-wall-id="${escapeXml(wall.id)}" x1="${round(wall.x1Mm)}" y1="${round(wall.y1Mm)}" x2="${round(wall.x2Mm)}" y2="${round(wall.y2Mm)}" stroke-width="${round(wall.thicknessMm)}" class="wall"/>`,
    )
    .join("");

  const openingSvg = projection.openings
    .map(
      (opening) =>
        `<line data-opening-id="${escapeXml(opening.id)}" x1="${round(opening.x1Mm)}" y1="${round(opening.y1Mm)}" x2="${round(opening.x2Mm)}" y2="${round(opening.y2Mm)}" stroke-width="${round(opening.wallThicknessMm + 30)}" class="opening"/>`,
    )
    .join("");

  const objectSvg = includeFurniture
    ? projection.objects
        .map((object) => {
          const xMm = -object.widthMm / 2;
          const yMm = -object.depthMm / 2;
          return `<g data-object-id="${escapeXml(object.id)}" transform="translate(${round(object.centerXmm)} ${round(object.centerYmm)}) rotate(${round(object.rotationDeg)})"><rect x="${round(xMm)}" y="${round(yMm)}" width="${round(object.widthMm)}" height="${round(object.depthMm)}" class="object"/><line x1="${round(xMm)}" y1="${round(yMm)}" x2="${round(xMm + object.widthMm)}" y2="${round(yMm)}" class="object-front"/></g>`;
        })
        .join("")
    : "";

  const metadata = escapeXml(
    JSON.stringify({
      generator: "RoomCraft",
      schemaVersion: document.schemaVersion,
      projectId: document.id,
      levelId,
      units: "millimetres",
    }),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(x)} ${round(y)} ${round(width)} ${round(height)}" role="img" aria-label="${escapeXml(`${document.name} — ${level.name}`)}">
  <metadata>${metadata}</metadata>
  <style>
    .room { stroke: none; }
    .room-label { fill: #555; font: 700 180px system-ui, sans-serif; text-anchor: middle; dominant-baseline: middle; }
    .wall { stroke: #252525; stroke-linecap: square; }
    .opening { stroke: #fff; stroke-linecap: butt; }
    .object { fill: #f7f6f3; stroke: #777; stroke-width: 12; }
    .object-front { stroke: #252525; stroke-width: 18; stroke-linecap: round; }
  </style>
  <g id="rooms">${roomSvg}</g>
  <g id="walls">${wallSvg}</g>
  <g id="openings">${openingSvg}</g>
  <g id="objects">${objectSvg}</g>
</svg>
`;
}

function projectionBounds(
  projection: ReturnType<typeof projectLevel2D>,
  includeFurniture: boolean,
) {
  let minXmm = Number.POSITIVE_INFINITY;
  let minYmm = Number.POSITIVE_INFINITY;
  let maxXmm = Number.NEGATIVE_INFINITY;
  let maxYmm = Number.NEGATIVE_INFINITY;

  const includePoint = (xMm: number, yMm: number) => {
    minXmm = Math.min(minXmm, xMm);
    minYmm = Math.min(minYmm, yMm);
    maxXmm = Math.max(maxXmm, xMm);
    maxYmm = Math.max(maxYmm, yMm);
  };

  for (const wall of projection.walls) {
    const margin = wall.thicknessMm / 2;
    includePoint(wall.x1Mm - margin, wall.y1Mm - margin);
    includePoint(wall.x1Mm + margin, wall.y1Mm + margin);
    includePoint(wall.x2Mm - margin, wall.y2Mm - margin);
    includePoint(wall.x2Mm + margin, wall.y2Mm + margin);
  }

  for (const room of projection.rooms) {
    for (const point of room.points) includePoint(point.xMm, point.yMm);
  }

  if (includeFurniture) {
    for (const object of projection.objects) {
      for (const point of rotatedRectangleCorners(
        object.centerXmm,
        object.centerYmm,
        object.widthMm,
        object.depthMm,
        object.rotationDeg,
      )) {
        includePoint(point.xMm, point.yMm);
      }
    }
  }

  if (!Number.isFinite(minXmm)) {
    return { minXmm: -500, minYmm: -500, maxXmm: 500, maxYmm: 500 };
  }

  return { minXmm, minYmm, maxXmm, maxYmm };
}

function rotatedRectangleCorners(
  centerXmm: number,
  centerYmm: number,
  widthMm: number,
  depthMm: number,
  rotationDeg: number,
) {
  const radians = (rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const halfWidth = widthMm / 2;
  const halfDepth = depthMm / 2;

  return [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ].map(([x, y]) => ({
    xMm: centerXmm + (x ?? 0) * cosine - (y ?? 0) * sine,
    yMm: centerYmm + (x ?? 0) * sine + (y ?? 0) * cosine,
  }));
}

function formatArea(areaMm2: number): string {
  return (areaMm2 / 1_000_000).toFixed(areaMm2 < 10_000_000 ? 2 : 1);
}

function safeFileStem(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[ .]+$/g, "")
    .slice(0, 96);
  return normalized || "roomcraft-project";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function round(value: number): string {
  return Number(value.toFixed(3)).toString();
}
