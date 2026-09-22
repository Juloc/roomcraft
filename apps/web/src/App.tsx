import {
  createEmptyProject,
  type BlueprintReference,
  type Opening,
  type ProjectDocument,
} from "@roomcraft/document";
import {
  AddBlueprintCommand,
  AddLevelCommand,
  AddOpeningCommand,
  AddWallCommand,
  CalibrateBlueprintCommand,
  EMPTY_SELECTION,
  RemoveLevelCommand,
  SetWallLengthCommand,
  UpdateBlueprintCommand,
  UpdateLevelCommand,
  DEFAULT_PLAN_CAMERA,
  fitPlanCamera,
  panPlanCamera,
  planViewBox,
  selectOnly,
  snapOpeningToWall,
  zoomPlanCameraAt,
  snapPlanPoint,
  type EditorSelection,
  type OpeningWallPlacement,
  type PlanCamera2D,
  type PlanSnapResult,
  type ViewportSizePx,
} from "@roomcraft/editor-core";
import { projectLevel2D } from "@roomcraft/render-2d";
import { RoomSceneRenderer } from "@roomcraft/render-3d";
import {
  Button,
  LengthField,
  NumberField,
  Panel,
  SegmentedControl,
  Toolbar,
} from "@roomcraft/ui";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { assetContentUrl, readImageDimensions, uploadBlueprintAsset } from "./assets-api";
import { useProjectSession, type SaveState } from "./use-project-session";

type ViewMode = "2d" | "3d";
type EditorTool = "select" | "wall" | "door" | "window" | "blueprint-calibrate";
type PlanPoint = PlanSnapResult["point"];

interface WallDraft {
  start: PlanSnapResult;
}

interface BlueprintCalibrationDraft {
  blueprintId: string;
  firstPoint: PlanPoint | null;
  secondPoint: PlanPoint | null;
}

const VIEW_OPTIONS = [
  { value: "2d", label: "2D" },
  { value: "3d", label: "3D" },
] as const;

const OPENING_PRESETS = {
  door: { widthMm: 900, heightMm: 2100, sillHeightMm: 0 } as const,
  window: { widthMm: 1200, heightMm: 1200, sillHeightMm: 900 } as const,
};

const CURRENT_PROJECT_KEY = "roomcraft.currentProjectId";

