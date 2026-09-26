import {
  BUILTIN_ASSETS,
  catalogVersionAssetId,
  getBuiltinAssetDefinition,
  parseCatalogVersionAssetId,
} from "@roomcraft/catalog";
import {
  createEmptyProject,
  type BlueprintReference,
  type ObjectInstance,
  type Opening,
  type ParametricCabinetDefinition,
  type ProjectDocument,
} from "@roomcraft/document";
import {
  AddBlueprintCommand,
  AddLevelCommand,
  AddObjectCommand,
  AddOpeningCommand,
  AddParametricAssetCommand,
  BatchCommand,
  CalibrateBlueprintCommand,
  EMPTY_SELECTION,
  MoveBlueprintLayerCommand,
  MoveVertexCommand,
  MoveWallCommand,
  RemoveBlueprintCommand,
  RemoveLevelCommand,
  RemoveObjectCommand,
  SetRoomSurfaceMaterialsCommand,
  SetWallLengthCommand,
  SetWallMaterialsCommand,
  InsertWallWithTopologyCommand,
  RemoveWallByIdCommand,
  SetWallAngleCommand,
  SetWallThicknessCommand,
  UpdateBlueprintCommand,
  UpdateLevelCommand,
  UpdateObjectCommand,
  UpdateParametricAssetCommand,
  DEFAULT_PLAN_CAMERA,
  duplicateLevelShell,
  fitPlanCamera,
  panPlanCamera,
  planViewBox,
  isSelected,
  selectMany,
  selectOnly,
  selectionIds,
  toggleSelection,
  snapObjectPosition,
  snapOpeningToWall,
  zoomPlanCameraAt,
  snapPlanPoint,
  type EditorCommand,
  type EditorSelection,
  type SelectionTarget,
  type OpeningWallPlacement,
  type PlanCamera2D,
  type PlanSnapResult,
  type ViewportSizePx,
} from "@roomcraft/editor-core";
import {
  exportLevelSvg,
  exportProjectGlb,
  glbProjectFileName,
  parseRoomCraftDocumentFile,
  rasterFloorPlanFileName,
  roomCraftFileName,
  serializeRoomCraftDocument,
  svgFloorPlanFileName,
} from "@roomcraft/export";
import {
  rasterizeSvgFloorPlan,
  type RasterFloorPlanFormat,
} from "@roomcraft/export/browser";
import {
  DEFAULT_CABINET_DIMENSIONS,
  cabinetMinimumDimensions,
  createDefaultCabinetDefinition,
  deriveCabinetCutList,
  parametricAssetId,
  parseParametricAssetId,
} from "@roomcraft/parametric";
import { projectLevel2D } from "@roomcraft/render-2d";
import {
  inspectGlbFile,
  RoomSceneRenderer,
  type RoomSceneHit,
  type RoomSceneLevelScope,
  type RuntimeModelAsset,
} from "@roomcraft/render-3d";
import {
  Button,
  Icon,
  IconButton,
  LayerList,
  Menu,
  LengthField,
  NumberField,
  Panel,
  SegmentedControl,
  SelectField,
  Sheet,
  TextField,
  Toolbar,
} from "@roomcraft/ui";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  assetContentUrl,
  readImageDimensions,
  uploadBlueprintAsset,
  uploadModelAsset,
} from "./assets-api";
import {
  ensureCatalogItem,
  getCatalogItem,
  searchCatalogItems,
  type CatalogItemSummaryDto,
  type CatalogVersionDto,
} from "./catalog-api";
import { createEntityId } from "./random-id";
import { useProjectSession, type SaveState } from "./use-project-session";

type ViewMode = "2d" | "3d";
type GhostMode = "off" | "below" | "above";
type EditorTool =
  | "select"
  | "wall"
  | "door"
  | "window"
  | "furniture"
  | "blueprint-calibrate";
type PlanPoint = PlanSnapResult["point"];

interface WallDraft {
  start: PlanSnapResult;
}

interface BlueprintCalibrationDraft {
  blueprintId: string;
  firstPoint: PlanPoint | null;
  secondPoint: PlanPoint | null;
}

interface FurnitureDefinition {
  id: string;
  name: string;
  source: "builtin" | "catalog" | "parametric";
  category: string;
  manufacturer: string | null;
  sku: string | null;
  productUrl: string | null;
  thumbnailAssetId: string | null;
  modelAssetId: string | null;
  defaultDimensionsMm: {
    widthMm: number;
    depthMm: number;
    heightMm: number;
  };
  minimumDimensionsMm: {
    widthMm: number;
    depthMm: number;
    heightMm: number;
  };
  resizable: boolean;
}

const BUILTIN_FURNITURE: readonly FurnitureDefinition[] = BUILTIN_ASSETS.map(
  (asset) => ({
    id: asset.id,
    name: asset.name,
    source: "builtin",
    category: asset.category,
    manufacturer: null,
    sku: null,
    productUrl: null,
    thumbnailAssetId: null,
    modelAssetId: null,
    defaultDimensionsMm: asset.defaultDimensionsMm,
    minimumDimensionsMm: asset.minimumDimensionsMm,
    resizable: asset.resizable,
  }),
);

const VIEW_OPTIONS = [
  { value: "2d", label: "2D" },
  { value: "3d", label: "3D" },
] as const;

const THREE_LEVEL_OPTIONS = [
  { value: "active", label: "Active level" },
  { value: "all", label: "All levels" },
] as const;

const OPENING_PRESETS = {
  door: { widthMm: 900, heightMm: 2100, sillHeightMm: 0 } as const,
  window: { widthMm: 1200, heightMm: 1200, sillHeightMm: 900 } as const,
};

const CURRENT_PROJECT_KEY = "roomcraft.currentProjectId";

function catalogFurnitureDefinition(
  item: CatalogItemSummaryDto,
  version: CatalogVersionDto = item.version,
): FurnitureDefinition {
  const dimensions = {
    widthMm: version.widthMm,
    depthMm: version.depthMm,
    heightMm: version.heightMm,
  };

  return {
    id: catalogVersionAssetId(item.id, version.version),
    name: item.name,
    source: "catalog",
    category: item.category,
    manufacturer: item.manufacturer,
    sku: item.sku,
    productUrl: item.productUrl,
    thumbnailAssetId: version.thumbnailAssetId,
    modelAssetId: version.assetId,
    defaultDimensionsMm: dimensions,
    minimumDimensionsMm: dimensions,
    resizable: false,
  };
}

function parametricFurnitureDefinition(
  definition: ParametricCabinetDefinition,
): FurnitureDefinition {
  return {
    id: parametricAssetId(definition.id),
    name: definition.name,
    source: "parametric",
    category: "custom cabinet",
    manufacturer: null,
    sku: null,
    productUrl: null,
    thumbnailAssetId: null,
    modelAssetId: null,
    defaultDimensionsMm: DEFAULT_CABINET_DIMENSIONS,
    minimumDimensionsMm: cabinetMinimumDimensions(definition),
    resizable: true,
  };
}

export interface EditorAppProps {
  projectId: string;
  onExit(): void;
}

