export const CURRENT_SCHEMA_VERSION = 4 as const;

export type EntityId = string;
export type Millimetres = number;

export interface ProjectDocument {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  id: EntityId;
  name: string;
  settings: ProjectSettings;
  levels: Level[];
}

export interface ProjectSettings {
  unitSystem: "metric";
  gridSizeMm: Millimetres;
  angleSnapDeg: number;
}

export interface Level {
  id: EntityId;
  name: string;
  elevationMm: Millimetres;
  defaultWallHeightMm: Millimetres;
  floorThicknessMm: Millimetres;
  vertices: Vertex[];
  walls: Wall[];
  openings: Opening[];
  objects: ObjectInstance[];
  blueprints: BlueprintReference[];
}

export interface Vertex {
  id: EntityId;
  xMm: Millimetres;
  yMm: Millimetres;
}

export interface Wall {
  id: EntityId;
  startVertexId: EntityId;
  endVertexId: EntityId;
  thicknessMm: Millimetres;
  heightMm: Millimetres | null;
}

export type OpeningType = "door" | "window" | "passage";

export interface Opening {
  id: EntityId;
  wallId: EntityId;
  type: OpeningType;
  offsetMm: Millimetres;
  widthMm: Millimetres;
  heightMm: Millimetres;
  sillHeightMm: Millimetres;
  flip: boolean;
  swing: "left" | "right" | "none";
  catalogAssetId?: EntityId;
}

/**
 * A placed catalog asset.
 *
 * xMm/yMm are the centre of the footprint in plan coordinates.
 * zMm is the object's bottom edge relative to the level elevation.
 */
export interface ObjectInstance {
  id: EntityId;
  assetId: EntityId;
  xMm: Millimetres;
  yMm: Millimetres;
  zMm: Millimetres;
  rotationDeg: number;
  widthMm: Millimetres;
  depthMm: Millimetres;
  heightMm: Millimetres;
  locked: boolean;
}

export interface BlueprintCrop {
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
}

export interface BlueprintReference {
  id: EntityId;
  assetId: EntityId;
  sourceWidthPx: number;
  sourceHeightPx: number;
  crop: BlueprintCrop;
  originXmm: Millimetres;
  originYmm: Millimetres;
  millimetresPerPixel: number;
  rotationDeg: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
}

export function createEmptyProject(id: EntityId, name = "Untitled project"): ProjectDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    name,
    settings: {
      unitSystem: "metric",
      gridSizeMm: 100,
      angleSnapDeg: 15,
    },
    levels: [
      {
        id: "level_ground",
        name: "Ground floor",
        elevationMm: 0,
        defaultWallHeightMm: 2500,
        floorThicknessMm: 200,
        vertices: [],
        walls: [],
        openings: [],
        objects: [],
        blueprints: [],
      },
    ],
  };
}