export function App() {
  const session = useProjectSession(() =>
    createEmptyProject(getOrCreateProjectId(), "My apartment"),
  );
  const { document, revision, saveState, saveError } = session;

  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>("select");
  const [selection, setSelection] = useState<EditorSelection>(EMPTY_SELECTION);
  const blueprintFileRef = useRef<HTMLInputElement | null>(null);
  const [blueprintImportState, setBlueprintImportState] = useState<"idle" | "uploading">("idle");
  const [blueprintImportError, setBlueprintImportError] = useState<string | null>(null);
  const [calibrationDraft, setCalibrationDraft] = useState<BlueprintCalibrationDraft | null>(null);
  const [wallDraft, setWallDraft] = useState<WallDraft | null>(null);
  const [hoverSnap, setHoverSnap] = useState<PlanSnapResult | null>(null);
  const [openingHover, setOpeningHover] = useState<OpeningWallPlacement | null>(null);

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
  const selectedWallId =
    selection.primary?.kind === "wall" &&
    projection.walls.some((wall) => wall.id === selection.primary?.id)
      ? selection.primary.id
      : null;
  const selectedWall =
    selectedWallId === null
      ? null
      : projection.walls.find((wall) => wall.id === selectedWallId) ?? null;
  const selectedBlueprintId =
    selection.primary?.kind === "blueprint" &&
    level.blueprints.some((blueprint) => blueprint.id === selection.primary?.id)
      ? selection.primary.id
      : null;
  const selectedBlueprint =
    selectedBlueprintId === null
      ? null
      : level.blueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? null;

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
        },
      }),
    );

    cancelTransient();
    setSelection(EMPTY_SELECTION);
    setActiveLevelId(id);
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
      new AddWallCommand({
        levelId,
        wallId: createEntityId("wall"),
        start,
        end,
        thicknessMm: 120,
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

  function selectBlueprint(blueprintId: string) {
    setSelection(selectOnly({ kind: "blueprint", id: blueprintId }));
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

  function updateSelectedBlueprint(changes: Partial<BlueprintReference>) {
    if (!selectedBlueprint) return;
    session.execute(
      new UpdateBlueprintCommand({
        levelId,
        blueprint: { ...selectedBlueprint, ...changes },
      }),
    );
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

  function cancelTransient() {
    setWallDraft(null);
    setHoverSnap(null);
    setOpeningHover(null);
    setCalibrationDraft(null);
  }

  function selectTool(tool: EditorTool) {
    cancelTransient();
    setActiveTool(tool);
    setViewMode("2d");
  }

  function selectWall(wallId: string) {
    setSelection(selectOnly({ kind: "wall", id: wallId }));
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
        anchor: "start",
      }),
    );
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <strong>RoomCraft</strong>
          <span>{document.name}</span>
        </div>

        <Toolbar>
          <Button variant="ghost" onClick={undo} disabled={!session.canUndo}>
            Undo
          </Button>
          <Button variant="ghost" onClick={redo} disabled={!session.canRedo}>
            Redo
          </Button>
          <Button
            variant="primary"
            onClick={() => void session.saveNow()}
            disabled={saveState === "saving" || saveState === "saved"}
          >
            {saveState === "saving" ? "Saving…" : "Save"}
          </Button>
          <span className={`save-state save-state--${saveState}`} title={saveError ?? undefined}>
            {saveStateLabel(saveState)}
          </span>
          <SegmentedControl
            value={viewMode}
            options={VIEW_OPTIONS}
            onChange={changeView}
            ariaLabel="Editor view"
          />
        </Toolbar>
      </header>

      <main className="editor-layout">
        <aside className="tool-rail" aria-label="Drawing tools">
          <Button
            variant={activeTool === "select" ? "primary" : "ghost"}
            onClick={() => selectTool("select")}
            title="Select and edit plan elements"
          >
            Select
          </Button>
          <Button
            variant={activeTool === "wall" ? "primary" : "ghost"}
            onClick={() => selectTool("wall")}
            title="Draw connected walls"
          >
            Wall
          </Button>
          <Button
            variant={activeTool === "door" ? "primary" : "ghost"}
            onClick={() => selectTool("door")}
            title="Place a 900 mm door on a wall"
          >
            Door
          </Button>
          <Button
            variant={activeTool === "window" ? "primary" : "ghost"}
            onClick={() => selectTool("window")}
            title="Place a 1200 mm window on a wall"
          >
            Window
          </Button>
          <Button
            variant="ghost"
            disabled={blueprintImportState === "uploading"}
            onClick={() => blueprintFileRef.current?.click()}
            title="Import a floor plan image and calibrate it"
          >
            {blueprintImportState === "uploading" ? "Uploading…" : "Blueprint"}
          </Button>
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
          <Button variant="ghost" disabled title="Furniture placement is not implemented yet">
            Furniture
          </Button>
        </aside>

        <section className="workspace" aria-label="Planning workspace">
          {viewMode === "2d" ? (
            <PlanCanvas
              blueprints={projection.blueprints}
              walls={projection.walls}
              openings={projection.openings}
              rooms={projection.rooms}
              topologyIssues={projection.topologyIssues}
              activeTool={activeTool}
              selectedWallId={selectedWallId}
              selectedBlueprintId={selectedBlueprintId}
              calibrationDraft={calibrationDraft}
              draftStart={wallDraft?.start.point ?? null}
              draftEnd={wallDraft ? hoverSnap?.point ?? wallDraft.start.point : null}
              snapPoint={hoverSnap?.point ?? null}
              snapSource={hoverSnap?.source ?? null}
              openingHover={openingHover}
              onPoint={handlePlanPoint}
              onSelectWall={selectWall}
              onSelectBlueprint={selectBlueprint}
              onMoveBlueprint={moveBlueprint}
              onClearSelection={clearSelection}
              onPointerPosition={handlePlanPointerMove}
              onPointerLeave={handlePlanPointerLeave}
              onCancel={cancelTransient}
            />
          ) : (
            <ThreeViewport document={document} levelId={levelId} selectedId={selectedWallId} />
          )}
        </section>

        <aside className="properties">
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
                    variant="ghost"
                    disabled={document.levels.length <= 1}
                    onClick={removeActiveLevel}
                  >
                    Delete level
                  </Button>
                </div>
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

              {blueprintImportError ? (
                <div className="inline-error" role="alert">
                  {blueprintImportError}
                </div>
              ) : null}

              {selectedWall ? (
                <div className="selection-properties">
                  <span className="eyebrow">Selected wall</span>
                  <LengthField
                    label="Length"
                    valueMm={Math.round(selectedWall.lengthMm)}
                    minMm={100}
                    helpText="The start vertex stays fixed; connected walls at the moved endpoint follow it."
                    onCommit={setSelectedWallLength}
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

              <div className="tool-status" aria-live="polite">
                <strong>{toolTitle(viewMode, activeTool, wallDraft !== null)}</strong>
                <span>{toolHelp(viewMode, activeTool, wallDraft !== null)}</span>
              </div>
            </div>
          </Panel>
        </aside>
      </main>
    </div>
  );
}

interface PlanCanvasProps {
  blueprints: ReturnType<typeof projectLevel2D>["blueprints"];
  walls: ReturnType<typeof projectLevel2D>["walls"];
  openings: ReturnType<typeof projectLevel2D>["openings"];
  rooms: ReturnType<typeof projectLevel2D>["rooms"];
  topologyIssues: ReturnType<typeof projectLevel2D>["topologyIssues"];
  activeTool: EditorTool;
  selectedWallId: string | null;
  selectedBlueprintId: string | null;
  calibrationDraft: BlueprintCalibrationDraft | null;
  draftStart: PlanPoint | null;
  draftEnd: PlanPoint | null;
  snapPoint: PlanPoint | null;
  snapSource: PlanSnapResult["source"] | null;
  openingHover: OpeningWallPlacement | null;
  onPoint(point: PlanPoint): void;
  onSelectWall(wallId: string): void;
  onSelectBlueprint(blueprintId: string): void;
  onMoveBlueprint(blueprintId: string, xMm: number, yMm: number): void;
  onClearSelection(): void;
  onPointerPosition(point: PlanPoint): void;
  onPointerLeave(): void;
  onCancel(): void;
}

function PlanCanvas({
  blueprints,
  walls,
  openings,
  rooms,
  topologyIssues,
  activeTool,
  selectedWallId,
  selectedBlueprintId,
  calibrationDraft,
  draftStart,
  draftEnd,
  snapPoint,
  snapSource,
  openingHover,
  onPoint,
  onSelectWall,
  onSelectBlueprint,
  onMoveBlueprint,
  onClearSelection,
  onPointerPosition,
  onPointerLeave,
  onCancel,
}: PlanCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{
    pointerId: number;
    lastClientX: number;
    lastClientY: number;
  } | null>(null);
  const blueprintDragRef = useRef<{
    pointerId: number;
    blueprintId: string;
    startPlanXmm: number;
    startPlanYmm: number;
    originXmm: number;
    originYmm: number;
    currentXmm: number;
    currentYmm: number;
  } | null>(null);
  const [blueprintDragPreview, setBlueprintDragPreview] = useState<{
    blueprintId: string;
    xMm: number;
    yMm: number;
  } | null>(null);
  const [camera, setCamera] = useState<PlanCamera2D>({ ...DEFAULT_PLAN_CAMERA });
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

  function beginBlueprintDrag(
    event: ReactPointerEvent<SVGElement>,
    blueprint: ReturnType<typeof projectLevel2D>["blueprints"][number],
  ) {
    if (activeTool !== "select" || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    onSelectBlueprint(blueprint.id);

    if (blueprint.locked) return;

    const svg = svgRef.current;
    if (!svg) return;
    const point = clientToPlan(svg, event.clientX, event.clientY);
    if (!point) return;

    svg.setPointerCapture(event.pointerId);
    blueprintDragRef.current = {
      pointerId: event.pointerId,
      blueprintId: blueprint.id,
      startPlanXmm: point.xMm,
      startPlanYmm: point.yMm,
      originXmm: blueprint.xMm,
      originYmm: blueprint.yMm,
      currentXmm: blueprint.xMm,
      currentYmm: blueprint.yMm,
    };
    setBlueprintDragPreview({
      blueprintId: blueprint.id,
      xMm: blueprint.xMm,
      yMm: blueprint.yMm,
    });
  }

  function updateBlueprintDrag(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const drag = blueprintDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;

    const point = clientToPlan(event.currentTarget, event.clientX, event.clientY);
    if (!point) return true;

    drag.currentXmm = Math.round(
      drag.originXmm + point.xMm - drag.startPlanXmm,
    );
    drag.currentYmm = Math.round(
      drag.originYmm + point.yMm - drag.startPlanYmm,
    );
    setBlueprintDragPreview({
      blueprintId: drag.blueprintId,
      xMm: drag.currentXmm,
      yMm: drag.currentYmm,
    });
    return true;
  }

  function finishBlueprintDrag(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const drag = blueprintDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    blueprintDragRef.current = null;
    setBlueprintDragPreview(null);

    if (drag.currentXmm !== drag.originXmm || drag.currentYmm !== drag.originYmm) {
      onMoveBlueprint(drag.blueprintId, drag.currentXmm, drag.currentYmm);
    }
    return true;
  }

  function cancelBlueprintDrag(event?: ReactPointerEvent<SVGSVGElement>) {
    const drag = blueprintDragRef.current;
    const svg = event?.currentTarget ?? svgRef.current;
    if (drag && svg?.hasPointerCapture(drag.pointerId)) {
      svg.releasePointerCapture(drag.pointerId);
    }
    blueprintDragRef.current = null;
    setBlueprintDragPreview(null);
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
        onPointerMove={(event) => {
          if (updateBlueprintDrag(event)) return;

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
          const shouldPan =
            event.button === 1 || (activeTool === "select" && event.button === 0);
          if (shouldPan) {
            if (activeTool === "select" && event.button === 0) onClearSelection();
            beginPan(event);
            return;
          }

          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();

          const point = clientToPlan(event.currentTarget, event.clientX, event.clientY);
          if (!point) return;
          onPoint(point);
        }}
        onPointerUp={(event) => {
          if (finishBlueprintDrag(event)) return;
          endPan(event);
        }}
        onPointerCancel={(event) => {
          cancelBlueprintDrag(event);
          endPan(event);
        }}
        onPointerLeave={() => {
          if (!panRef.current) onPointerLeave();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (blueprintDragRef.current) {
            cancelBlueprintDrag();
            return;
          }
          onCancel();
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
        {blueprints
          .filter((blueprint) => blueprint.visible)
          .map((blueprint) => {
            const selected = blueprint.id === selectedBlueprintId;
            const preview =
              blueprintDragPreview?.blueprintId === blueprint.id
                ? blueprintDragPreview
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
                  className={`plan-blueprint${blueprint.locked ? " plan-blueprint--locked" : ""}`}
                  onPointerDown={(event) => beginBlueprintDrag(event, blueprint)}
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
        {rooms.map((room) => (
          <g key={room.key} className="plan-room" pointerEvents="none">
            <polygon
              points={room.points.map((point) => `${point.xMm},${point.yMm}`).join(" ")}
              className="plan-room__fill"
            />
            <text
              x={room.centerXmm}
              y={room.centerYmm}
              className="plan-room__label"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {formatAreaSquareMetres(room.areaMm2)} m²
            </text>
          </g>
        ))}
        {walls.map((wall) => {
          const selected = wall.id === selectedWallId;
          const dimension = wallDimensionPosition(wall);

          return (
            <g key={wall.id}>
              <line
                x1={wall.x1Mm}
                y1={wall.y1Mm}
                x2={wall.x2Mm}
                y2={wall.y2Mm}
                strokeWidth={Math.max(wall.thicknessMm + 40, camera.mmPerPixel * 28)}
                className="plan-wall-hit"
                strokeLinecap="square"
                onPointerDown={(event) => {
                  if (activeTool !== "select" || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectWall(wall.id);
                }}
              />
              <line
                x1={wall.x1Mm}
                y1={wall.y1Mm}
                x2={wall.x2Mm}
                y2={wall.y2Mm}
                strokeWidth={wall.thicknessMm}
                className={`plan-wall${selected ? " plan-wall--selected" : ""}`}
                strokeLinecap="square"
                pointerEvents="none"
              />
              {selected ? (
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
        {topologyIssues.map((issue, index) => (
          <g
            key={`${issue.type}:${issue.edgeIds.join(":")}:${index}`}
            className="topology-issue"
            pointerEvents="none"
          >
            <circle cx={issue.point.xMm} cy={issue.point.yMm} r={105} />
            <line
              x1={issue.point.xMm - 55}
              y1={issue.point.yMm - 55}
              x2={issue.point.xMm + 55}
              y2={issue.point.yMm + 55}
            />
            <line
              x1={issue.point.xMm + 55}
              y1={issue.point.yMm - 55}
              x2={issue.point.xMm - 55}
              y2={issue.point.yMm + 55}
            />
          </g>
        ))}
      </svg>

      <div className="plan-viewport__controls">
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
  selectedId: string | null;
}

function ThreeViewport({ document, levelId, selectedId }: ThreeViewportProps) {
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
    rendererRef.current?.setDocument(document, levelId);
  }, [document, levelId]);

  useEffect(() => {
    rendererRef.current?.setSelection(selectedId);
  }, [selectedId]);

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
  if (activeTool === "wall") {
    return hasDraft
      ? "Choose the next endpoint. Escape cancels the chain."
      : "Choose the first endpoint. Points snap to vertices and the grid.";
  }
  if (activeTool === "door") return "Click near a wall to place a 900 × 2100 mm door.";
  if (activeTool === "window") return "Click near a wall to place a 1200 × 1200 mm window with a 900 mm sill.";
  return "Choose Select, Wall, Door or Window, or import a Blueprint.";
}

function formatAreaSquareMetres(areaMm2: number): string {
  const areaM2 = areaMm2 / 1_000_000;
  return areaM2.toLocaleString(undefined, {
    minimumFractionDigits: areaM2 < 10 ? 2 : 1,
    maximumFractionDigits: 2,
  });
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

function createEntityId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
