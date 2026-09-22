import type {
  EntityId,
  ParametricCabinetDefinition,
} from "@roomcraft/document";

export const PARAMETRIC_ASSET_PREFIX = "parametric:";

export interface CabinetDimensionsMm {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export type CabinetPartRole =
  | "side"
  | "carcass-horizontal"
  | "back"
  | "shelf"
  | "door"
  | "plinth"
  | "worktop";

export interface CabinetPart {
  id: string;
  role: CabinetPartRole;
  label: string;
  xMm: number;
  yMm: number;
  zMm: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  cutLengthMm: number;
  cutWidthMm: number;
  cutThicknessMm: number;
  materialId: EntityId | null;
}

export interface CabinetCutListItem {
  label: string;
  quantity: number;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  materialId: EntityId | null;
}

export interface CabinetMinimumDimensionsMm {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export const DEFAULT_CABINET_DIMENSIONS: CabinetDimensionsMm = Object.freeze({
  widthMm: 800,
  depthMm: 400,
  heightMm: 2000,
});

export function createDefaultCabinetDefinition(
  id: EntityId,
  name = "Custom cabinet",
): ParametricCabinetDefinition {
  return {
    id,
    kind: "cabinet",
    name,
    panelThicknessMm: 18,
    backThicknessMm: 8,
    shelfThicknessMm: 18,
    shelfCount: 3,
    frontStyle: "double-door",
    frontThicknessMm: 18,
    plinthHeightMm: 100,
    worktopThicknessMm: 0,
    materialId: "material:white",
  };
}

export function parametricAssetId(definitionId: EntityId): string {
  if (!definitionId) throw new Error("Parametric definition id is required.");
  return `${PARAMETRIC_ASSET_PREFIX}${definitionId}`;
}

export function parseParametricAssetId(assetId: string): EntityId | null {
  if (!assetId.startsWith(PARAMETRIC_ASSET_PREFIX)) return null;
  const definitionId = assetId.slice(PARAMETRIC_ASSET_PREFIX.length);
  return definitionId || null;
}

export function cabinetMinimumDimensions(
  definition: ParametricCabinetDefinition,
): CabinetMinimumDimensionsMm {
  const shelfClearanceMm = 60;
  const innerHeightMm =
    definition.shelfCount * definition.shelfThicknessMm +
    (definition.shelfCount + 1) * shelfClearanceMm;

  return {
    widthMm: definition.panelThicknessMm * 2 + 200,
    depthMm: definition.backThicknessMm + 150,
    heightMm:
      definition.plinthHeightMm +
      definition.worktopThicknessMm +
      definition.panelThicknessMm * 2 +
      innerHeightMm,
  };
}

export function deriveCabinetParts(
  definition: ParametricCabinetDefinition,
  dimensions: CabinetDimensionsMm,
): CabinetPart[] {
  validateCabinetBuild(definition, dimensions);

  const parts: CabinetPart[] = [];
  const panel = definition.panelThicknessMm;
  const back = definition.backThicknessMm;
  const shelf = definition.shelfThicknessMm;
  const worktop = definition.worktopThicknessMm;
  const plinth = definition.plinthHeightMm;

  const bodyBottomMm = plinth;
  const bodyTopMm = dimensions.heightMm - worktop;
  const bodyHeightMm = bodyTopMm - bodyBottomMm;
  const usableDepthMm = dimensions.depthMm - back;
  const innerWidthMm = dimensions.widthMm - panel * 2;
  const innerBottomMm = bodyBottomMm + panel;
  const innerTopMm = bodyTopMm - panel;
  const innerHeightMm = innerTopMm - innerBottomMm;

  const push = (
    role: CabinetPartRole,
    label: string,
    id: string,
    widthMm: number,
    heightMm: number,
    depthMm: number,
    xMm: number,
    yMm: number,
    zMm: number,
    cutLengthMm: number,
    cutWidthMm: number,
    cutThicknessMm: number,
  ) => {
    parts.push({
      id,
      role,
      label,
      widthMm,
      heightMm,
      depthMm,
      xMm,
      yMm,
      zMm,
      cutLengthMm,
      cutWidthMm,
      cutThicknessMm,
      materialId: definition.materialId,
    });
  };

  const bodyCenterYmm = bodyBottomMm + bodyHeightMm / 2;
  const bodyCenterZmm = -back / 2;

  push(
    "side",
    "Side",
    "side-left",
    panel,
    bodyHeightMm,
    usableDepthMm,
    -dimensions.widthMm / 2 + panel / 2,
    bodyCenterYmm,
    bodyCenterZmm,
    bodyHeightMm,
    usableDepthMm,
    panel,
  );
  push(
    "side",
    "Side",
    "side-right",
    panel,
    bodyHeightMm,
    usableDepthMm,
    dimensions.widthMm / 2 - panel / 2,
    bodyCenterYmm,
    bodyCenterZmm,
    bodyHeightMm,
    usableDepthMm,
    panel,
  );

  for (const [id, yMm] of [
    ["bottom", bodyBottomMm + panel / 2],
    ["top", bodyTopMm - panel / 2],
  ] as const) {
    push(
      "carcass-horizontal",
      "Carcass horizontal",
      id,
      innerWidthMm,
      panel,
      usableDepthMm,
      0,
      yMm,
      bodyCenterZmm,
      innerWidthMm,
      usableDepthMm,
      panel,
    );
  }

  push(
    "back",
    "Back",
    "back",
    innerWidthMm,
    innerHeightMm,
    back,
    0,
    innerBottomMm + innerHeightMm / 2,
    dimensions.depthMm / 2 - back / 2,
    innerWidthMm,
    innerHeightMm,
    back,
  );

  if (definition.shelfCount > 0) {
    const availableForGapsMm =
      innerHeightMm - definition.shelfCount * shelf;
    const gapMm = availableForGapsMm / (definition.shelfCount + 1);
    let cursorYmm = innerBottomMm + gapMm;

    for (let index = 0; index < definition.shelfCount; index += 1) {
      const centerYmm = cursorYmm + shelf / 2;
      push(
        "shelf",
        "Shelf",
        `shelf-${index + 1}`,
        innerWidthMm,
        shelf,
        usableDepthMm,
        0,
        centerYmm,
        bodyCenterZmm,
        innerWidthMm,
        usableDepthMm,
        shelf,
      );
      cursorYmm += shelf + gapMm;
    }
  }

  if (definition.frontStyle !== "open") {
    const doorHeightMm = Math.max(1, bodyHeightMm - 4);
    const doorCenterYmm = bodyBottomMm + bodyHeightMm / 2;
    const doorZmm =
      -dimensions.depthMm / 2 - definition.frontThicknessMm / 2;

    if (definition.frontStyle === "single-door") {
      const doorWidthMm = Math.max(1, dimensions.widthMm - 4);
      push(
        "door",
        "Door",
        "door-1",
        doorWidthMm,
        doorHeightMm,
        definition.frontThicknessMm,
        0,
        doorCenterYmm,
        doorZmm,
        doorWidthMm,
        doorHeightMm,
        definition.frontThicknessMm,
      );
    } else {
      const availableWidthMm = Math.max(2, dimensions.widthMm - 6);
      const leftWidthMm = Math.floor(availableWidthMm / 2);
      const rightWidthMm = availableWidthMm - leftWidthMm;
      const leftCenterXmm = -dimensions.widthMm / 2 + 2 + leftWidthMm / 2;
      const rightCenterXmm =
        dimensions.widthMm / 2 - 2 - rightWidthMm / 2;

      push(
        "door",
        "Door",
        "door-left",
        leftWidthMm,
        doorHeightMm,
        definition.frontThicknessMm,
        leftCenterXmm,
        doorCenterYmm,
        doorZmm,
        leftWidthMm,
        doorHeightMm,
        definition.frontThicknessMm,
      );
      push(
        "door",
        "Door",
        "door-right",
        rightWidthMm,
        doorHeightMm,
        definition.frontThicknessMm,
        rightCenterXmm,
        doorCenterYmm,
        doorZmm,
        rightWidthMm,
        doorHeightMm,
        definition.frontThicknessMm,
      );
    }
  }

  if (plinth > 0) {
    const plinthWidthMm = Math.max(panel, dimensions.widthMm - 100);
    push(
      "plinth",
      "Plinth",
      "plinth",
      plinthWidthMm,
      plinth,
      panel,
      0,
      plinth / 2,
      -dimensions.depthMm / 2 + 80 + panel / 2,
      plinthWidthMm,
      plinth,
      panel,
    );
  }

  if (worktop > 0) {
    push(
      "worktop",
      "Worktop",
      "worktop",
      dimensions.widthMm,
      worktop,
      dimensions.depthMm,
      0,
      dimensions.heightMm - worktop / 2,
      0,
      dimensions.widthMm,
      dimensions.depthMm,
      worktop,
    );
  }

  return parts;
}

export function deriveCabinetCutList(
  definition: ParametricCabinetDefinition,
  dimensions: CabinetDimensionsMm,
): CabinetCutListItem[] {
  const groups = new Map<string, CabinetCutListItem>();

  for (const part of deriveCabinetParts(definition, dimensions)) {
    const key = [
      part.label,
      part.cutLengthMm,
      part.cutWidthMm,
      part.cutThicknessMm,
      part.materialId ?? "",
    ].join("|");
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }

    groups.set(key, {
      label: part.label,
      quantity: 1,
      lengthMm: part.cutLengthMm,
      widthMm: part.cutWidthMm,
      thicknessMm: part.cutThicknessMm,
      materialId: part.materialId,
    });
  }

  return [...groups.values()];
}

export function validateCabinetBuild(
  definition: ParametricCabinetDefinition,
  dimensions: CabinetDimensionsMm,
): void {
  for (const [field, value] of Object.entries(dimensions)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${field} must be positive and finite.`);
    }
  }

  const minimum = cabinetMinimumDimensions(definition);
  if (dimensions.widthMm < minimum.widthMm) {
    throw new Error(
      `Cabinet width must be at least ${minimum.widthMm} mm for this construction.`,
    );
  }
  if (dimensions.depthMm < minimum.depthMm) {
    throw new Error(
      `Cabinet depth must be at least ${minimum.depthMm} mm for this construction.`,
    );
  }
  if (dimensions.heightMm < minimum.heightMm) {
    throw new Error(
      `Cabinet height must be at least ${minimum.heightMm} mm for this construction.`,
    );
  }
}
