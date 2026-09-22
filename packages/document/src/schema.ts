export const CURRENT_SCHEMA_VERSION = 5 as const;

export type EntityId = string;
export type Millimetres = number;

export interface ProjectDocument {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  id: EntityId;
  name: string;
  materials: MaterialDefinition[];
  settings: ProjectSettings;
  levels: Level[];
}

export interface ProjectSettings {
  unitSystem: "metric";
  gridSizeMm: Millimetres;
  angleSnapDeg: number;
}

export interface MaterialDefinition {
  id: EntityId;
  name: string;
  baseColorHex: string;
  roughness: number;
  metalness: number;
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
  roomFinishes: RoomSurfaceFinish[];
}

export interface RoomSurfaceFinish {
  roomKey: string;
  floorMaterialId: EntityId | null;
  ceilingMaterialId: EntityId | null;
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
  leftMaterialId?: EntityId | null;
  rightMaterialId?: EntityId | null;
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

export const DEFAULT_MATERIALS = [
  {
    id: "material:white",
    name: "Warm white",
    baseColorHex: "#F2F0EB",
    roughness: 0.9,
    metalness: 0,
  },
  {
    id: "material:beige",
    name: "Warm beige",
    baseColorHex: "#D8CBB8",
    roughness: 0.9,
    metalness: 0,
  },
  {
    id: "material:oak",
    name: "Oak",
    baseColorHex: "#B8895B",
    roughness: 0.75,
    metalness: 0,
  },
  {
    id: "material:concrete",
    name: "Concrete",
    baseColorHex: "#A7A5A0",
    roughness: 0.95,
    metalness: 0,
  },
] as const satisfies readonly MaterialDefinition[];

export function createDefaultMaterials(): MaterialDefinition[] {
  return DEFAULT_MATERIALS.map((material) => ({ ...material }));
}

export function createEmptyProject(id: EntityId, name = "Untitled project"): ProjectDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    name,
    materials: createDefaultMaterials(),
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
        roomFinishes: [],
      },
    ],
  };
}
