export type BuiltinPrimitiveKind =
  | "box"
  | "cabinet"
  | "table"
  | "sofa"
  | "bed";

export interface AssetDimensionsMm {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export interface AssetDefinition {
  id: string;
  name: string;
  category: "generic";
  source: "builtin";
  primitive: BuiltinPrimitiveKind;
  defaultDimensionsMm: AssetDimensionsMm;
  minimumDimensionsMm: AssetDimensionsMm;
  resizable: boolean;
}

export const BUILTIN_ASSETS = [
  {
    id: "builtin:box",
    name: "Box",
    category: "generic",
    source: "builtin",
    primitive: "box",
    defaultDimensionsMm: { widthMm: 800, depthMm: 600, heightMm: 800 },
    minimumDimensionsMm: { widthMm: 100, depthMm: 100, heightMm: 100 },
    resizable: true,
  },
  {
    id: "builtin:cabinet",
    name: "Cabinet",
    category: "generic",
    source: "builtin",
    primitive: "cabinet",
    defaultDimensionsMm: { widthMm: 1000, depthMm: 600, heightMm: 2200 },
    minimumDimensionsMm: { widthMm: 300, depthMm: 250, heightMm: 400 },
    resizable: true,
  },
  {
    id: "builtin:table",
    name: "Table",
    category: "generic",
    source: "builtin",
    primitive: "table",
    defaultDimensionsMm: { widthMm: 1600, depthMm: 900, heightMm: 760 },
    minimumDimensionsMm: { widthMm: 500, depthMm: 400, heightMm: 400 },
    resizable: true,
  },
  {
    id: "builtin:sofa",
    name: "Sofa",
    category: "generic",
    source: "builtin",
    primitive: "sofa",
    defaultDimensionsMm: { widthMm: 2200, depthMm: 950, heightMm: 850 },
    minimumDimensionsMm: { widthMm: 900, depthMm: 600, heightMm: 500 },
    resizable: true,
  },
  {
    id: "builtin:bed",
    name: "Bed",
    category: "generic",
    source: "builtin",
    primitive: "bed",
    defaultDimensionsMm: { widthMm: 1800, depthMm: 2000, heightMm: 550 },
    minimumDimensionsMm: { widthMm: 700, depthMm: 1200, heightMm: 250 },
    resizable: true,
  },
] as const satisfies readonly AssetDefinition[];

const builtinById = new Map<string, AssetDefinition>(
  BUILTIN_ASSETS.map((asset) => [asset.id, asset]),
);

export function getBuiltinAssetDefinition(assetId: string): AssetDefinition | null {
  return builtinById.get(assetId) ?? null;
}

export function isBuiltinAssetId(assetId: string): boolean {
  return builtinById.has(assetId);
}