export function EditorApp({ projectId, onExit }: EditorAppProps) {
  const session = useProjectSession(() =>
    createEmptyProject(projectId, "My apartment"),
  );
  const { document, revision, saveState, saveError } = session;

  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [threeLevelScope, setThreeLevelScope] =
    useState<RoomSceneLevelScope>("active");
  const [showCeilings, setShowCeilings] = useState(false);
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);
  const [ghostMode, setGhostMode] = useState<GhostMode>("off");
  const [activeTool, setActiveTool] = useState<EditorTool>("select");
  const [mobilePropertiesOpen, setMobilePropertiesOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 820px)");
  const [activeFurnitureAssetId, setActiveFurnitureAssetId] =
    useState<string>("builtin:box");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<FurnitureDefinition[]>([]);
  const [catalogDefinitions, setCatalogDefinitions] = useState<
    Record<string, FurnitureDefinition>
  >({});
  const [catalogSearchState, setCatalogSearchState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [catalogSearchError, setCatalogSearchError] = useState<string | null>(null);
  const [catalogResultTotal, setCatalogResultTotal] = useState(0);
  const catalogRequestRef = useRef(0);
  const catalogLoadingRef = useRef(new Set<string>());
  const [selection, setSelection] = useState<EditorSelection>(EMPTY_SELECTION);
  const [hoveredTarget, setHoveredTarget] = useState<SelectionTarget | null>(null);
  const blueprintFileRef = useRef<HTMLInputElement | null>(null);
  const modelFileRef = useRef<HTMLInputElement | null>(null);
  const projectImportRef = useRef<HTMLInputElement | null>(null);
  const [modelImportState, setModelImportState] = useState<"idle" | "importing">("idle");
  const [modelImportError, setModelImportError] = useState<string | null>(null);
  const [parametricEditError, setParametricEditError] = useState<string | null>(null);
  const [projectFileError, setProjectFileError] = useState<string | null>(null);
  const [glbExportState, setGlbExportState] = useState<"idle" | "exporting">("idle");
  const [glbExportError, setGlbExportError] = useState<string | null>(null);
  const [rasterExportState, setRasterExportState] = useState<"idle" | "exporting">("idle");
  const [rasterExportError, setRasterExportError] = useState<string | null>(null);
  const [blueprintImportState, setBlueprintImportState] = useState<"idle" | "uploading">("idle");
  const [blueprintImportError, setBlueprintImportError] = useState<string | null>(null);
  const [calibrationDraft, setCalibrationDraft] = useState<BlueprintCalibrationDraft | null>(null);
  const [wallDraft, setWallDraft] = useState<WallDraft | null>(null);
  const [wallEditAnchor, setWallEditAnchor] = useState<"start" | "end">("start");
  const [hoverSnap, setHoverSnap] = useState<PlanSnapResult | null>(null);
  const [openingHover, setOpeningHover] = useState<OpeningWallPlacement | null>(null);

  useEffect(() => {
    if (selection.primary) setMobilePropertiesOpen(true);
  }, [selection.primary]);

  useEffect(() => {
    const usedCatalogAssets = new Set(
      document.levels
        .flatMap((candidate) => candidate.objects)
        .map((object) => object.assetId)
        .filter((assetId) => parseCatalogVersionAssetId(assetId) !== null),
    );

    for (const assetId of usedCatalogAssets) {
      if (!catalogDefinitions[assetId]) void loadCatalogDefinition(assetId);
    }
  }, [document, catalogDefinitions]);

  const runtimeModelAssets = useMemo<RuntimeModelAsset[]>(
    () =>
      Object.values(catalogDefinitions)
        .filter(
          (definition): definition is FurnitureDefinition & { modelAssetId: string } =>
            definition.modelAssetId !== null,
        )
        .map((definition) => ({
          objectAssetId: definition.id,
          contentUrl: assetContentUrl(definition.modelAssetId),
        })),
    [catalogDefinitions],
  );

  if (saveState === "loading") {
    return (
      <main className="fatal-state" aria-live="polite">
        <strong>Loading project</strong>
        <span>Opening the latest saved revision.</span>
      </main>
    );
  }

  const level =
    document.levels.find((candidate) => candidate.id === activeLevelId) ??
    document.levels[0];
  if (!level) {
    return (
      <main className="fatal-state" role="alert">
        <strong>Project cannot be opened</strong>
        <span>The project document does not contain a level.</span>
      </main>
    );
  }

  const levelId = level.id;
  const projection = projectLevel2D(document, levelId);
  const levelsByElevation = [...document.levels].sort(
    (a, b) => a.elevationMm - b.elevationMm || a.id.localeCompare(b.id),
  );
  const elevationIndex = levelsByElevation.findIndex(
    (candidate) => candidate.id === levelId,
  );
  const belowLevel =
    elevationIndex > 0 ? levelsByElevation[elevationIndex - 1] ?? null : null;
  const aboveLevel =
    elevationIndex >= 0 && elevationIndex < levelsByElevation.length - 1
      ? levelsByElevation[elevationIndex + 1] ?? null
      : null;
  const ghostLevel =
    ghostMode === "below"
      ? belowLevel
      : ghostMode === "above"
        ? aboveLevel
        : null;
  const ghostProjection = ghostLevel
    ? projectLevel2D(document, ghostLevel.id)
    : null;
  const effectiveGhostMode: GhostMode = ghostProjection ? ghostMode : "off";
  const ghostOptions = [
    { value: "off" as const, label: "Ghost off" },
    ...(belowLevel ? [{ value: "below" as const, label: "Below" }] : []),
    ...(aboveLevel ? [{ value: "above" as const, label: "Above" }] : []),
  ];
  const selectedWallId =
    selection.primary?.kind === "wall" &&
    projection.walls.some((wall) => wall.id === selection.primary?.id)
      ? selection.primary.id
      : null;
  const selectedWall =
    selectedWallId === null
      ? null
      : projection.walls.find((wall) => wall.id === selectedWallId) ?? null;
  const selectedWallRecord =
    selectedWallId === null
      ? null
      : level.walls.find((wall) => wall.id === selectedWallId) ?? null;
  const selectedWallAngleDeg = selectedWall
    ? normalizeDegrees(
        (Math.atan2(
          selectedWall.y2Mm - selectedWall.y1Mm,
          selectedWall.x2Mm - selectedWall.x1Mm,
        ) *
          180) /
          Math.PI,
      )
    : null;
  const selectedRoomKey =
    selection.primary?.kind === "room" &&
    projection.rooms.some((room) => room.key === selection.primary?.id)
      ? selection.primary.id
      : null;
  const selectedRoom =
    selectedRoomKey === null
      ? null
      : projection.rooms.find((room) => room.key === selectedRoomKey) ?? null;
  const materialOptions = [
    { value: "", label: "Default" },
    ...document.materials.map((material) => ({
      value: material.id,
      label: material.name,
    })),
  ];
  const selectedBlueprintId =
    selection.primary?.kind === "blueprint" &&
    level.blueprints.some((blueprint) => blueprint.id === selection.primary?.id)
      ? selection.primary.id
      : null;
  const selectedBlueprint =
    selectedBlueprintId === null
      ? null
      : level.blueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? null;
  const selectedObjectId =
    selection.primary?.kind === "object" &&
    level.objects.some((object) => object.id === selection.primary?.id)
      ? selection.primary.id
      : null;
  const selectedObject =
    selectedObjectId === null
      ? null
      : level.objects.find((object) => object.id === selectedObjectId) ?? null;
  const selectedObjectDefinition = selectedObject
    ? resolveFurnitureDefinition(selectedObject.assetId)
    : null;
  const selectedParametricDefinitionId = selectedObject
    ? parseParametricAssetId(selectedObject.assetId)
    : null;
  const selectedParametricDefinition = selectedParametricDefinitionId
    ? document.parametricAssets.find(
        (definition) => definition.id === selectedParametricDefinitionId,
      ) ?? null
    : null;
  const selectedCabinetCutList =
    selectedObject && selectedParametricDefinition
      ? deriveCabinetCutList(selectedParametricDefinition, {
          widthMm: selectedObject.widthMm,
          depthMm: selectedObject.depthMm,
          heightMm: selectedObject.heightMm,
        })
      : [];
  const activeFurnitureDefinition =
    resolveFurnitureDefinition(activeFurnitureAssetId) ??
    BUILTIN_FURNITURE[0] ??
    null;
  const selectedObjectIsCatalog =
    selectedObject !== null &&
    parseCatalogVersionAssetId(selectedObject.assetId) !== null;
  const selectedObjectDimensionsLocked =
    selectedObject?.locked === true ||
    selectedObjectIsCatalog ||
    selectedObjectDefinition?.resizable === false;
  const objectAssetLabels: Readonly<Record<string, string>> = Object.fromEntries([
    ...BUILTIN_FURNITURE.map(
      (definition) => [definition.id, definition.name] as const,
    ),
    ...Object.values(catalogDefinitions).map(
      (definition) => [definition.id, definition.name] as const,
    ),
    ...document.parametricAssets.map(
      (definition) =>
        [parametricAssetId(definition.id), definition.name] as const,
    ),
  ]);
  const duplicableSelectionCount = selection.items.filter(
    (target) => target.kind === "object" || target.kind === "blueprint",
  ).length;
  const deletableSelectionCount = selection.items.filter(
    (target) =>
      target.kind === "wall" ||
      target.kind === "object" ||
      target.kind === "blueprint",
  ).length;

  function resolveFurnitureDefinition(
    assetId: string,
  ): FurnitureDefinition | null {
    const builtin = getBuiltinAssetDefinition(assetId);
    if (builtin) {
      return (
        BUILTIN_FURNITURE.find((candidate) => candidate.id === builtin.id) ??
        null
      );
    }

    const parametricDefinitionId = parseParametricAssetId(assetId);
    if (parametricDefinitionId) {
      const definition = document.parametricAssets.find(
        (candidate) => candidate.id === parametricDefinitionId,
      );
      return definition ? parametricFurnitureDefinition(definition) : null;
    }

    return catalogDefinitions[assetId] ?? null;
  }

  async function runCatalogSearch(query = catalogQuery) {
    const requestId = ++catalogRequestRef.current;
    setCatalogSearchState("loading");
    setCatalogSearchError(null);

    try {
      const response = await searchCatalogItems({
        query,
        limit: 24,
      });
      if (requestId !== catalogRequestRef.current) return;

      const definitions = response.items.map((item) =>
        catalogFurnitureDefinition(item),
      );
      setCatalogResults(definitions);
      setCatalogResultTotal(response.total);
      setCatalogDefinitions((current) => {
        const next = { ...current };
        for (const definition of definitions) next[definition.id] = definition;
        return next;
      });
      setCatalogSearchState("ready");
    } catch (error) {
      if (requestId !== catalogRequestRef.current) return;
      setCatalogSearchState("error");
      setCatalogSearchError(
        error instanceof Error ? error.message : "Catalog search failed.",
      );
    }
  }

  async function resolveCatalogDefinition(
    assetId: string,
  ): Promise<FurnitureDefinition | null> {
    const cached = catalogDefinitions[assetId];
    if (cached) return cached;

    const reference = parseCatalogVersionAssetId(assetId);
    if (!reference) return null;

    const item = await getCatalogItem(reference.itemId);
    const version = item.versions.find(
      (candidate) => candidate.version === reference.version,
    );
    if (!version) {
      throw new Error(
        `Catalog version ${reference.itemId}@${reference.version} no longer exists.`,
      );
    }

    const definition = catalogFurnitureDefinition(
      {
        id: item.id,
        name: item.name,
        category: item.category,
        manufacturer: item.manufacturer,
        sku: item.sku,
        productUrl: item.productUrl,
        currentVersion: item.currentVersion,
        updatedUtc: item.updatedUtc,
        version,
      },
      version,
    );
    setCatalogDefinitions((current) => ({
      ...current,
      [definition.id]: definition,
    }));
    return definition;
  }

  async function loadCatalogDefinition(assetId: string) {
    if (catalogDefinitions[assetId] || catalogLoadingRef.current.has(assetId)) return;

    const reference = parseCatalogVersionAssetId(assetId);
    if (!reference) return;

    catalogLoadingRef.current.add(assetId);
    try {
      await resolveCatalogDefinition(assetId);
    } catch (error) {
      setCatalogSearchError(
        error instanceof Error
          ? error.message
          : "Catalog item could not be loaded.",
      );
    } finally {
      catalogLoadingRef.current.delete(assetId);
    }
  }

  function createParametricCabinet() {
    const definition = createDefaultCabinetDefinition(
      createEntityId("cabinet"),
      `Custom cabinet ${document.parametricAssets.length + 1}`,
    );
    session.execute(new AddParametricAssetCommand({ definition }));
    setActiveFurnitureAssetId(parametricAssetId(definition.id));
    setActiveTool("furniture");
    setViewMode("2d");
    setParametricEditError(null);
  }

  function updateSelectedParametricDefinition(
    changes: Partial<ParametricCabinetDefinition>,
  ) {
    if (!selectedParametricDefinition) return;

    try {
      session.execute(
        new UpdateParametricAssetCommand({
          definition: { ...selectedParametricDefinition, ...changes },
        }),
      );
      setParametricEditError(null);
    } catch (error) {
      setParametricEditError(
        error instanceof Error
          ? error.message
          : "Cabinet construction could not be changed.",
      );
    }
  }

  async function importGlbFurniture(file: File) {
    setModelImportState("importing");
    setModelImportError(null);

    try {
      const inspection = await inspectGlbFile(file);
      const asset = await uploadModelAsset(file);
      const itemId = `custom_${asset.sha256.slice(0, 24)}`;
      const rawName = file.name.replace(/\.glb$/i, "").trim();
      const item = await ensureCatalogItem({
        id: itemId,
        name: (rawName || "Imported model").slice(0, 256),
        category: "custom",
        manufacturer: null,
        sku: null,
        productUrl: null,
        version: {
          assetId: asset.id,
          thumbnailAssetId: null,
          widthMm: inspection.widthMm,
          depthMm: inspection.depthMm,
          heightMm: inspection.heightMm,
          metadata: {
            source: "user-upload",
            format: "glb",
            meshCount: inspection.meshCount,
            normalization: "gltf-metres-bounds-center-bottom",
          },
        },
      });

      const version =
        item.versions.find((candidate) => candidate.version === item.currentVersion) ??
        item.versions[0];
      if (!version) throw new Error("Imported catalog item has no version.");

      const definition = catalogFurnitureDefinition(
        {
          id: item.id,
          name: item.name,
          category: item.category,
          manufacturer: item.manufacturer,
          sku: item.sku,
          productUrl: item.productUrl,
          currentVersion: item.currentVersion,
          updatedUtc: item.updatedUtc,
          version,
        },
        version,
      );

      setCatalogDefinitions((current) => ({
        ...current,
        [definition.id]: definition,
      }));
      setCatalogResults((current) => [
        definition,
        ...current.filter((candidate) => candidate.id !== definition.id),
      ]);
      setActiveFurnitureAssetId(definition.id);
      setActiveTool("furniture");
      setViewMode("2d");
    } catch (error) {
      setModelImportError(
        error instanceof Error ? error.message : "GLB import failed.",
      );
    } finally {
      setModelImportState("idle");
    }
  }

  function currentLevel() {
    return document.levels.find((candidate) => candidate.id === levelId) ?? null;
  }

  function changeActiveLevel(nextLevelId: string) {
    if (!document.levels.some((candidate) => candidate.id === nextLevelId)) return;
    cancelTransient();
    setSelection(EMPTY_SELECTION);
    setActiveLevelId(nextLevelId);
  }

  function addLevel() {
    const current = currentLevel();
    if (!current) return;

    const id = createEntityId("level");
    const levelNumber = document.levels.length + 1;
    const nextElevationMm = Math.max(
      ...document.levels.map(
        (candidate) =>
          candidate.elevationMm +
          candidate.defaultWallHeightMm +
          candidate.floorThicknessMm,
      ),
    );

    session.execute(
      new AddLevelCommand({
        level: {
          id,
          name: `Level ${levelNumber}`,
          elevationMm: nextElevationMm,
          defaultWallHeightMm: current.defaultWallHeightMm,
          floorThicknessMm: current.floorThicknessMm,
          vertices: [],
          walls: [],
          openings: [],
          objects: [],
          blueprints: [],
          roomFinishes: [],
        },
      }),
    );

    cancelTransient();
    setSelection(EMPTY_SELECTION);
    setActiveLevelId(id);
  }

  function duplicateActiveLevelShell() {
    const current = currentLevel();
    if (!current) return;

    const currentIndex = document.levels.findIndex(
      (candidate) => candidate.id === current.id,
    );
    if (currentIndex < 0) return;

    const id = createEntityId("level");
    const duplicate = duplicateLevelShell(current, {
      levelId: id,
      name: `${current.name} copy`,
      elevationMm:
        current.elevationMm +
        current.defaultWallHeightMm +
        current.floorThicknessMm,
      createId: (prefix) => createEntityId(prefix),
    });

    session.execute(
      new AddLevelCommand({
        level: duplicate,
        index: currentIndex + 1,
      }),
    );

    cancelTransient();
    setSelection(EMPTY_SELECTION);
    setActiveLevelId(id);
    setGhostMode("below");
  }

  function updateActiveLevel(
    changes: Partial<
      Pick<
        NonNullable<ReturnType<typeof currentLevel>>,
        "name" | "elevationMm" | "defaultWallHeightMm" | "floorThicknessMm"
      >
    >,
  ) {
    const current = currentLevel();
    if (!current) return;

    session.execute(
      new UpdateLevelCommand({
        levelId: current.id,
        ...changes,
      }),
    );
  }

  function removeActiveLevel() {
    const current = currentLevel();
    if (!current || document.levels.length <= 1) return;

    const index = document.levels.findIndex((candidate) => candidate.id === current.id);
    const fallback =
      document.levels[index - 1] ??
      document.levels[index + 1] ??
      document.levels[0];
    if (!fallback) return;

    session.execute(new RemoveLevelCommand(current.id));
    cancelTransient();
    setSelection(EMPTY_SELECTION);
    setActiveLevelId(fallback.id);
  }

  function snap(point: PlanPoint): PlanSnapResult | null {
    const current = currentLevel();
    if (!current) return null;

    return snapPlanPoint(point, current, {
      gridSizeMm: document.settings.gridSizeMm,
    });
  }

  function openingPlacement(point: PlanPoint): OpeningWallPlacement | null {
    if (activeTool !== "door" && activeTool !== "window") return null;
    const current = currentLevel();
    if (!current) return null;
    return snapOpeningToWall(point, current, {
      widthMm: OPENING_PRESETS[activeTool].widthMm,
    });
  }

  function snapFurniturePosition(
    point: PlanPoint,
    subject: {
      id?: string;
      widthMm: number;
      depthMm: number;
      rotationDeg: number;
    },
  ): PlanSnapResult | null {
    const current = currentLevel();
    if (!current) return null;

    return snapObjectPosition(point, subject, current, {
      gridSizeMm: document.settings.gridSizeMm,
    });
  }

    function handlePlanPointerMove(point: PlanPoint) {
    if (activeTool === "select" || activeTool === "blueprint-calibrate") {
      setHoverSnap(null);
      setOpeningHover(null);
      return;
    }

    if (activeTool === "wall") {
      setHoverSnap(snap(point));
      setOpeningHover(null);
      return;
    }

    if (activeTool === "furniture") {
      setHoverSnap(
        activeFurnitureDefinition
          ? snapFurniturePosition(point, {
              widthMm: activeFurnitureDefinition.defaultDimensionsMm.widthMm,
              depthMm: activeFurnitureDefinition.defaultDimensionsMm.depthMm,
              rotationDeg: 0,
            })
          : null,
      );
      setOpeningHover(null);
      return;
    }

    setHoverSnap(null);
    setOpeningHover(openingPlacement(point));
  }

  function handlePlanPointerLeave() {
    setHoverSnap(null);
    setOpeningHover(null);
  }

  function handlePlanPoint(point: PlanPoint) {
    if (activeTool === "select") return;

    if (activeTool === "blueprint-calibrate") {
      handleCalibrationPoint(point);
      return;
    }

    if (activeTool === "wall") {
      handleWallPoint(point);
      return;
    }

    if (activeTool === "furniture") {
      handleFurniturePoint(point);
      return;
    }

    if (activeTool === "door" || activeTool === "window") {
      handleOpeningPoint(point, activeTool);
    }
  }

  function handleWallPoint(point: PlanPoint) {
    const snapped = snap(point);
    if (!snapped) return;

    if (!wallDraft) {
      setWallDraft({ start: snapped });
      setHoverSnap(snapped);
      return;
    }

    if (samePoint(wallDraft.start.point, snapped.point)) return;

    const start = endpointFromSnap(wallDraft.start);
    const end = endpointFromSnap(snapped);
    session.execute(
      new InsertWallWithTopologyCommand({
        levelId,
        wallId: createEntityId("wall"),
        start,
        end,
        thicknessMm: 120,
        createId: (prefix) => createEntityId(prefix),
      }),
    );

    const endVertexId = end.kind === "existing" ? end.vertexId : end.vertex.id;
    const chainedStart: PlanSnapResult = {
      point: snapped.point,
      source: "vertex",
      vertexId: endVertexId,
    };
    setWallDraft({ start: chainedStart });
    setHoverSnap(chainedStart);
  }

  function handleOpeningPoint(point: PlanPoint, tool: "door" | "window") {
    const placement = openingPlacement(point);
    if (!placement) return;

    const preset = OPENING_PRESETS[tool];
    const opening: Opening = {
      id: createEntityId(tool),
      wallId: placement.wallId,
      type: tool,
      offsetMm: placement.offsetMm,
      widthMm: preset.widthMm,
      heightMm: preset.heightMm,
      sillHeightMm: preset.sillHeightMm,
      flip: false,
      swing: tool === "door" ? "left" : "none",
    };

    session.execute(new AddOpeningCommand({ levelId, opening }));
    setOpeningHover(null);
  }

  function handleFurniturePoint(point: PlanPoint) {
    const definition = activeFurnitureDefinition;
    if (!definition) return;

    const snapped = snapFurniturePosition(point, {
      widthMm: definition.defaultDimensionsMm.widthMm,
      depthMm: definition.defaultDimensionsMm.depthMm,
      rotationDeg: 0,
    });
    if (!snapped) return;

    const object: ObjectInstance = {
      id: createEntityId("object"),
      assetId: definition.id,
      xMm: Math.round(snapped.point.xMm),
      yMm: Math.round(snapped.point.yMm),
      zMm: 0,
      rotationDeg: 0,
      widthMm: definition.defaultDimensionsMm.widthMm,
      depthMm: definition.defaultDimensionsMm.depthMm,
      heightMm: definition.defaultDimensionsMm.heightMm,
      locked: false,
    };

    session.execute(new AddObjectCommand({ levelId, object }));
    setSelection(selectOnly({ kind: "object", id: object.id }));
    setHoverSnap(snapped);
  }

  function handleCalibrationPoint(point: PlanPoint) {
    if (!selectedBlueprintId) return;

    setCalibrationDraft((current) => {
      if (!current || current.blueprintId !== selectedBlueprintId || current.secondPoint) {
        return { blueprintId: selectedBlueprintId, firstPoint: point, secondPoint: null };
      }
      if (!current.firstPoint) {
        return { ...current, firstPoint: point };
      }
      if (samePoint(current.firstPoint, point)) return current;
      return { ...current, secondPoint: point };
    });
  }

  async function importBlueprint(file: File) {
    setBlueprintImportState("uploading");
    setBlueprintImportError(null);

    try {
      const dimensions = await readImageDimensions(file);
      const asset = await uploadBlueprintAsset(file);
      const initialWidthMm = 6000;
      const millimetresPerPixel = initialWidthMm / dimensions.widthPx;
      const blueprint: BlueprintReference = {
        id: createEntityId("blueprint"),
        assetId: asset.id,
        sourceWidthPx: dimensions.widthPx,
        sourceHeightPx: dimensions.heightPx,
        crop: {
          leftPx: 0,
          topPx: 0,
          widthPx: dimensions.widthPx,
          heightPx: dimensions.heightPx,
        },
        originXmm: 0,
        originYmm: 0,
        millimetresPerPixel,
        rotationDeg: 0,
        opacity: 0.5,
        locked: true,
        visible: true,
      };

      session.execute(new AddBlueprintCommand({ levelId, blueprint }));
      setSelection(selectOnly({ kind: "blueprint", id: blueprint.id }));
      setActiveTool("select");
      setViewMode("2d");
    } catch (error) {
      setBlueprintImportError(
        error instanceof Error ? error.message : "Blueprint import failed.",
      );
    } finally {
      setBlueprintImportState("idle");
    }
  }

  function updateSelectionTarget(target: SelectionTarget, additive = false) {
    setSelection((current) =>
      additive ? toggleSelection(current, target) : selectOnly(target),
    );
  }

  function selectBlueprint(blueprintId: string, additive = false) {
    updateSelectionTarget({ kind: "blueprint", id: blueprintId }, additive);
  }

  function startBlueprintCalibration() {
    if (!selectedBlueprintId) return;
    cancelTransient();
    setCalibrationDraft({
      blueprintId: selectedBlueprintId,
      firstPoint: null,
      secondPoint: null,
    });
    setActiveTool("blueprint-calibrate");
    setViewMode("2d");
  }

  function commitBlueprintCalibration(lengthMm: number) {
    const draft = calibrationDraft;
    if (!draft?.firstPoint || !draft.secondPoint) return;

    session.execute(
      new CalibrateBlueprintCommand({
        levelId,
        blueprintId: draft.blueprintId,
        firstPlanPoint: draft.firstPoint,
        secondPlanPoint: draft.secondPoint,
        knownLengthMm: lengthMm,
      }),
    );
    setCalibrationDraft(null);
    setActiveTool("select");
  }

  function updateBlueprint(blueprintId: string, changes: Partial<BlueprintReference>) {
    const blueprint = currentLevel()?.blueprints.find(
      (candidate) => candidate.id === blueprintId,
    );
    if (!blueprint) return;

    session.execute(
      new UpdateBlueprintCommand({
        levelId,
        blueprint: { ...blueprint, ...changes },
      }),
    );
  }

  function updateSelectedBlueprint(changes: Partial<BlueprintReference>) {
    if (!selectedBlueprintId) return;
    updateBlueprint(selectedBlueprintId, changes);
  }

  function moveBlueprintLayer(blueprintId: string, delta: -1 | 1) {
    const blueprints = currentLevel()?.blueprints;
    if (!blueprints) return;

    const currentIndex = blueprints.findIndex(
      (candidate) => candidate.id === blueprintId,
    );
    if (currentIndex < 0) return;

    const toIndex = currentIndex + delta;
    if (toIndex < 0 || toIndex >= blueprints.length) return;

    session.execute(
      new MoveBlueprintLayerCommand({
        levelId,
        blueprintId,
        toIndex,
      }),
    );
  }

  function removeBlueprint(blueprintId: string) {
    const current = currentLevel();
    if (!current?.blueprints.some((candidate) => candidate.id === blueprintId)) return;

    session.execute(new RemoveBlueprintCommand(levelId, blueprintId));
    if (selectedBlueprintId === blueprintId) setSelection(EMPTY_SELECTION);
    if (calibrationDraft?.blueprintId === blueprintId) {
      setCalibrationDraft(null);
      setActiveTool("select");
    }
  }

  function moveBlueprint(blueprintId: string, xMm: number, yMm: number) {
    const blueprint = currentLevel()?.blueprints.find(
      (candidate) => candidate.id === blueprintId,
    );
    if (!blueprint || blueprint.locked) return;

    session.execute(
      new UpdateBlueprintCommand({
        levelId,
        blueprint: {
          ...blueprint,
          originXmm: Math.round(xMm),
          originYmm: Math.round(yMm),
        },
      }),
    );
  }

  function selectObject(objectId: string, additive = false) {
    updateSelectionTarget({ kind: "object", id: objectId }, additive);
    const object = currentLevel()?.objects.find(
      (candidate) => candidate.id === objectId,
    );
    if (object) void loadCatalogDefinition(object.assetId);
  }

  function updateObject(objectId: string, changes: Partial<ObjectInstance>) {
    const object = currentLevel()?.objects.find(
      (candidate) => candidate.id === objectId,
    );
    if (!object) return;

    session.execute(
      new UpdateObjectCommand({
        levelId,
        object: { ...object, ...changes },
      }),
    );
  }

  function updateSelectedObject(changes: Partial<ObjectInstance>) {
    if (!selectedObjectId) return;
    updateObject(selectedObjectId, changes);
  }

  function moveObject(objectId: string, xMm: number, yMm: number) {
    const current = currentLevel();
    const object = current?.objects.find(
      (candidate) => candidate.id === objectId,
    );
    if (!current || !object || object.locked) return;

    const snapped = snapObjectPosition(
      { xMm, yMm },
      {
        id: object.id,
        widthMm: object.widthMm,
        depthMm: object.depthMm,
        rotationDeg: object.rotationDeg,
      },
      current,
      { gridSizeMm: document.settings.gridSizeMm },
    );

    updateObject(objectId, {
      xMm: Math.round(snapped.point.xMm),
      yMm: Math.round(snapped.point.yMm),
    });
  }

  function duplicateSelectedObject() {
    if (selection.items.length > 1) {
      duplicateSelection();
      return;
    }
    const current = currentLevel();
    if (!current || !selectedObject) return;

    const id = createEntityId("object");
    const snapped = snapObjectPosition(
      {
        xMm:
          selectedObject.xMm +
          selectedObject.widthMm +
          document.settings.gridSizeMm,
        yMm: selectedObject.yMm,
      },
      {
        id,
        widthMm: selectedObject.widthMm,
        depthMm: selectedObject.depthMm,
        rotationDeg: selectedObject.rotationDeg,
      },
      current,
      { gridSizeMm: document.settings.gridSizeMm },
    );
    const duplicate: ObjectInstance = {
      ...selectedObject,
      id,
      xMm: Math.round(snapped.point.xMm),
      yMm: Math.round(snapped.point.yMm),
      locked: false,
    };

    session.execute(new AddObjectCommand({ levelId, object: duplicate }));
    setSelection(selectOnly({ kind: "object", id }));
  }

  function removeSelectedObject() {
    if (selection.items.length > 1) {
      deleteSelection();
      return;
    }
    if (!selectedObjectId) return;
    session.execute(new RemoveObjectCommand(levelId, selectedObjectId));
    setSelection(EMPTY_SELECTION);
  }

  function cancelTransient() {
    setWallDraft(null);
    setHoverSnap(null);
    setOpeningHover(null);
    setCalibrationDraft(null);
    setHoveredTarget(null);
  }

  function selectTool(tool: EditorTool) {
    cancelTransient();
    setActiveTool(tool);
    setViewMode("2d");
  }

  function openFurnitureTool() {
    selectTool("furniture");
    if (catalogSearchState === "idle") {
      void runCatalogSearch("");
    }
  }

  function selectWall(wallId: string, additive = false) {
    updateSelectionTarget({ kind: "wall", id: wallId }, additive);
  }

  function selectRoom(roomKey: string, additive = false) {
    updateSelectionTarget({ kind: "room", id: roomKey }, additive);
  }

  function selectFromThree(hit: RoomSceneHit | null, additive: boolean) {
    if (!hit) {
      if (!additive) clearSelection();
      return;
    }
    updateSelectionTarget({ kind: hit.kind, id: hit.id }, additive);
    if (hit.kind === "object") {
      const object = currentLevel()?.objects.find(
        (candidate) => candidate.id === hit.id,
      );
      if (object) void loadCatalogDefinition(object.assetId);
    }
  }

  function setSelectedWallMaterial(
    side: "left" | "right",
    materialId: string,
  ) {
    if (!selectedWallId) return;
    session.execute(
      new SetWallMaterialsCommand({
        levelId,
        wallId: selectedWallId,
        ...(side === "left"
          ? { leftMaterialId: materialId || null }
          : { rightMaterialId: materialId || null }),
      }),
    );
  }

  function setSelectedRoomMaterial(
    surface: "floor" | "ceiling",
    materialId: string,
  ) {
    if (!selectedRoomKey) return;
    session.execute(
      new SetRoomSurfaceMaterialsCommand({
        levelId,
        roomKey: selectedRoomKey,
        ...(surface === "floor"
          ? { floorMaterialId: materialId || null }
          : { ceilingMaterialId: materialId || null }),
      }),
    );
  }

  function clearSelection() {
    setSelection(EMPTY_SELECTION);
  }

  function setSelectedWallLength(lengthMm: number) {
    if (!selectedWallId) return;
    session.execute(
      new SetWallLengthCommand({
        levelId,
        wallId: selectedWallId,
        lengthMm,
        anchor: wallEditAnchor,
      }),
    );
  }

  function setSelectedWallAngle(angleDeg: number) {
    if (!selectedWallId) return;
    session.execute(
      new SetWallAngleCommand({
        levelId,
        wallId: selectedWallId,
        angleDeg,
        anchor: wallEditAnchor,
      }),
    );
  }

  function setSelectedWallThickness(thicknessMm: number) {
    if (!selectedWallId) return;
    session.execute(
      new SetWallThicknessCommand({
        levelId,
        wallId: selectedWallId,
        thicknessMm,
      }),
    );
  }

  function moveWallVertex(vertexId: string, xMm: number, yMm: number) {
    session.execute(
      new MoveVertexCommand({
        levelId,
        vertexId,
        xMm: Math.round(xMm),
        yMm: Math.round(yMm),
      }),
    );
  }

  function moveWall(wallId: string, deltaXmm: number, deltaYmm: number) {
    if (deltaXmm === 0 && deltaYmm === 0) return;
    session.execute(
      new MoveWallCommand({
        levelId,
        wallId,
        deltaXmm: Math.round(deltaXmm),
        deltaYmm: Math.round(deltaYmm),
      }),
    );
  }

  function removeSelectedWall() {
    if (selection.items.length > 1) {
      deleteSelection();
      return;
    }
    if (!selectedWallId) return;
    session.execute(new RemoveWallByIdCommand(levelId, selectedWallId));
    setSelection(EMPTY_SELECTION);
  }

  function duplicateSelection() {
    const current = currentLevel();
    if (!current) return;

    const offsetMm = Math.max(document.settings.gridSizeMm * 2, 200);
    const commands: EditorCommand[] = [];
    const nextTargets: SelectionTarget[] = [];

    for (const target of selection.items) {
      if (target.kind === "object") {
        const object = current.objects.find((candidate) => candidate.id === target.id);
        if (!object) continue;
        const id = createEntityId("object");
        commands.push(
          new AddObjectCommand({
            levelId,
            object: {
              ...object,
              id,
              xMm: object.xMm + offsetMm,
              yMm: object.yMm + offsetMm,
              locked: false,
            },
          }),
        );
        nextTargets.push({ kind: "object", id });
      } else if (target.kind === "blueprint") {
        const blueprint = current.blueprints.find(
          (candidate) => candidate.id === target.id,
        );
        if (!blueprint) continue;
        const id = createEntityId("blueprint");
        commands.push(
          new AddBlueprintCommand({
            levelId,
            blueprint: {
              ...blueprint,
              id,
              originXmm: blueprint.originXmm + offsetMm,
              originYmm: blueprint.originYmm + offsetMm,
              locked: false,
            },
          }),
        );
        nextTargets.push({ kind: "blueprint", id });
      }
    }

    if (commands.length === 0) return;
    session.execute(
      commands.length === 1 ? commands[0]! : new BatchCommand(commands),
    );
    setSelection(selectMany(nextTargets));
  }

  function deleteSelection() {
    const commands: EditorCommand[] = [];
    for (const target of selection.items) {
      if (target.kind === "wall") {
        commands.push(new RemoveWallByIdCommand(levelId, target.id));
      } else if (target.kind === "object") {
        commands.push(new RemoveObjectCommand(levelId, target.id));
      } else if (target.kind === "blueprint") {
        commands.push(new RemoveBlueprintCommand(levelId, target.id));
      }
    }

    if (commands.length === 0) return;
    session.execute(
      commands.length === 1 ? commands[0]! : new BatchCommand(commands),
    );
    setSelection(EMPTY_SELECTION);
  }

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      if (duplicableSelectionCount === 0) return;
      event.preventDefault();
      duplicateSelection();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (deletableSelectionCount === 0) return;
      event.preventDefault();
      deleteSelection();
    }
  }

  function exportNativeProject() {
    downloadTextFile(
      roomCraftFileName(document),
      serializeRoomCraftDocument(document),
      "application/json;charset=utf-8",
    );
  }

  function exportSvgFloorPlan() {
    downloadTextFile(
      svgFloorPlanFileName(document, levelId),
      exportLevelSvg(document, levelId),
      "image/svg+xml;charset=utf-8",
    );
  }

  async function exportRasterFloorPlan(format: RasterFloorPlanFormat) {
    setRasterExportState("exporting");
    setRasterExportError(null);

    try {
      const svg = exportLevelSvg(document, levelId);
      const blob = await rasterizeSvgFloorPlan(svg, {
        format,
        maxDimensionPx: 2400,
        backgroundColor: "#ffffff",
        ...(format === "jpeg" ? { jpegQuality: 0.92 } : {}),
      });
      downloadBlob(
        rasterFloorPlanFileName(document, levelId, format),
        blob,
      );
    } catch (error) {
      setRasterExportError(
        error instanceof Error ? error.message : "Raster export failed.",
      );
    } finally {
      setRasterExportState("idle");
    }
  }

  async function exportGlbProject() {
    setGlbExportState("exporting");
    setGlbExportError(null);

    try {
      const usedCatalogAssetIds = [
        ...new Set(
          document.levels
            .flatMap((candidate) => candidate.objects)
            .map((object) => object.assetId)
            .filter((assetId) => parseCatalogVersionAssetId(assetId) !== null),
        ),
      ];

      const resolved = await Promise.all(
        usedCatalogAssetIds.map((assetId) =>
          resolveCatalogDefinition(assetId),
        ),
      );
      const definitions = new Map(
        [
          ...Object.values(catalogDefinitions),
          ...resolved.filter(
            (definition): definition is FurnitureDefinition =>
              definition !== null,
          ),
        ].map((definition) => [definition.id, definition] as const),
      );
      const modelAssets: RuntimeModelAsset[] = [...definitions.values()]
        .filter(
          (definition): definition is FurnitureDefinition & { modelAssetId: string } =>
            definition.modelAssetId !== null,
        )
        .map((definition) => ({
          objectAssetId: definition.id,
          contentUrl: assetContentUrl(definition.modelAssetId),
        }));

      const binary = await exportProjectGlb(document, {
        activeLevelId: levelId,
        modelAssets,
        showCeilings: true,
      });
      downloadBinaryFile(
        glbProjectFileName(document),
        binary,
        "model/gltf-binary",
      );
    } catch (error) {
      setGlbExportError(
        error instanceof Error ? error.message : "GLB export failed.",
      );
    } finally {
      setGlbExportState("idle");
    }
  }

  async function importNativeProject(file: File) {
    setProjectFileError(null);

    try {
      const source = await file.text();
      const imported = parseRoomCraftDocumentFile(source);
      window.localStorage.setItem(CURRENT_PROJECT_KEY, imported.id);
      session.importDocument(imported);
      setActiveLevelId(imported.levels[0]?.id ?? null);
      setSelection(EMPTY_SELECTION);
      setActiveTool("select");
      setViewMode("2d");
      setGhostMode("off");
      setThreeLevelScope("active");
      setParametricEditError(null);
    } catch (error) {
      setProjectFileError(
        error instanceof Error ? error.message : "Project import failed.",
      );
    }
  }

  function changeView(mode: ViewMode) {
    setViewMode(mode);
    if (mode !== "2d") cancelTransient();
  }

  function undo() {
    cancelTransient();
    session.undo();
  }

  function redo() {
    cancelTransient();
    session.redo();
  }

  function exitActiveTool() {
    cancelTransient();
    setActiveTool("select");
  }

  const propertiesPanel = (
    <Panel>
                <div className="properties__content">
                  <div className="level-editor">
                    <span className="eyebrow">Level</span>
                    <select
                      className="rc-input level-select"
                      value={levelId}
                      aria-label="Active level"
                      onChange={(event) => changeActiveLevel(event.target.value)}
                    >
                      {document.levels.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                    <label className="rc-field">
                      <span className="rc-field__label">Name</span>
                      <input
                        key={`${level.id}:${level.name}`}
                        className="rc-input"
                        type="text"
                        defaultValue={level.name}
                        onBlur={(event) => {
                          const name = event.currentTarget.value.trim();
                          if (!name || name === level.name) return;
                          updateActiveLevel({ name });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            event.currentTarget.value = level.name;
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                    <NumberField
                      label="Elevation"
                      value={level.elevationMm}
                      step={1}
                      suffix="mm"
                      onCommit={(value) =>
                        updateActiveLevel({ elevationMm: Math.round(value) })
                      }
                    />
                    <NumberField
                      label="Wall height"
                      value={level.defaultWallHeightMm}
                      min={100}
                      step={1}
                      suffix="mm"
                      onCommit={(value) =>
                        updateActiveLevel({ defaultWallHeightMm: Math.round(value) })
                      }
                    />
                    <NumberField
                      label="Floor thickness"
                      value={level.floorThicknessMm}
                      min={0}
                      step={1}
                      suffix="mm"
                      onCommit={(value) =>
                        updateActiveLevel({ floorThicknessMm: Math.round(value) })
                      }
                    />
                    <div className="level-editor__actions">
                      <Button variant="secondary" onClick={addLevel}>
                        Add level
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={duplicateActiveLevelShell}
                        title="Copy walls, vertices and openings into a new level"
                      >
                        Duplicate shell
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={document.levels.length <= 1}
                        onClick={removeActiveLevel}
                      >
                        Delete level
                      </Button>
                    </div>
                    <SegmentedControl
                      value={effectiveGhostMode}
                      options={ghostOptions}
                      onChange={setGhostMode}
                      ariaLabel="Reference level overlay"
                    />
                  </div>
    
                  <dl className="stats">
                    <div>
                      <dt>Walls</dt>
                      <dd>{level.walls.length}</dd>
                    </div>
                    <div>
                      <dt>Openings</dt>
                      <dd>{level.openings.length}</dd>
                    </div>
                    <div>
                      <dt>Rooms</dt>
                      <dd>{projection.rooms.length}</dd>
                    </div>
                    <div>
                      <dt>Topology</dt>
                      <dd>{projection.topologyIssues.length === 0 ? "OK" : `${projection.topologyIssues.length} issue(s)`}</dd>
                    </div>
                    <div>
                      <dt>Levels</dt>
                      <dd>{document.levels.length}</dd>
                    </div>
                    <div>
                      <dt>Grid</dt>
                      <dd>{document.settings.gridSizeMm} mm</dd>
                    </div>
                    <div>
                      <dt>Revision</dt>
                      <dd>{revision ?? "—"}</dd>
                    </div>
                  </dl>
    
                  {activeTool === "furniture" ? (
                    <div className="furniture-palette">
                      <span className="eyebrow">Furniture</span>
    
                      <div className="furniture-palette__section">
                        <strong className="furniture-palette__section-title">
                          Quick shapes
                        </strong>
                        <div className="furniture-palette__grid">
                          {BUILTIN_FURNITURE.map((asset) => (
                            <Button
                              key={asset.id}
                              type="button"
                              variant={
                                asset.id === activeFurnitureAssetId
                                  ? "primary"
                                  : "secondary"
                              }
                              onClick={() => setActiveFurnitureAssetId(asset.id)}
                            >
                              {asset.name}
                            </Button>
                          ))}
                        </div>
                      </div>
    
                      <div className="furniture-palette__section">
                        <strong className="furniture-palette__section-title">
                          Custom furniture
                        </strong>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={createParametricCabinet}
                        >
                          New cabinet
                        </Button>
                        {document.parametricAssets.length > 0 ? (
                          <div className="furniture-palette__grid">
                            {document.parametricAssets.map((definition) => {
                              const assetId = parametricAssetId(definition.id);
                              return (
                                <Button
                                  key={definition.id}
                                  type="button"
                                  variant={
                                    assetId === activeFurnitureAssetId
                                      ? "primary"
                                      : "secondary"
                                  }
                                  onClick={() => setActiveFurnitureAssetId(assetId)}
                                >
                                  {definition.name}
                                </Button>
                              );
                            })}
                          </div>
                        ) : null}
                        <span className="property-hint">
                          Cabinets stay parametric: resize the placed object and
                          change shelves, fronts and construction later.
                        </span>
                      </div>
    
                      <div className="furniture-palette__section">
                        <strong className="furniture-palette__section-title">
                          My 3D models
                        </strong>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={modelImportState === "importing"}
                          onClick={() => modelFileRef.current?.click()}
                        >
                          {modelImportState === "importing" ? "Importing…" : "Import GLB"}
                        </Button>
                        <input
                          ref={modelFileRef}
                          className="visually-hidden"
                          type="file"
                          accept=".glb,model/gltf-binary"
                          tabIndex={-1}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void importGlbFurniture(file);
                          }}
                        />
                        {modelImportError ? (
                          <div className="inline-error" role="alert">
                            {modelImportError}
                          </div>
                        ) : null}
                        <span className="property-hint">
                          glTF 2.0 binary models are measured in metres, centered and
                          placed on the floor automatically.
                        </span>
                      </div>
    
                      <form
                        className="catalog-search"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void runCatalogSearch();
                        }}
                      >
                        <TextField
                          label="Catalog search"
                          value={catalogQuery}
                          onChange={setCatalogQuery}
                          placeholder="Name, manufacturer or SKU"
                          inputMode="search"
                        />
                        <Button
                          type="submit"
                          variant="secondary"
                          disabled={catalogSearchState === "loading"}
                        >
                          {catalogSearchState === "loading"
                            ? "Searching…"
                            : "Search"}
                        </Button>
                      </form>
    
                      {catalogSearchError ? (
                        <div className="inline-error" role="alert">
                          {catalogSearchError}
                        </div>
                      ) : null}
    
                      {catalogSearchState === "ready" ? (
                        <span className="property-hint">
                          {catalogResultTotal} catalog item
                          {catalogResultTotal === 1 ? "" : "s"}
                        </span>
                      ) : null}
    
                      <div className="catalog-results" role="list">
                        {catalogResults.map((asset) => (
                          <Button
                            key={asset.id}
                            type="button"
                            className="catalog-card"
                            variant={
                              asset.id === activeFurnitureAssetId
                                ? "primary"
                                : "secondary"
                            }
                            onClick={() => setActiveFurnitureAssetId(asset.id)}
                          >
                            {asset.thumbnailAssetId ? (
                              <img
                                className="catalog-card__thumbnail"
                                src={assetContentUrl(asset.thumbnailAssetId)}
                                alt=""
                              />
                            ) : (
                              <span
                                className="catalog-card__placeholder"
                                aria-hidden="true"
                              >
                                □
                              </span>
                            )}
                            <span className="catalog-card__body">
                              <strong>{asset.name}</strong>
                              <span>
                                {asset.manufacturer ?? asset.category}
                                {asset.sku ? ` · ${asset.sku}` : ""}
                              </span>
                              <span>
                                {asset.defaultDimensionsMm.widthMm} ×{" "}
                                {asset.defaultDimensionsMm.depthMm} ×{" "}
                                {asset.defaultDimensionsMm.heightMm} mm
                              </span>
                            </span>
                          </Button>
                        ))}
                      </div>
    
                      <span className="property-hint">
                        Catalog products are placed with their current immutable
                        version and exact dimensions.
                      </span>
                    </div>
                  ) : null}
    
                                {projectFileError ? (
                    <div className="inline-error" role="alert">
                      {projectFileError}
                    </div>
                  ) : null}
    
                  {glbExportError ? (
                    <div className="inline-error" role="alert">
                      {glbExportError}
                    </div>
                  ) : null}
    
                  {rasterExportError ? (
                    <div className="inline-error" role="alert">
                      {rasterExportError}
                    </div>
                  ) : null}
    
                  {blueprintImportError ? (
                    <div className="inline-error" role="alert">
                      {blueprintImportError}
                    </div>
                  ) : null}
    
                  {selection.items.length > 1 ? (
                    <div className="selection-summary" aria-label="Multiple selection">
                      <span className="eyebrow">Selection</span>
                      <strong>{selection.items.length} items selected</strong>
                      <span className="property-hint">
                        Shift-click adds or removes items. The last selected item remains the primary editor target.
                      </span>
                      <div className="selection-actions">
                        <Button
                          variant="secondary"
                          disabled={duplicableSelectionCount === 0}
                          onClick={duplicateSelection}
                        >
                          Duplicate {duplicableSelectionCount > 0 ? `(${duplicableSelectionCount})` : ""}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={deletableSelectionCount === 0}
                          onClick={deleteSelection}
                        >
                          Delete {deletableSelectionCount > 0 ? `(${deletableSelectionCount})` : ""}
                        </Button>
                        <Button variant="ghost" onClick={clearSelection}>
                          Clear
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="blueprint-layers">
                    <span className="eyebrow">Blueprint layers</span>
                    <LayerList
                      emptyLabel="No blueprints on this level"
                      items={[...level.blueprints]
                        .map((blueprint, index) => ({
                          id: blueprint.id,
                          label: `Blueprint ${index + 1}`,
                          selected: blueprint.id === selectedBlueprintId,
                          visible: blueprint.visible,
                          locked: blueprint.locked,
                          canMoveUp: index < level.blueprints.length - 1,
                          canMoveDown: index > 0,
                        }))
                        .reverse()}
                      onSelect={selectBlueprint}
                      onToggleVisible={(blueprintId) => {
                        const blueprint = level.blueprints.find(
                          (candidate) => candidate.id === blueprintId,
                        );
                        if (blueprint) {
                          updateBlueprint(blueprintId, { visible: !blueprint.visible });
                        }
                      }}
                      onToggleLocked={(blueprintId) => {
                        const blueprint = level.blueprints.find(
                          (candidate) => candidate.id === blueprintId,
                        );
                        if (blueprint) {
                          updateBlueprint(blueprintId, { locked: !blueprint.locked });
                        }
                      }}
                      onMoveUp={(blueprintId) => moveBlueprintLayer(blueprintId, 1)}
                      onMoveDown={(blueprintId) => moveBlueprintLayer(blueprintId, -1)}
                      onDelete={removeBlueprint}
                    />
                  </div>
    
                  {selectedWall ? (
                    <div className="selection-properties">
                      <span className="eyebrow">Selected wall</span>
                      <SegmentedControl
                        value={wallEditAnchor}
                        options={[
                          { value: "start", label: "Fix start" },
                          { value: "end", label: "Fix end" },
                        ]}
                        onChange={setWallEditAnchor}
                        ariaLabel="Fixed wall endpoint"
                      />
                      <LengthField
                        label="Length"
                        valueMm={Math.round(selectedWall.lengthMm)}
                        minMm={100}
                        helpText={`The ${wallEditAnchor} endpoint stays fixed. Connected walls at the moved endpoint follow it.`}
                        onCommit={setSelectedWallLength}
                      />
                      <NumberField
                        label="Angle"
                        value={selectedWallAngleDeg ?? 0}
                        step={1}
                        suffix="°"
                        onCommit={setSelectedWallAngle}
                      />
                      <NumberField
                        label="Thickness"
                        value={selectedWall.thicknessMm}
                        min={40}
                        max={1000}
                        step={10}
                        suffix="mm"
                        onCommit={(value) => setSelectedWallThickness(Math.round(value))}
                      />
                      <span className="property-hint">
                        Drag either endpoint handle in the plan for direct vertex editing.
                      </span>
                      <Button variant="ghost" onClick={removeSelectedWall}>
                        Delete wall
                      </Button>
                      <SelectField
                        label="Left surface"
                        value={selectedWall.leftMaterialId ?? ""}
                        options={materialOptions}
                        helpText="Left side when looking from the wall start toward its end."
                        onChange={(value) => setSelectedWallMaterial("left", value)}
                      />
                      <SelectField
                        label="Right surface"
                        value={selectedWall.rightMaterialId ?? ""}
                        options={materialOptions}
                        onChange={(value) => setSelectedWallMaterial("right", value)}
                      />
                    </div>
                  ) : null}
    
                  {selectedRoom ? (
                    <div className="selection-properties">
                      <span className="eyebrow">Selected room</span>
                      <strong>{formatAreaSquareMetres(selectedRoom.areaMm2)} m²</strong>
                      <SelectField
                        label="Floor"
                        value={selectedRoom.floorMaterialId ?? ""}
                        options={materialOptions}
                        onChange={(value) => setSelectedRoomMaterial("floor", value)}
                      />
                      <SelectField
                        label="Ceiling"
                        value={selectedRoom.ceilingMaterialId ?? ""}
                        options={materialOptions}
                        helpText="Enable Ceilings in 3D to preview the ceiling surface."
                        onChange={(value) => setSelectedRoomMaterial("ceiling", value)}
                      />
                    </div>
                  ) : null}
    
                  {selectedBlueprint ? (
                    <div className="selection-properties">
                      <span className="eyebrow">Selected blueprint</span>
                      <dl className="stats">
                        <div>
                          <dt>Image</dt>
                          <dd>{selectedBlueprint.sourceWidthPx} × {selectedBlueprint.sourceHeightPx}px</dd>
                        </div>
                        <div>
                          <dt>Scale</dt>
                          <dd>{selectedBlueprint.millimetresPerPixel.toFixed(3)} mm/px</dd>
                        </div>
                      </dl>
                      <NumberField
                        label="X"
                        value={selectedBlueprint.originXmm}
                        step={1}
                        suffix="mm"
                        disabled={selectedBlueprint.locked}
                        onCommit={(value) =>
                          updateSelectedBlueprint({ originXmm: Math.round(value) })
                        }
                      />
                      <NumberField
                        label="Y"
                        value={selectedBlueprint.originYmm}
                        step={1}
                        suffix="mm"
                        disabled={selectedBlueprint.locked}
                        onCommit={(value) =>
                          updateSelectedBlueprint({ originYmm: Math.round(value) })
                        }
                      />
                      <NumberField
                        label="Rotation"
                        value={normalizeDegrees(selectedBlueprint.rotationDeg)}
                        step={0.1}
                        suffix="°"
                        disabled={selectedBlueprint.locked}
                        onCommit={(value) =>
                          updateSelectedBlueprint({ rotationDeg: normalizeDegrees(value) })
                        }
                      />
                      <NumberField
                        label="Opacity"
                        value={selectedBlueprint.opacity * 100}
                        min={0}
                        max={100}
                        step={1}
                        suffix="%"
                        onCommit={(value) =>
                          updateSelectedBlueprint({ opacity: value / 100 })
                        }
                      />
                      <div className="blueprint-crop-fields">
                        <NumberField
                          label="Crop left"
                          value={selectedBlueprint.crop.leftPx}
                          min={0}
                          max={
                            selectedBlueprint.crop.leftPx +
                            selectedBlueprint.crop.widthPx -
                            1
                          }
                          step={1}
                          suffix="px"
                          disabled={selectedBlueprint.locked}
                          onCommit={(value) => {
                            const rightEdge =
                              selectedBlueprint.crop.leftPx +
                              selectedBlueprint.crop.widthPx;
                            const leftPx = Math.round(value);
                            updateSelectedBlueprint({
                              crop: {
                                ...selectedBlueprint.crop,
                                leftPx,
                                widthPx: rightEdge - leftPx,
                              },
                            });
                          }}
                        />
                        <NumberField
                          label="Crop top"
                          value={selectedBlueprint.crop.topPx}
                          min={0}
                          max={
                            selectedBlueprint.crop.topPx +
                            selectedBlueprint.crop.heightPx -
                            1
                          }
                          step={1}
                          suffix="px"
                          disabled={selectedBlueprint.locked}
                          onCommit={(value) => {
                            const bottomEdge =
                              selectedBlueprint.crop.topPx +
                              selectedBlueprint.crop.heightPx;
                            const topPx = Math.round(value);
                            updateSelectedBlueprint({
                              crop: {
                                ...selectedBlueprint.crop,
                                topPx,
                                heightPx: bottomEdge - topPx,
                              },
                            });
                          }}
                        />
                        <NumberField
                          label="Crop right"
                          value={
                            selectedBlueprint.sourceWidthPx -
                            selectedBlueprint.crop.leftPx -
                            selectedBlueprint.crop.widthPx
                          }
                          min={0}
                          max={
                            selectedBlueprint.sourceWidthPx -
                            selectedBlueprint.crop.leftPx -
                            1
                          }
                          step={1}
                          suffix="px"
                          disabled={selectedBlueprint.locked}
                          onCommit={(value) => {
                            const rightPx = Math.round(value);
                            updateSelectedBlueprint({
                              crop: {
                                ...selectedBlueprint.crop,
                                widthPx:
                                  selectedBlueprint.sourceWidthPx -
                                  selectedBlueprint.crop.leftPx -
                                  rightPx,
                              },
                            });
                          }}
                        />
                        <NumberField
                          label="Crop bottom"
                          value={
                            selectedBlueprint.sourceHeightPx -
                            selectedBlueprint.crop.topPx -
                            selectedBlueprint.crop.heightPx
                          }
                          min={0}
                          max={
                            selectedBlueprint.sourceHeightPx -
                            selectedBlueprint.crop.topPx -
                            1
                          }
                          step={1}
                          suffix="px"
                          disabled={selectedBlueprint.locked}
                          onCommit={(value) => {
                            const bottomPx = Math.round(value);
                            updateSelectedBlueprint({
                              crop: {
                                ...selectedBlueprint.crop,
                                heightPx:
                                  selectedBlueprint.sourceHeightPx -
                                  selectedBlueprint.crop.topPx -
                                  bottomPx,
                              },
                            });
                          }}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        disabled={selectedBlueprint.locked}
                        onClick={() =>
                          updateSelectedBlueprint({
                            crop: {
                              leftPx: 0,
                              topPx: 0,
                              widthPx: selectedBlueprint.sourceWidthPx,
                              heightPx: selectedBlueprint.sourceHeightPx,
                            },
                          })
                        }
                      >
                        Reset crop
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={selectedBlueprint.locked}
                        onClick={startBlueprintCalibration}
                      >
                        Calibrate scale
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => updateSelectedBlueprint({ visible: !selectedBlueprint.visible })}
                      >
                        {selectedBlueprint.visible ? "Hide blueprint" : "Show blueprint"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => updateSelectedBlueprint({ locked: !selectedBlueprint.locked })}
                      >
                        {selectedBlueprint.locked ? "Unlock blueprint" : "Lock blueprint"}
                      </Button>
                      {calibrationDraft?.blueprintId === selectedBlueprint.id &&
                      calibrationDraft.firstPoint &&
                      calibrationDraft.secondPoint ? (
                        <LengthField
                          label="Known distance"
                          valueMm={Math.max(
                            1,
                            Math.round(
                              Math.hypot(
                                calibrationDraft.secondPoint.xMm - calibrationDraft.firstPoint.xMm,
                                calibrationDraft.secondPoint.yMm - calibrationDraft.firstPoint.yMm,
                              ),
                            ),
                          )}
                          minMm={1}
                          helpText="Enter the real distance between the two points."
                          onCommit={commitBlueprintCalibration}
                        />
                      ) : null}
                    </div>
                  ) : null}
    
                  {selectedObject ? (
                    <div className="selection-properties">
                      <span className="eyebrow">
                        Selected {selectedObjectDefinition?.name ?? "object"}
                      </span>
                      {selectedObjectDefinition?.source === "catalog" ? (
                        <>
                          <dl className="stats stats--compact">
                            <div>
                              <dt>Source</dt>
                              <dd>Catalog</dd>
                            </div>
                            <div>
                              <dt>Manufacturer</dt>
                              <dd>{selectedObjectDefinition.manufacturer ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>SKU</dt>
                              <dd>{selectedObjectDefinition.sku ?? "—"}</dd>
                            </div>
                          </dl>
                          {selectedObjectDefinition.productUrl ? (
                            <a
                              className="product-link"
                              href={selectedObjectDefinition.productUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open product page
                            </a>
                          ) : null}
                        </>
                      ) : selectedObjectIsCatalog ? (
                        <span className="property-hint">
                          Loading the saved catalog version…
                        </span>
                      ) : null}
    
                      {selectedParametricDefinition ? (
                        <div className="cabinet-builder">
                          <strong>Cabinet construction</strong>
                          <SelectField
                            label="Front"
                            value={selectedParametricDefinition.frontStyle}
                            options={[
                              { value: "open", label: "Open" },
                              { value: "single-door", label: "Single door" },
                              { value: "double-door", label: "Double door" },
                            ]}
                            disabled={selectedObject.locked}
                            onChange={(value) =>
                              updateSelectedParametricDefinition({
                                frontStyle: value as ParametricCabinetDefinition["frontStyle"],
                              })
                            }
                          />
                          <SelectField
                            label="Material"
                            value={selectedParametricDefinition.materialId ?? ""}
                            options={materialOptions}
                            disabled={selectedObject.locked}
                            onChange={(value) =>
                              updateSelectedParametricDefinition({
                                materialId: value || null,
                              })
                            }
                          />
                          <LengthField
                            label="Panel thickness"
                            valueMm={selectedParametricDefinition.panelThicknessMm}
                            minMm={1}
                            disabled={selectedObject.locked}
                            onCommit={(valueMm) =>
                              updateSelectedParametricDefinition({
                                panelThicknessMm: valueMm,
                              })
                            }
                          />
                          <LengthField
                            label="Back thickness"
                            valueMm={selectedParametricDefinition.backThicknessMm}
                            minMm={1}
                            disabled={selectedObject.locked}
                            onCommit={(valueMm) =>
                              updateSelectedParametricDefinition({
                                backThicknessMm: valueMm,
                              })
                            }
                          />
                          <LengthField
                            label="Shelf thickness"
                            valueMm={selectedParametricDefinition.shelfThicknessMm}
                            minMm={1}
                            disabled={selectedObject.locked}
                            onCommit={(valueMm) =>
                              updateSelectedParametricDefinition({
                                shelfThicknessMm: valueMm,
                              })
                            }
                          />
                          <NumberField
                            label="Shelves"
                            value={selectedParametricDefinition.shelfCount}
                            min={0}
                            step={1}
                            disabled={selectedObject.locked}
                            onCommit={(value) =>
                              updateSelectedParametricDefinition({
                                shelfCount: Math.max(
                                  0,
                                  Math.min(64, Math.round(value)),
                                ),
                              })
                            }
                          />
                          <LengthField
                            label="Front thickness"
                            valueMm={selectedParametricDefinition.frontThicknessMm}
                            minMm={1}
                            disabled={selectedObject.locked}
                            onCommit={(valueMm) =>
                              updateSelectedParametricDefinition({
                                frontThicknessMm: valueMm,
                              })
                            }
                          />
                          <NumberField
                            label="Plinth height"
                            value={selectedParametricDefinition.plinthHeightMm}
                            min={0}
                            step={1}
                            suffix="mm"
                            disabled={selectedObject.locked}
                            onCommit={(value) =>
                              updateSelectedParametricDefinition({
                                plinthHeightMm: Math.max(0, Math.round(value)),
                              })
                            }
                          />
                          <NumberField
                            label="Worktop thickness"
                            value={selectedParametricDefinition.worktopThicknessMm}
                            min={0}
                            step={1}
                            suffix="mm"
                            disabled={selectedObject.locked}
                            onCommit={(value) =>
                              updateSelectedParametricDefinition({
                                worktopThicknessMm: Math.max(0, Math.round(value)),
                              })
                            }
                          />
                          {parametricEditError ? (
                            <div className="inline-error" role="alert">
                              {parametricEditError}
                            </div>
                          ) : null}
                          <div className="cabinet-cut-list">
                            <strong>Cut list</strong>
                            {selectedCabinetCutList.map((item, index) => (
                              <div
                                className="cabinet-cut-list__row"
                                key={`${item.label}:${item.lengthMm}:${item.widthMm}:${item.thicknessMm}:${index}`}
                              >
                                <span>
                                  {item.quantity} × {item.label}
                                </span>
                                <span>
                                  {Math.round(item.lengthMm)} ×{" "}
                                  {Math.round(item.widthMm)} ×{" "}
                                  {Math.round(item.thicknessMm)} mm
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
    
                      <NumberField
                        label="X"
                        value={selectedObject.xMm}
                        step={1}
                        suffix="mm"
                        disabled={selectedObject.locked}
                        onCommit={(value) =>
                          updateSelectedObject({ xMm: Math.round(value) })
                        }
                      />
                      <NumberField
                        label="Y"
                        value={selectedObject.yMm}
                        step={1}
                        suffix="mm"
                        disabled={selectedObject.locked}
                        onCommit={(value) =>
                          updateSelectedObject({ yMm: Math.round(value) })
                        }
                      />
                      <NumberField
                        label="Z"
                        value={selectedObject.zMm}
                        min={0}
                        step={1}
                        suffix="mm"
                        disabled={selectedObject.locked}
                        onCommit={(value) =>
                          updateSelectedObject({ zMm: Math.round(value) })
                        }
                      />
                      <LengthField
                        label="Width"
                        valueMm={selectedObject.widthMm}
                        minMm={
                          selectedObjectDefinition?.minimumDimensionsMm.widthMm ?? 1
                        }
                        disabled={selectedObjectDimensionsLocked}
                        onCommit={(valueMm) =>
                          updateSelectedObject({ widthMm: valueMm })
                        }
                      />
                      <LengthField
                        label="Depth"
                        valueMm={selectedObject.depthMm}
                        minMm={
                          selectedObjectDefinition?.minimumDimensionsMm.depthMm ?? 1
                        }
                        disabled={selectedObjectDimensionsLocked}
                        onCommit={(valueMm) =>
                          updateSelectedObject({ depthMm: valueMm })
                        }
                      />
                      <LengthField
                        label="Height"
                        valueMm={selectedObject.heightMm}
                        minMm={
                          selectedObjectDefinition?.minimumDimensionsMm.heightMm ?? 1
                        }
                        disabled={selectedObjectDimensionsLocked}
                        onCommit={(valueMm) =>
                          updateSelectedObject({ heightMm: valueMm })
                        }
                      />
                      <NumberField
                        label="Rotation"
                        value={normalizeDegrees(selectedObject.rotationDeg)}
                        step={1}
                        suffix="°"
                        disabled={selectedObject.locked}
                        onCommit={(value) =>
                          updateSelectedObject({
                            rotationDeg: normalizeDegrees(value),
                          })
                        }
                      />
                      <div className="selection-actions">
                        <Button
                          variant="ghost"
                          onClick={() =>
                            updateSelectedObject({ locked: !selectedObject.locked })
                          }
                        >
                          {selectedObject.locked ? "Unlock" : "Lock"}
                        </Button>
                        <Button variant="secondary" onClick={duplicateSelectedObject}>
                          Duplicate
                        </Button>
                        <Button variant="ghost" onClick={removeSelectedObject}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  ) : null}
    
                                <div className="tool-status" aria-live="polite">
                    <strong>{toolTitle(viewMode, activeTool, wallDraft !== null)}</strong>
                    <span>{toolHelp(viewMode, activeTool, wallDraft !== null)}</span>
                  </div>
                </div>
              </Panel>
  );

  return (
    <div className="app-shell" onKeyDownCapture={handleEditorKeyDown}>
      <header className="app-header">
        <div className="app-brand">
          <div className="desktop-only">
            <IconButton icon="back" label="Back to projects" variant="ghost" onClick={onExit} />
          </div>
          <div className="mobile-only">
            <IconButton icon="back" label="Back to projects" variant="ghost" onClick={onExit} />
          </div>
          <div className="app-brand__text">
            <strong>RoomCraft</strong>
            <span>{document.name}</span>
          </div>
        </div>

        <div className="desktop-command-bar desktop-only">
          <div className="desktop-command-bar__history">
            <IconButton icon="undo" label="Undo" variant="ghost" onClick={undo} disabled={!session.canUndo} />
            <IconButton icon="redo" label="Redo" variant="ghost" onClick={redo} disabled={!session.canRedo} />
          </div>

          <SegmentedControl value={viewMode} options={VIEW_OPTIONS} onChange={changeView} ariaLabel="Editor view" />

          <span className={`save-state save-state--${saveState}`} title={saveError ?? undefined}>
            {saveStateLabel(saveState)}
          </span>

          <Menu label="Project actions" className="desktop-project-menu">
            <Button
              variant="ghost"
              onClick={() => void session.saveNow()}
              disabled={saveState === "saving" || saveState === "saved"}
            >
              Save now
            </Button>
            <Button variant="ghost" onClick={() => blueprintFileRef.current?.click()}>Import blueprint</Button>
            <Button variant="ghost" onClick={() => projectImportRef.current?.click()}>Import project</Button>
            <Button variant="ghost" onClick={exportNativeProject}>Export project</Button>
            <Button variant="ghost" onClick={exportSvgFloorPlan}>Export SVG</Button>
            <Button variant="ghost" disabled={rasterExportState === "exporting"} onClick={() => void exportRasterFloorPlan("png")}>Export PNG</Button>
            <Button variant="ghost" disabled={rasterExportState === "exporting"} onClick={() => void exportRasterFloorPlan("jpeg")}>Export JPEG</Button>
            <Button variant="ghost" disabled={glbExportState === "exporting"} onClick={() => void exportGlbProject()}>Export GLB</Button>
            {viewMode === "3d" ? (
              <Button variant="ghost" onClick={() => setShowCeilings((current) => !current)}>
                {showCeilings ? "Hide ceilings" : "Show ceilings"}
              </Button>
            ) : null}
          </Menu>
        </div>

        <div className="mobile-header-actions mobile-only">
          <span className={`save-state save-state--${saveState}`} title={saveError ?? undefined}>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "•"}
          </span>
          <IconButton icon="undo" label="Undo" variant="ghost" onClick={undo} disabled={!session.canUndo} />
          <IconButton icon="redo" label="Redo" variant="ghost" onClick={redo} disabled={!session.canRedo} />
          <Menu label="Project and view actions">
            <Button variant="ghost" onClick={() => changeView("2d")}>2D view</Button>
            <Button variant="ghost" onClick={() => changeView("3d")}>3D view</Button>
            <Button variant="ghost" onClick={() => setMobilePropertiesOpen(true)}>Properties</Button>
            <Button variant="ghost" disabled={blueprintImportState === "uploading"} onClick={() => blueprintFileRef.current?.click()}>
              <Icon name="blueprint" /> Blueprint
            </Button>
            <Button variant="ghost" onClick={exportNativeProject}>Export project</Button>
            <Button variant="ghost" onClick={() => projectImportRef.current?.click()}>Import project</Button>
            <Button variant="ghost" onClick={exportSvgFloorPlan}>Export SVG</Button>
            <Button variant="ghost" disabled={rasterExportState === "exporting"} onClick={() => void exportRasterFloorPlan("png")}>Export PNG</Button>
            <Button variant="ghost" disabled={glbExportState === "exporting"} onClick={() => void exportGlbProject()}>Export GLB</Button>
          </Menu>
        </div>

        <input
          ref={projectImportRef}
          className="visually-hidden"
          type="file"
          accept=".roomcraft,application/json"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void importNativeProject(file);
          }}
        />
      </header>

      <main className="editor-layout">
        <aside className="tool-rail" aria-label="Drawing tools">
          <div className="tool-rail__group">
            <Button
              className="desktop-tool"
              variant={activeTool === "select" ? "primary" : "ghost"}
              onClick={() => selectTool("select")}
              title="Select and pan"
              aria-label="Select and pan"
            >
              <Icon name="select" />
              <span>Select</span>
            </Button>
            <Button
              className="desktop-tool"
              variant={activeTool === "wall" ? "primary" : "ghost"}
              onClick={() => selectTool("wall")}
              title="Draw walls"
              aria-label="Draw walls"
            >
              <Icon name="wall" />
              <span>Wall</span>
            </Button>
          </div>

          <div className="tool-rail__group">
            <Button
              className="desktop-tool"
              variant={activeTool === "door" ? "primary" : "ghost"}
              onClick={() => selectTool("door")}
              title="Place door"
              aria-label="Place door"
            >
              <Icon name="opening" />
              <span>Door</span>
            </Button>
            <Button
              className="desktop-tool"
              variant={activeTool === "window" ? "primary" : "ghost"}
              onClick={() => selectTool("window")}
              title="Place window"
              aria-label="Place window"
            >
              <Icon name="opening" />
              <span>Window</span>
            </Button>
          </div>

          <div className="tool-rail__group tool-rail__group--secondary">
            <Button
              className="desktop-tool"
              variant={activeTool === "furniture" ? "primary" : "ghost"}
              onClick={openFurnitureTool}
              title="Furniture"
              aria-label="Furniture"
            >
              <Icon name="furniture" />
              <span>Furniture</span>
            </Button>
            <Button
              className="desktop-tool"
              variant="ghost"
              disabled={blueprintImportState === "uploading"}
              onClick={() => blueprintFileRef.current?.click()}
              title="Import blueprint"
              aria-label="Import blueprint"
            >
              <Icon name="blueprint" />
              <span>Blueprint</span>
            </Button>
          </div>

          <input
            ref={blueprintFileRef}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importBlueprint(file);
            }}
          />
        </aside>

        <section className="workspace" aria-label="Planning workspace">
          {viewMode === "2d" ? (
            <PlanCanvas
              blueprints={projection.blueprints}
              objects={projection.objects}
              objectAssetLabels={objectAssetLabels}
              walls={projection.walls}
              openings={projection.openings}
              rooms={projection.rooms}
              topologyIssues={projection.topologyIssues}
              ghostProjection={ghostProjection}
              ghostLabel={ghostLevel?.name ?? null}
              activeTool={activeTool}
              selection={selection}
              hoveredTarget={hoveredTarget}
              selectedWallId={selectedWallId}
              selectedWallStartVertexId={selectedWallRecord?.startVertexId ?? null}
              selectedWallEndVertexId={selectedWallRecord?.endVertexId ?? null}
              calibrationDraft={calibrationDraft}
              draftStart={wallDraft?.start.point ?? null}
              draftEnd={wallDraft ? hoverSnap?.point ?? wallDraft.start.point : null}
              snapPoint={hoverSnap?.point ?? null}
              snapSource={hoverSnap?.source ?? null}
              openingHover={openingHover}
              onPoint={handlePlanPoint}
              onSelectWall={selectWall}
              onMoveWall={moveWall}
              onMoveVertex={moveWallVertex}
              onSelectRoom={selectRoom}
              onSelectBlueprint={selectBlueprint}
              onMoveBlueprint={moveBlueprint}
              onSelectObject={selectObject}
              onMoveObject={moveObject}
              onHoverTarget={setHoveredTarget}
              onClearSelection={clearSelection}
              onPointerPosition={handlePlanPointerMove}
              onPointerLeave={handlePlanPointerLeave}
              onCancel={cancelTransient}
              onExitTool={exitActiveTool}
            />
          ) : (
            <ThreeViewport
              document={document}
              levelId={levelId}
              levelScope={threeLevelScope}
              selection={selection}
              hoveredTarget={hoveredTarget}
              modelAssets={runtimeModelAssets}
              showCeilings={showCeilings}
              onSelect={selectFromThree}
              onHover={(hit) =>
                setHoveredTarget(hit ? { kind: hit.kind, id: hit.id } : null)
              }
            />
          )}
        </section>

        {isMobile ? (
          <Sheet
            open={mobilePropertiesOpen}
            title="Properties"
            className="editor-properties-sheet"
            onClose={() => setMobilePropertiesOpen(false)}
          >
            {propertiesPanel}
          </Sheet>
        ) : (
          <aside className="properties">{propertiesPanel}</aside>
        )}
      </main>

      <nav className="mobile-tool-bar mobile-only" aria-label="Editor tools">
        <button type="button" className={activeTool === "select" ? "mobile-tool mobile-tool--active" : "mobile-tool"} onClick={() => selectTool("select")}>
          <Icon name="select" /><span>Select</span>
        </button>
        <button type="button" className={activeTool === "wall" ? "mobile-tool mobile-tool--active" : "mobile-tool"} onClick={() => selectTool("wall")}>
          <Icon name="wall" /><span>Wall</span>
        </button>
        <button type="button" className={activeTool === "door" ? "mobile-tool mobile-tool--active" : "mobile-tool"} onClick={() => selectTool("door")}>
          <Icon name="opening" /><span>Door</span>
        </button>
        <button type="button" className={activeTool === "window" ? "mobile-tool mobile-tool--active" : "mobile-tool"} onClick={() => selectTool("window")}>
          <Icon name="opening" /><span>Window</span>
        </button>
        <button
          type="button"
          className={activeTool === "furniture" ? "mobile-tool mobile-tool--active" : "mobile-tool"}
          onClick={() => {
            openFurnitureTool();
            setMobilePropertiesOpen(true);
          }}
        >
          <Icon name="furniture" /><span>Furniture</span>
        </button>
      </nav>
    </div>
  );
}

interface PlanCanvasProps {
  blueprints: ReturnType<typeof projectLevel2D>["blueprints"];
  objects: ReturnType<typeof projectLevel2D>["objects"];
  objectAssetLabels: Readonly<Record<string, string>>;
  walls: ReturnType<typeof projectLevel2D>["walls"];
  openings: ReturnType<typeof projectLevel2D>["openings"];
  rooms: ReturnType<typeof projectLevel2D>["rooms"];
  topologyIssues: ReturnType<typeof projectLevel2D>["topologyIssues"];
  ghostProjection: ReturnType<typeof projectLevel2D> | null;
  ghostLabel: string | null;
  activeTool: EditorTool;
  selection: EditorSelection;
  hoveredTarget: SelectionTarget | null;
  selectedWallId: string | null;
  selectedWallStartVertexId: string | null;
  selectedWallEndVertexId: string | null;
  calibrationDraft: BlueprintCalibrationDraft | null;
  draftStart: PlanPoint | null;
  draftEnd: PlanPoint | null;
  snapPoint: PlanPoint | null;
  snapSource: PlanSnapResult["source"] | null;
  openingHover: OpeningWallPlacement | null;
  onPoint(point: PlanPoint): void;
  onSelectWall(wallId: string, additive?: boolean): void;
  onMoveWall(wallId: string, deltaXmm: number, deltaYmm: number): void;
  onMoveVertex(vertexId: string, xMm: number, yMm: number): void;
  onSelectRoom(roomKey: string, additive?: boolean): void;
  onSelectBlueprint(blueprintId: string, additive?: boolean): void;
  onMoveBlueprint(blueprintId: string, xMm: number, yMm: number): void;
  onSelectObject(objectId: string, additive?: boolean): void;
  onMoveObject(objectId: string, xMm: number, yMm: number): void;
  onHoverTarget(target: SelectionTarget | null): void;
  onClearSelection(): void;
  onPointerPosition(point: PlanPoint): void;
  onPointerLeave(): void;
  onCancel(): void;
  onExitTool(): void;
}

function PlanCanvas({
  blueprints,
  objects,
  objectAssetLabels,
  walls,
  openings,
  rooms,
  topologyIssues,
  ghostProjection,
  ghostLabel,
  activeTool,
  selection,
  hoveredTarget,
  selectedWallId,
  selectedWallStartVertexId,
  selectedWallEndVertexId,
  calibrationDraft,
  draftStart,
  draftEnd,
  snapPoint,
  snapSource,
  openingHover,
  onPoint,
  onSelectWall,
  onMoveWall,
  onMoveVertex,
  onSelectRoom,
  onSelectBlueprint,
  onMoveBlueprint,
  onSelectObject,
  onMoveObject,
  onHoverTarget,
  onClearSelection,
  onPointerPosition,
  onPointerLeave,
  onCancel,
  onExitTool,
}: PlanCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{
    pointerId: number;
    lastClientX: number;
    lastClientY: number;
  } | null>(null);
  const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    distance: number;
    midpointX: number;
    midpointY: number;
  } | null>(null);
  const multiTouchRef = useRef(false);
  const suppressedTouchPointersRef = useRef(new Set<number>());
  const touchToolTapRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    point: PlanPoint;
  } | null>(null);
  const itemDragRef = useRef<{
    pointerId: number;
    kind: "blueprint" | "object";
    id: string;
    startPlanXmm: number;
    startPlanYmm: number;
    originXmm: number;
    originYmm: number;
    currentXmm: number;
    currentYmm: number;
  } | null>(null);
  const [itemDragPreview, setItemDragPreview] = useState<{
    kind: "blueprint" | "object";
    id: string;
    xMm: number;
    yMm: number;
  } | null>(null);
  const vertexDragRef = useRef<{
    pointerId: number;
    vertexId: string;
    currentXmm: number;
    currentYmm: number;
  } | null>(null);
  const [vertexDragPreview, setVertexDragPreview] = useState<{
    vertexId: string;
    xMm: number;
    yMm: number;
  } | null>(null);
  const wallDragRef = useRef<{
    pointerId: number;
    wallId: string;
    startPlanXmm: number;
    startPlanYmm: number;
    deltaXmm: number;
    deltaYmm: number;
  } | null>(null);
  const [wallDragPreview, setWallDragPreview] = useState<{
    wallId: string;
    deltaXmm: number;
    deltaYmm: number;
  } | null>(null);
  const [camera, setCamera] = useState<PlanCamera2D>({ ...DEFAULT_PLAN_CAMERA });
  const [showTopologyIssues, setShowTopologyIssues] = useState(false);
  const [viewportSize, setViewportSize] = useState<ViewportSizePx>({
    width: 1040,
    height: 840,
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const updateSize = () => {
      setViewportSize({
        width: Math.max(1, svg.clientWidth),
        height: Math.max(1, svg.clientHeight),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const viewBox = planViewBox(camera, viewportSize);

  function clientToPlan(
    svg: SVGSVGElement,
    clientX: number,
    clientY: number,
  ): PlanPoint | null {
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;

    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { xMm: point.x, yMm: point.y };
  }

  function beginPan(event: ReactPointerEvent<SVGSVGElement>) {
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panRef.current = null;
  }

  function beginPlanItemDrag(
    event: ReactPointerEvent<SVGElement>,
    item: {
      kind: "blueprint" | "object";
      id: string;
      xMm: number;
      yMm: number;
      locked: boolean;
    },
  ) {
    if (activeTool !== "select" || event.button !== 0) return;
    if (event.pointerType === "touch" && multiTouchRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    const svg = svgRef.current;
    svg?.focus();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (item.kind === "blueprint") onSelectBlueprint(item.id, additive);
    else onSelectObject(item.id, additive);

    if (additive || item.locked) return;

    if (!svg) return;
    const point = clientToPlan(svg, event.clientX, event.clientY);
    if (!point) return;

    svg.setPointerCapture(event.pointerId);
    itemDragRef.current = {
      pointerId: event.pointerId,
      kind: item.kind,
      id: item.id,
      startPlanXmm: point.xMm,
      startPlanYmm: point.yMm,
      originXmm: item.xMm,
      originYmm: item.yMm,
      currentXmm: item.xMm,
      currentYmm: item.yMm,
    };
    setItemDragPreview({
      kind: item.kind,
      id: item.id,
      xMm: item.xMm,
      yMm: item.yMm,
    });
  }

  function updatePlanItemDrag(
    event: ReactPointerEvent<SVGSVGElement>,
  ): boolean {
    const drag = itemDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;

    const point = clientToPlan(event.currentTarget, event.clientX, event.clientY);
    if (!point) return true;

    drag.currentXmm = Math.round(
      drag.originXmm + point.xMm - drag.startPlanXmm,
    );
    drag.currentYmm = Math.round(
      drag.originYmm + point.yMm - drag.startPlanYmm,
    );
    setItemDragPreview({
      kind: drag.kind,
      id: drag.id,
      xMm: drag.currentXmm,
      yMm: drag.currentYmm,
    });
    return true;
  }

  function finishPlanItemDrag(
    event: ReactPointerEvent<SVGSVGElement>,
  ): boolean {
    const drag = itemDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    itemDragRef.current = null;
    setItemDragPreview(null);

    if (
      drag.currentXmm !== drag.originXmm ||
      drag.currentYmm !== drag.originYmm
    ) {
      if (drag.kind === "blueprint") {
        onMoveBlueprint(drag.id, drag.currentXmm, drag.currentYmm);
      } else {
        onMoveObject(drag.id, drag.currentXmm, drag.currentYmm);
      }
    }
    return true;
  }

  function cancelPlanItemDrag(event?: ReactPointerEvent<SVGSVGElement>) {
    const drag = itemDragRef.current;
    const svg = event?.currentTarget ?? svgRef.current;
    if (drag && svg?.hasPointerCapture(drag.pointerId)) {
      svg.releasePointerCapture(drag.pointerId);
    }
    itemDragRef.current = null;
    setItemDragPreview(null);
  }

  function beginWallDrag(
    event: ReactPointerEvent<SVGLineElement>,
    wallId: string,
  ) {
    if (activeTool !== "select" || event.button !== 0) return;
    if (event.pointerType === "touch" && multiTouchRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    onSelectWall(wallId, additive);
    if (additive) return;

    const svg = svgRef.current;
    if (!svg) return;
    const point = clientToPlan(svg, event.clientX, event.clientY);
    if (!point) return;

    svg.focus();
    svg.setPointerCapture(event.pointerId);
    wallDragRef.current = {
      pointerId: event.pointerId,
      wallId,
      startPlanXmm: point.xMm,
      startPlanYmm: point.yMm,
      deltaXmm: 0,
      deltaYmm: 0,
    };
    setWallDragPreview({ wallId, deltaXmm: 0, deltaYmm: 0 });
  }

  function updateWallDrag(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const drag = wallDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;

    const point = clientToPlan(event.currentTarget, event.clientX, event.clientY);
    if (!point) return true;
    drag.deltaXmm = Math.round(point.xMm - drag.startPlanXmm);
    drag.deltaYmm = Math.round(point.yMm - drag.startPlanYmm);
    setWallDragPreview({
      wallId: drag.wallId,
      deltaXmm: drag.deltaXmm,
      deltaYmm: drag.deltaYmm,
    });
    return true;
  }

  function finishWallDrag(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const drag = wallDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    wallDragRef.current = null;
    setWallDragPreview(null);
    if (drag.deltaXmm !== 0 || drag.deltaYmm !== 0) {
      onMoveWall(drag.wallId, drag.deltaXmm, drag.deltaYmm);
    }
    return true;
  }

  function cancelWallDrag(event?: ReactPointerEvent<SVGSVGElement>) {
    const drag = wallDragRef.current;
    const svg = event?.currentTarget ?? svgRef.current;
    if (drag && svg?.hasPointerCapture(drag.pointerId)) {
      svg.releasePointerCapture(drag.pointerId);
    }
    wallDragRef.current = null;
    setWallDragPreview(null);
  }

  function beginVertexDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    vertexId: string,
    xMm: number,
    yMm: number,
  ) {
    if (activeTool !== "select" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    vertexDragRef.current = {
      pointerId: event.pointerId,
      vertexId,
      currentXmm: Math.round(xMm),
      currentYmm: Math.round(yMm),
    };
    setVertexDragPreview({
      vertexId,
      xMm: Math.round(xMm),
      yMm: Math.round(yMm),
    });
  }

  function updateVertexDrag(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const drag = vertexDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;

    const point = clientToPlan(event.currentTarget, event.clientX, event.clientY);
    if (!point) return true;
    drag.currentXmm = Math.round(point.xMm);
    drag.currentYmm = Math.round(point.yMm);
    setVertexDragPreview({
      vertexId: drag.vertexId,
      xMm: drag.currentXmm,
      yMm: drag.currentYmm,
    });
    return true;
  }

  function finishVertexDrag(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const drag = vertexDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    vertexDragRef.current = null;
    setVertexDragPreview(null);
    onMoveVertex(drag.vertexId, drag.currentXmm, drag.currentYmm);
    return true;
  }

  function cancelVertexDrag(event?: ReactPointerEvent<SVGSVGElement>) {
    const drag = vertexDragRef.current;
    const svg = event?.currentTarget ?? svgRef.current;
    if (drag && svg?.hasPointerCapture(drag.pointerId)) {
      svg.releasePointerCapture(drag.pointerId);
    }
    vertexDragRef.current = null;
    setVertexDragPreview(null);
  }

  function beginTouchGesture(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "touch") return;

    touchPointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (touchPointersRef.current.size < 2) return;

    multiTouchRef.current = true;
    for (const pointerId of touchPointersRef.current.keys()) {
      suppressedTouchPointersRef.current.add(pointerId);
    }

    cancelPlanItemDrag(event);
    cancelWallDrag(event);
    cancelVertexDrag(event);

    const pan = panRef.current;
    if (pan && event.currentTarget.hasPointerCapture(pan.pointerId)) {
      event.currentTarget.releasePointerCapture(pan.pointerId);
    }
    panRef.current = null;

    const points = [...touchPointersRef.current.values()];
    const first = points[0];
    const second = points[1];
    if (!first || !second) return;

    pinchRef.current = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      midpointX: (first.x + second.x) / 2,
      midpointY: (first.y + second.y) / 2,
    };
  }

  function updateTouchGesture(event: ReactPointerEvent<SVGSVGElement>): boolean {
    if (event.pointerType !== "touch" || !touchPointersRef.current.has(event.pointerId)) {
      return false;
    }

    touchPointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (touchPointersRef.current.size < 2) {
      return suppressedTouchPointersRef.current.has(event.pointerId);
    }

    event.preventDefault();
    const points = [...touchPointersRef.current.values()];
    const first = points[0];
    const second = points[1];
    if (!first || !second) return true;

    const next = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      midpointX: (first.x + second.x) / 2,
      midpointY: (first.y + second.y) / 2,
    };
    const previous = pinchRef.current;
    pinchRef.current = next;
    if (!previous || previous.distance <= 0 || next.distance <= 0) return true;

    const anchor = clientToPlan(event.currentTarget, next.midpointX, next.midpointY);
    const zoomScale = Math.max(0.5, Math.min(2, previous.distance / next.distance));
    const xPx = next.midpointX - previous.midpointX;
    const yPx = next.midpointY - previous.midpointY;

    setCamera((current) => {
      const panned = panPlanCamera(current, { xPx, yPx });
      return anchor ? zoomPlanCameraAt(panned, anchor, zoomScale) : panned;
    });
    return true;
  }

  function endTouchGesture(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "touch") return;
    touchPointersRef.current.delete(event.pointerId);
    if (touchPointersRef.current.size < 2) {
      pinchRef.current = null;
      multiTouchRef.current = false;
    }
  }

  function fitPlan() {
    const points = [
      ...walls.flatMap((wall) => [
        { xMm: wall.x1Mm, yMm: wall.y1Mm },
        { xMm: wall.x2Mm, yMm: wall.y2Mm },
      ]),
      ...blueprints
        .filter((blueprint) => blueprint.visible)
        .flatMap(projectedBlueprintCorners),
      ...objects.flatMap(projectedObjectCorners),
    ];
    setCamera(fitPlanCamera(points, viewportSize));
  }

  return (
    <div className="plan-viewport">
      <svg
        ref={svgRef}
        className={`plan-canvas${activeTool === "select" ? "" : " plan-canvas--tool-active"}`}
        viewBox={`${viewBox.xMm} ${viewBox.yMm} ${viewBox.widthMm} ${viewBox.heightMm}`}
        role="application"
        aria-label="2D floor plan editor"
        tabIndex={0}
        onContextMenu={(event) => {
          if (activeTool === "select") return;
          event.preventDefault();
          onExitTool();
        }}
        onWheel={(event) => {
          event.preventDefault();
          const anchor = clientToPlan(
            event.currentTarget,
            event.clientX,
            event.clientY,
          );
          if (!anchor) return;

          const boundedDelta = Math.max(-240, Math.min(240, event.deltaY));
          const scale = Math.exp(boundedDelta * 0.0018);
          setCamera((current) => zoomPlanCameraAt(current, anchor, scale));
        }}
        onPointerDownCapture={beginTouchGesture}
        onPointerMoveCapture={(event) => {
          updateTouchGesture(event);
        }}
        onPointerUpCapture={endTouchGesture}
        onPointerCancelCapture={endTouchGesture}
        onPointerMove={(event) => {
          const pendingTap = touchToolTapRef.current;
          if (
            pendingTap?.pointerId === event.pointerId &&
            Math.hypot(
              event.clientX - pendingTap.startClientX,
              event.clientY - pendingTap.startClientY,
            ) > 8
          ) {
            touchToolTapRef.current = null;
          }
          if (updateTouchGesture(event)) return;
          if (updateVertexDrag(event)) return;
          if (updateWallDrag(event)) return;
          if (updatePlanItemDrag(event)) return;

          const pan = panRef.current;
          if (pan?.pointerId === event.pointerId) {
            const xPx = event.clientX - pan.lastClientX;
            const yPx = event.clientY - pan.lastClientY;
            pan.lastClientX = event.clientX;
            pan.lastClientY = event.clientY;
            setCamera((current) => panPlanCamera(current, { xPx, yPx }));
            return;
          }

          const point = clientToPlan(event.currentTarget, event.clientX, event.clientY);
          if (point) onPointerPosition(point);
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "touch" && multiTouchRef.current) return;
          const shouldPan =
            event.button === 1 || (activeTool === "select" && event.button === 0);
          if (shouldPan) {
            if (
              activeTool === "select" &&
              event.button === 0 &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey
            ) {
              onClearSelection();
            }
            beginPan(event);
            return;
          }

          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();

          const point = clientToPlan(event.currentTarget, event.clientX, event.clientY);
          if (!point) return;

          if (event.pointerType === "touch") {
            touchToolTapRef.current = {
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startClientY: event.clientY,
              point,
            };
            return;
          }

          onPoint(point);
        }}
        onPointerUp={(event) => {
          if (suppressedTouchPointersRef.current.delete(event.pointerId)) {
            if (touchToolTapRef.current?.pointerId === event.pointerId) {
              touchToolTapRef.current = null;
            }
            return;
          }

          const pendingTap = touchToolTapRef.current;
          if (pendingTap?.pointerId === event.pointerId) {
            touchToolTapRef.current = null;
            onPoint(pendingTap.point);
            return;
          }

          if (finishVertexDrag(event)) return;
          if (finishWallDrag(event)) return;
          if (finishPlanItemDrag(event)) return;
          endPan(event);
        }}
        onPointerCancel={(event) => {
          suppressedTouchPointersRef.current.delete(event.pointerId);
          if (touchToolTapRef.current?.pointerId === event.pointerId) {
            touchToolTapRef.current = null;
          }
          cancelVertexDrag(event);
          cancelWallDrag(event);
          cancelPlanItemDrag(event);
          endPan(event);
        }}
        onPointerLeave={() => {
          onHoverTarget(null);
          if (!panRef.current) onPointerLeave();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (vertexDragRef.current) {
            cancelVertexDrag();
            return;
          }
          if (wallDragRef.current) {
            cancelWallDrag();
            return;
          }
          if (itemDragRef.current) {
            cancelPlanItemDrag();
            return;
          }
          if (activeTool === "select") onCancel();
          else onExitTool();
        }}
      >
        <defs>
          <pattern id="minor-grid" width="100" height="100" patternUnits="userSpaceOnUse">
            <path d="M 100 0 L 0 0 0 100" className="grid-line grid-line--minor" />
          </pattern>
          <pattern id="major-grid" width="500" height="500" patternUnits="userSpaceOnUse">
            <rect width="500" height="500" fill="url(#minor-grid)" />
            <path d="M 500 0 L 0 0 0 500" className="grid-line grid-line--major" />
          </pattern>
        </defs>
        <rect
          x={viewBox.xMm}
          y={viewBox.yMm}
          width={viewBox.widthMm}
          height={viewBox.heightMm}
          fill="url(#major-grid)"
        />
        {rooms.map((room) => {
          const selected = isSelected(selection, "room", room.key);
          const hovered =
            hoveredTarget?.kind === "room" && hoveredTarget.id === room.key;
          return (
            <g key={room.key} className="plan-room">
              <polygon
                points={room.points.map((point) => `${point.xMm},${point.yMm}`).join(" ")}
                className={`plan-room__fill${selected ? " plan-room__fill--selected" : ""}${hovered ? " plan-room__fill--hovered" : ""}`}
                style={{
                  fill: room.floorColorHex ?? undefined,
                  opacity: room.floorColorHex ? 0.24 : undefined,
                }}
                onPointerDown={(event) => {
                  if (activeTool !== "select" || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.ownerSVGElement?.focus();
                  onSelectRoom(
                    room.key,
                    event.shiftKey || event.ctrlKey || event.metaKey,
                  );
                }}
                onPointerEnter={() =>
                  onHoverTarget({ kind: "room", id: room.key })
                }
                onPointerLeave={() => onHoverTarget(null)}
              />
              <text
                x={room.centerXmm}
                y={room.centerYmm}
                className="plan-room__label"
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {formatAreaSquareMetres(room.areaMm2)} m²
              </text>
            </g>
          );
        })}
        {blueprints
          .filter((blueprint) => blueprint.visible)
          .map((blueprint) => {
            const selected = isSelected(selection, "blueprint", blueprint.id);
            const hovered =
              hoveredTarget?.kind === "blueprint" &&
              hoveredTarget.id === blueprint.id;
            const preview =
              itemDragPreview?.kind === "blueprint" &&
              itemDragPreview.id === blueprint.id
                ? itemDragPreview
                : null;
            const originXmm = preview?.xMm ?? blueprint.xMm;
            const originYmm = preview?.yMm ?? blueprint.yMm;
            const drawXmm =
              originXmm + (blueprint.drawXmm - blueprint.xMm);
            const drawYmm =
              originYmm + (blueprint.drawYmm - blueprint.yMm);
            const transform =
              `rotate(${blueprint.rotationDeg} ${originXmm} ${originYmm})`;

            return (
              <g key={blueprint.id} transform={transform}>
                <svg
                  x={drawXmm}
                  y={drawYmm}
                  width={blueprint.widthMm}
                  height={blueprint.heightMm}
                  viewBox={`${blueprint.cropLeftPx} ${blueprint.cropTopPx} ${blueprint.cropWidthPx} ${blueprint.cropHeightPx}`}
                  preserveAspectRatio="none"
                  overflow="hidden"
                  opacity={blueprint.opacity}
                  className={`plan-blueprint${blueprint.locked ? " plan-blueprint--locked" : ""}${hovered ? " plan-blueprint--hovered" : ""}`}
                  onPointerEnter={() =>
                    onHoverTarget({ kind: "blueprint", id: blueprint.id })
                  }
                  onPointerLeave={() => onHoverTarget(null)}
                  onPointerDown={(event) =>
                    beginPlanItemDrag(event, {
                      kind: "blueprint",
                      id: blueprint.id,
                      xMm: blueprint.xMm,
                      yMm: blueprint.yMm,
                      locked: blueprint.locked,
                    })
                  }
                >
                  <image
                    href={assetContentUrl(blueprint.assetId)}
                    x={0}
                    y={0}
                    width={blueprint.sourceWidthPx}
                    height={blueprint.sourceHeightPx}
                    preserveAspectRatio="none"
                    pointerEvents="none"
                  />
                </svg>
                {selected ? (
                  <rect
                    x={drawXmm}
                    y={drawYmm}
                    width={blueprint.widthMm}
                    height={blueprint.heightMm}
                    className="plan-blueprint-selection"
                    pointerEvents="none"
                  />
                ) : null}
              </g>
            );
          })}
        {ghostProjection ? (
          <g className="plan-level-ghost" pointerEvents="none">
            {ghostProjection.walls.map((wall) => (
              <line
                key={wall.id}
                x1={wall.x1Mm}
                y1={wall.y1Mm}
                x2={wall.x2Mm}
                y2={wall.y2Mm}
                strokeWidth={Math.max(wall.thicknessMm, camera.mmPerPixel * 2)}
                className="plan-level-ghost__wall"
                strokeLinecap="square"
              />
            ))}
            {ghostProjection.openings.map((opening) => (
              <line
                key={opening.id}
                x1={opening.x1Mm}
                y1={opening.y1Mm}
                x2={opening.x2Mm}
                y2={opening.y2Mm}
                className="plan-level-ghost__opening"
              />
            ))}
          </g>
        ) : null}
        {objects.map((object) => {
          const selected = isSelected(selection, "object", object.id);
          const hovered =
            hoveredTarget?.kind === "object" && hoveredTarget.id === object.id;
          const preview =
            itemDragPreview?.kind === "object" &&
            itemDragPreview.id === object.id
              ? itemDragPreview
              : null;
          const xMm = preview?.xMm ?? object.centerXmm;
          const yMm = preview?.yMm ?? object.centerYmm;
          const label = objectAssetLabels[object.assetId] ?? "Object";

          return (
            <g
              key={object.id}
              transform={`translate(${xMm} ${yMm}) rotate(${object.rotationDeg})`}
              className={`plan-object${selected ? " plan-object--selected" : ""}${hovered ? " plan-object--hovered" : ""}${
                object.locked ? " plan-object--locked" : ""
              }`}
            >
              <rect
                x={-object.widthMm / 2}
                y={-object.depthMm / 2}
                width={object.widthMm}
                height={object.depthMm}
                rx={Math.min(80, object.widthMm / 10, object.depthMm / 10)}
                className="plan-object__footprint"
                onPointerEnter={() =>
                  onHoverTarget({ kind: "object", id: object.id })
                }
                onPointerLeave={() => onHoverTarget(null)}
                onPointerDown={(event) =>
                  beginPlanItemDrag(event, {
                    kind: "object",
                    id: object.id,
                    xMm: object.centerXmm,
                    yMm: object.centerYmm,
                    locked: object.locked,
                  })
                }
              />
              <line
                x1={-object.widthMm * 0.28}
                y1={-object.depthMm / 2}
                x2={object.widthMm * 0.28}
                y2={-object.depthMm / 2}
                className="plan-object__front"
                pointerEvents="none"
              />
              {selected ? (
                <text
                  x={0}
                  y={0}
                  className="plan-object__label"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  pointerEvents="none"
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
        {walls.map((wall) => {
          const selected = isSelected(selection, "wall", wall.id);
          const primary = wall.id === selectedWallId;
          const hovered =
            hoveredTarget?.kind === "wall" && hoveredTarget.id === wall.id;
          const drag =
            wallDragPreview?.wallId === wall.id ? wallDragPreview : null;
          const renderedWall = drag
            ? {
                ...wall,
                x1Mm: wall.x1Mm + drag.deltaXmm,
                y1Mm: wall.y1Mm + drag.deltaYmm,
                x2Mm: wall.x2Mm + drag.deltaXmm,
                y2Mm: wall.y2Mm + drag.deltaYmm,
              }
            : wall;
          const dimension = wallDimensionPosition(renderedWall);
          const materialEdges = wallMaterialEdges(renderedWall);

          return (
            <g key={wall.id}>
              <line
                x1={renderedWall.x1Mm}
                y1={renderedWall.y1Mm}
                x2={renderedWall.x2Mm}
                y2={renderedWall.y2Mm}
                strokeWidth={Math.max(wall.thicknessMm + 40, camera.mmPerPixel * 28)}
                className="plan-wall-hit"
                strokeLinecap="square"
                onPointerEnter={() =>
                  onHoverTarget({ kind: "wall", id: wall.id })
                }
                onPointerLeave={() => onHoverTarget(null)}
                onPointerDown={(event) => beginWallDrag(event, wall.id)}
              />
              <line
                x1={renderedWall.x1Mm}
                y1={renderedWall.y1Mm}
                x2={renderedWall.x2Mm}
                y2={renderedWall.y2Mm}
                strokeWidth={wall.thicknessMm}
                className={`plan-wall${selected ? " plan-wall--selected" : ""}${hovered ? " plan-wall--hovered" : ""}`}
                strokeLinecap="square"
                pointerEvents="none"
              />
              {wall.leftColorHex ? (
                <line
                  x1={materialEdges.left.x1Mm}
                  y1={materialEdges.left.y1Mm}
                  x2={materialEdges.left.x2Mm}
                  y2={materialEdges.left.y2Mm}
                  stroke={wall.leftColorHex}
                  strokeWidth={Math.max(14, camera.mmPerPixel * 3)}
                  className="plan-wall-material-edge"
                  pointerEvents="none"
                />
              ) : null}
              {wall.rightColorHex ? (
                <line
                  x1={materialEdges.right.x1Mm}
                  y1={materialEdges.right.y1Mm}
                  x2={materialEdges.right.x2Mm}
                  y2={materialEdges.right.y2Mm}
                  stroke={wall.rightColorHex}
                  strokeWidth={Math.max(14, camera.mmPerPixel * 3)}
                  className="plan-wall-material-edge"
                  pointerEvents="none"
                />
              ) : null}
              {primary ? (
                <text
                  x={dimension.xMm}
                  y={dimension.yMm}
                  className="wall-dimension-label"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  pointerEvents="none"
                >
                  {Math.round(wall.lengthMm)} mm
                </text>
              ) : null}
              {primary && selectedWallStartVertexId && selectedWallEndVertexId ? (
                <>
                  <circle
                    cx={
                      vertexDragPreview?.vertexId === selectedWallStartVertexId
                        ? vertexDragPreview.xMm
                        : renderedWall.x1Mm
                    }
                    cy={
                      vertexDragPreview?.vertexId === selectedWallStartVertexId
                        ? vertexDragPreview.yMm
                        : renderedWall.y1Mm
                    }
                    r={Math.max(70, camera.mmPerPixel * 8)}
                    className="wall-vertex-handle"
                    aria-label="Move wall start"
                    onPointerDown={(event) =>
                      beginVertexDrag(
                        event,
                        selectedWallStartVertexId,
                        renderedWall.x1Mm,
                        renderedWall.y1Mm,
                      )
                    }
                  />
                  <circle
                    cx={
                      vertexDragPreview?.vertexId === selectedWallEndVertexId
                        ? vertexDragPreview.xMm
                        : renderedWall.x2Mm
                    }
                    cy={
                      vertexDragPreview?.vertexId === selectedWallEndVertexId
                        ? vertexDragPreview.yMm
                        : renderedWall.y2Mm
                    }
                    r={Math.max(70, camera.mmPerPixel * 8)}
                    className="wall-vertex-handle"
                    aria-label="Move wall end"
                    onPointerDown={(event) =>
                      beginVertexDrag(
                        event,
                        selectedWallEndVertexId,
                        renderedWall.x2Mm,
                        renderedWall.y2Mm,
                      )
                    }
                  />
                </>
              ) : null}
            </g>
          );
        })}
        {openings.map((opening) => (
          <g key={opening.id} pointerEvents="none">
            <line
              x1={opening.x1Mm}
              y1={opening.y1Mm}
              x2={opening.x2Mm}
              y2={opening.y2Mm}
              strokeWidth={opening.wallThicknessMm + 28}
              className="plan-opening-cut"
              strokeLinecap="butt"
            />
            <line
              x1={opening.x1Mm}
              y1={opening.y1Mm}
              x2={opening.x2Mm}
              y2={opening.y2Mm}
              className={`plan-opening-symbol plan-opening-symbol--${opening.type}`}
            />
          </g>
        ))}
        {draftStart && draftEnd ? (
          <line
            x1={draftStart.xMm}
            y1={draftStart.yMm}
            x2={draftEnd.xMm}
            y2={draftEnd.yMm}
            strokeWidth={120}
            className="plan-wall-preview"
            strokeLinecap="square"
            pointerEvents="none"
          />
        ) : null}
        {snapPoint ? (
          <circle
            cx={snapPoint.xMm}
            cy={snapPoint.yMm}
            r={snapSource === "vertex" ? 85 : 65}
            className={`snap-marker snap-marker--${snapSource ?? "grid"}`}
            pointerEvents="none"
          />
        ) : null}
        {openingHover ? (
          <circle
            cx={openingHover.point.xMm}
            cy={openingHover.point.yMm}
            r={75}
            className="opening-marker"
            pointerEvents="none"
          />
        ) : null}
        {calibrationDraft?.firstPoint ? (
          <g className="blueprint-calibration" pointerEvents="none">
            <circle
              cx={calibrationDraft.firstPoint.xMm}
              cy={calibrationDraft.firstPoint.yMm}
              r={70}
            />
            {calibrationDraft.secondPoint ? (
              <>
                <line
                  x1={calibrationDraft.firstPoint.xMm}
                  y1={calibrationDraft.firstPoint.yMm}
                  x2={calibrationDraft.secondPoint.xMm}
                  y2={calibrationDraft.secondPoint.yMm}
                />
                <circle
                  cx={calibrationDraft.secondPoint.xMm}
                  cy={calibrationDraft.secondPoint.yMm}
                  r={70}
                />
              </>
            ) : null}
          </g>
        ) : null}
        {showTopologyIssues
          ? topologyIssues.map((issue, index) => (
              <g
                key={`${issue.type}:${issue.edgeIds.join(":")}:${index}`}
                className="topology-issue"
                pointerEvents="none"
              >
                <circle cx={issue.point.xMm} cy={issue.point.yMm} r={92} />
                <text
                  x={issue.point.xMm}
                  y={issue.point.yMm + 6}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  !
                </text>
              </g>
            ))
          : null}
      </svg>

      <div className="plan-viewport__status">
        {activeTool !== "select" ? (
          <div className="canvas-status-pill">
            <strong>{toolTitle("2d", activeTool, draftStart !== null)}</strong>
            <span>Right-click or Esc to finish</span>
          </div>
        ) : null}
        {topologyIssues.length > 0 ? (
          <button
            type="button"
            className={`topology-toggle${showTopologyIssues ? " topology-toggle--active" : ""}`}
            aria-pressed={showTopologyIssues}
            onClick={() => setShowTopologyIssues((current) => !current)}
            title="Wall crossings or overlaps that are not connected as clean shared endpoints"
          >
            <span className="topology-toggle__icon">!</span>
            <span>{topologyIssues.length} topology {topologyIssues.length === 1 ? "warning" : "warnings"}</span>
          </button>
        ) : null}
      </div>

      <div className="plan-viewport__controls">
        {ghostProjection && ghostLabel ? (
          <span className="plan-viewport__ghost-label">Ghost: {ghostLabel}</span>
        ) : null}
        <Button variant="secondary" onClick={fitPlan} title="Fit the complete plan in view">
          Fit
        </Button>
      </div>
    </div>
  );
}

interface ThreeViewportProps {
  document: ProjectDocument;
  levelId: string;
  levelScope: RoomSceneLevelScope;
  selection: EditorSelection;
  hoveredTarget: SelectionTarget | null;
  modelAssets: readonly RuntimeModelAsset[];
  showCeilings: boolean;
  onSelect(hit: RoomSceneHit | null, additive: boolean): void;
  onHover(hit: RoomSceneHit | null): void;
}

function ThreeViewport({
  document,
  levelId,
  levelScope,
  selection,
  hoveredTarget,
  modelAssets,
  showCeilings,
  onSelect,
  onHover,
}: ThreeViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<RoomSceneRenderer | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new RoomSceneRenderer(host);
    rendererRef.current = renderer;

    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setInteractionHandlers({ onSelect, onHover });
  }, [onSelect, onHover]);

  useEffect(() => {
    rendererRef.current?.setDocument(document, levelId, {
      levelScope,
      modelAssets,
      showCeilings,
    });
  }, [document, levelId, levelScope, modelAssets, showCeilings]);

  useEffect(() => {
    rendererRef.current?.setSelection(
      selectionIds(selection),
      selection.primary?.id ?? null,
    );
  }, [selection]);

  useEffect(() => {
    rendererRef.current?.setHover(hoveredTarget?.id ?? null);
  }, [hoveredTarget]);

  return <div ref={hostRef} className="three-viewport" aria-label="3D apartment view" />;
}

function endpointFromSnap(snap: PlanSnapResult) {
  if (snap.source === "vertex" && snap.vertexId) {
    return { kind: "existing" as const, vertexId: snap.vertexId };
  }

  return {
    kind: "new" as const,
    vertex: {
      id: createEntityId("vertex"),
      xMm: Math.round(snap.point.xMm),
      yMm: Math.round(snap.point.yMm),
    },
  };
}

function samePoint(a: PlanPoint, b: PlanPoint): boolean {
  return a.xMm === b.xMm && a.yMm === b.yMm;
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function projectedObjectCorners(
  object: ReturnType<typeof projectLevel2D>["objects"][number],
): PlanPoint[] {
  const radians = (object.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const halfWidth = object.widthMm / 2;
  const halfDepth = object.depthMm / 2;

  return [
    { xMm: -halfWidth, yMm: -halfDepth },
    { xMm: halfWidth, yMm: -halfDepth },
    { xMm: halfWidth, yMm: halfDepth },
    { xMm: -halfWidth, yMm: halfDepth },
  ].map((point) => ({
    xMm:
      object.centerXmm +
      cosine * point.xMm -
      sine * point.yMm,
    yMm:
      object.centerYmm +
      sine * point.xMm +
      cosine * point.yMm,
  }));
}

function projectedBlueprintCorners(
  blueprint: ReturnType<typeof projectLevel2D>["blueprints"][number],
): PlanPoint[] {
  const radians = (blueprint.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localPoints = [
    {
      xMm: blueprint.drawXmm - blueprint.xMm,
      yMm: blueprint.drawYmm - blueprint.yMm,
    },
    {
      xMm: blueprint.drawXmm - blueprint.xMm + blueprint.widthMm,
      yMm: blueprint.drawYmm - blueprint.yMm,
    },
    {
      xMm: blueprint.drawXmm - blueprint.xMm + blueprint.widthMm,
      yMm: blueprint.drawYmm - blueprint.yMm + blueprint.heightMm,
    },
    {
      xMm: blueprint.drawXmm - blueprint.xMm,
      yMm: blueprint.drawYmm - blueprint.yMm + blueprint.heightMm,
    },
  ];

  return localPoints.map((point) => ({
    xMm: blueprint.xMm + cosine * point.xMm - sine * point.yMm,
    yMm: blueprint.yMm + sine * point.xMm + cosine * point.yMm,
  }));
}

function wallMaterialEdges(
  wall: ReturnType<typeof projectLevel2D>["walls"][number],
) {
  const dx = wall.x2Mm - wall.x1Mm;
  const dy = wall.y2Mm - wall.y1Mm;
  const length = Math.max(wall.lengthMm, 1);
  const normalX = -dy / length;
  const normalY = dx / length;
  const offset = wall.thicknessMm / 2;

  return {
    left: {
      x1Mm: wall.x1Mm + normalX * offset,
      y1Mm: wall.y1Mm + normalY * offset,
      x2Mm: wall.x2Mm + normalX * offset,
      y2Mm: wall.y2Mm + normalY * offset,
    },
    right: {
      x1Mm: wall.x1Mm - normalX * offset,
      y1Mm: wall.y1Mm - normalY * offset,
      x2Mm: wall.x2Mm - normalX * offset,
      y2Mm: wall.y2Mm - normalY * offset,
    },
  };
}

function wallDimensionPosition(wall: ReturnType<typeof projectLevel2D>["walls"][number]) {
  const dx = wall.x2Mm - wall.x1Mm;
  const dy = wall.y2Mm - wall.y1Mm;
  const length = Math.max(wall.lengthMm, 1);
  const normalX = -dy / length;
  const normalY = dx / length;

  return {
    xMm: (wall.x1Mm + wall.x2Mm) / 2 + normalX * 280,
    yMm: (wall.y1Mm + wall.y2Mm) / 2 + normalY * 280,
  };
}

function toolTitle(viewMode: ViewMode, activeTool: EditorTool, hasDraft: boolean): string {
  if (viewMode === "3d") return "3D view";
  if (activeTool === "select") return "Select and edit";
  if (activeTool === "blueprint-calibrate") return "Calibrate blueprint";
  if (activeTool === "furniture") return "Place furniture";
  if (activeTool === "wall") return hasDraft ? "Continue wall" : "Draw wall";
  if (activeTool === "door") return "Place door";
  if (activeTool === "window") return "Place window";
  return "Select a tool";
}

function toolHelp(viewMode: ViewMode, activeTool: EditorTool, hasDraft: boolean): string {
  if (viewMode === "3d") return "Drag to orbit. Scroll to zoom. The selected wall remains highlighted.";
  if (activeTool === "select") return "Click a wall or blueprint to inspect it.";
  if (activeTool === "blueprint-calibrate") {
    return "Click two points with a known real-world distance, then enter that distance.";
  }
  if (activeTool === "furniture") {
    return "Choose a furniture type, then click the plan. Placed furniture can be selected, dragged and resized.";
  }
  if (activeTool === "wall") {
    return hasDraft
      ? "Choose the next endpoint. Right-click or Escape finishes drawing and returns to Select."
      : "Choose the first endpoint. Points snap to vertices and the grid. Right-click exits Wall mode.";
  }
  if (activeTool === "door") return "Click near a wall to place a 900 × 2100 mm door.";
  if (activeTool === "window") return "Click near a wall to place a 1200 × 1200 mm window with a 900 mm sill.";
  return "Choose Select, Wall, Door or Window, or import a Blueprint.";
}


function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function formatAreaSquareMetres(areaMm2: number): string {
  const areaM2 = areaMm2 / 1_000_000;
  return areaM2.toLocaleString(undefined, {
    minimumFractionDigits: areaM2 < 10 ? 2 : 1,
    maximumFractionDigits: 2,
  });
}

function downloadTextFile(
  fileName: string,
  contents: string,
  contentType: string,
): void {
  downloadBlob(fileName, new Blob([contents], { type: contentType }));
}

function downloadBinaryFile(
  fileName: string,
  contents: ArrayBuffer,
  contentType: string,
): void {
  downloadBlob(fileName, new Blob([contents], { type: contentType }));
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function saveStateLabel(state: SaveState): string {
  switch (state) {
    case "loading":
      return "Loading";
    case "saved":
      return "Saved";
    case "unsaved":
      return "Unsaved";
    case "saving":
      return "Saving";
    case "conflict":
      return "Conflict";
    case "error":
      return "Save error";
  }
}

function getOrCreateProjectId(): string {
  const existing = window.localStorage.getItem(CURRENT_PROJECT_KEY);
  if (existing) return existing;

  const id = createEntityId("project");
  window.localStorage.setItem(CURRENT_PROJECT_KEY, id);
  return id;
}

