import { createEmptyProject } from "@roomcraft/document";
import {
  AddWallCommand,
  CommandHistory,
  snapPlanPoint,
  type PlanSnapResult,
} from "@roomcraft/editor-core";
import { projectLevel2D } from "@roomcraft/render-2d";
import { Button, Panel, SegmentedControl, Toolbar } from "@roomcraft/ui";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type ViewMode = "2d" | "3d";
type EditorTool = "wall" | null;
type PlanPoint = PlanSnapResult["point"];

interface WallDraft {
  start: PlanSnapResult;
}

const VIEW_OPTIONS = [
  { value: "2d", label: "2D" },
  { value: "3d", label: "3D" },
] as const;

export function App() {
  const historyRef = useRef<CommandHistory | null>(null);
  if (!historyRef.current) {
    historyRef.current = new CommandHistory(createEmptyProject("project_local", "My apartment"));
  }

  const history = historyRef.current;
  const [document, setDocument] = useState(history.document);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [activeTool, setActiveTool] = useState<EditorTool>("wall");
  const [wallDraft, setWallDraft] = useState<WallDraft | null>(null);
  const [hoverSnap, setHoverSnap] = useState<PlanSnapResult | null>(null);

  const level = document.levels[0];
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

  function currentLevel() {
    return history.document.levels.find((candidate) => candidate.id === levelId) ?? null;
  }

  function snap(point: PlanPoint): PlanSnapResult | null {
    const current = currentLevel();
    if (!current) return null;

    return snapPlanPoint(point, current, {
      gridSizeMm: history.document.settings.gridSizeMm,
    });
  }

  function handlePlanPointerMove(point: PlanPoint) {
    if (activeTool !== "wall") return;
    setHoverSnap(snap(point));
  }

  function handlePlanPointerLeave() {
    setHoverSnap(null);
  }

  function handlePlanPoint(point: PlanPoint) {
    if (activeTool !== "wall") return;

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
    const next = history.execute(
      new AddWallCommand({
        levelId,
        wallId: createEntityId("wall"),
        start,
        end,
        thicknessMm: 120,
      }),
    );

    setDocument(next);

    const endVertexId = end.kind === "existing" ? end.vertexId : end.vertex.id;
    const chainedStart: PlanSnapResult = {
      point: snapped.point,
      source: "vertex",
      vertexId: endVertexId,
    };
    setWallDraft({ start: chainedStart });
    setHoverSnap(chainedStart);
  }

  function cancelDrawing() {
    setWallDraft(null);
    setHoverSnap(null);
  }

  function toggleWallTool() {
    if (activeTool === "wall") {
      setActiveTool(null);
      cancelDrawing();
    } else {
      setActiveTool("wall");
      setViewMode("2d");
    }
  }

  function changeView(mode: ViewMode) {
    setViewMode(mode);
    if (mode !== "2d") cancelDrawing();
  }

  function undo() {
    cancelDrawing();
    setDocument(history.undo());
  }

  function redo() {
    cancelDrawing();
    setDocument(history.redo());
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <strong>RoomCraft</strong>
          <span>{document.name}</span>
        </div>

        <Toolbar>
          <Button variant="ghost" onClick={undo} disabled={!history.canUndo}>
            Undo
          </Button>
          <Button variant="ghost" onClick={redo} disabled={!history.canRedo}>
            Redo
          </Button>
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
            variant={activeTool === "wall" ? "primary" : "ghost"}
            onClick={toggleWallTool}
            title="Draw connected walls"
          >
            Wall
          </Button>
          <Button variant="ghost" disabled title="Door placement is not implemented yet">
            Door
          </Button>
          <Button variant="ghost" disabled title="Furniture placement is not implemented yet">
            Furniture
          </Button>
        </aside>

        <section className="workspace" aria-label="Planning workspace">
          {viewMode === "2d" ? (
            <PlanCanvas
              walls={projection.walls}
              wallToolActive={activeTool === "wall"}
              draftStart={wallDraft?.start.point ?? null}
              draftEnd={wallDraft ? hoverSnap?.point ?? wallDraft.start.point : null}
              snapPoint={hoverSnap?.point ?? null}
              snapSource={hoverSnap?.source ?? null}
              onPoint={handlePlanPoint}
              onPointerPosition={handlePlanPointerMove}
              onPointerLeave={handlePlanPointerLeave}
              onCancel={cancelDrawing}
            />
          ) : (
            <div className="viewport-placeholder">
              <strong>3D viewport</strong>
              <span>Uses the same project document. Three.js projection is the next slice.</span>
            </div>
          )}
        </section>

        <aside className="properties">
          <Panel>
            <div className="properties__content">
              <div>
                <span className="eyebrow">Level</span>
                <h2>{level.name}</h2>
              </div>

              <dl className="stats">
                <div>
                  <dt>Walls</dt>
                  <dd>{level.walls.length}</dd>
                </div>
                <div>
                  <dt>Height</dt>
                  <dd>{level.defaultWallHeightMm} mm</dd>
                </div>
                <div>
                  <dt>Grid</dt>
                  <dd>{document.settings.gridSizeMm} mm</dd>
                </div>
                <div>
                  <dt>Wall</dt>
                  <dd>120 mm</dd>
                </div>
              </dl>

              <div className="tool-status" aria-live="polite">
                <strong>{wallDraft ? "Continue wall" : "Draw wall"}</strong>
                <span>
                  {activeTool === "wall"
                    ? wallDraft
                      ? "Choose the next endpoint. Escape cancels the chain."
                      : "Choose the first endpoint. Points snap to vertices and the grid."
                    : "Select the Wall tool to start drawing."}
                </span>
              </div>
            </div>
          </Panel>
        </aside>
      </main>
    </div>
  );
}

interface PlanCanvasProps {
  walls: ReturnType<typeof projectLevel2D>["walls"];
  wallToolActive: boolean;
  draftStart: PlanPoint | null;
  draftEnd: PlanPoint | null;
  snapPoint: PlanPoint | null;
  snapSource: PlanSnapResult["source"] | null;
  onPoint(point: PlanPoint): void;
  onPointerPosition(point: PlanPoint): void;
  onPointerLeave(): void;
  onCancel(): void;
}

function PlanCanvas({
  walls,
  wallToolActive,
  draftStart,
  draftEnd,
  snapPoint,
  snapSource,
  onPoint,
  onPointerPosition,
  onPointerLeave,
  onCancel,
}: PlanCanvasProps) {
  function pointerPoint(event: ReactPointerEvent<SVGSVGElement>): PlanPoint | null {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return null;

    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { xMm: point.x, yMm: point.y };
  }

  return (
    <svg
      className={`plan-canvas${wallToolActive ? " plan-canvas--wall-tool" : ""}`}
      viewBox="-600 -600 5200 4200"
      role="application"
      aria-label="2D floor plan editor"
      tabIndex={0}
      onPointerMove={(event) => {
        const point = pointerPoint(event);
        if (point) onPointerPosition(point);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const point = pointerPoint(event);
        if (!point) return;
        event.preventDefault();
        event.currentTarget.focus();
        onPoint(point);
      }}
      onPointerLeave={onPointerLeave}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
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
      <rect x="-600" y="-600" width="5200" height="4200" fill="url(#major-grid)" />
      {walls.map((wall) => (
        <line
          key={wall.id}
          x1={wall.x1Mm}
          y1={wall.y1Mm}
          x2={wall.x2Mm}
          y2={wall.y2Mm}
          strokeWidth={wall.thicknessMm}
          className="plan-wall"
          strokeLinecap="square"
        />
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
    </svg>
  );
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

function createEntityId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
