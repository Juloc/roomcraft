import { createEmptyProject } from "@roomcraft/document";
import { AddWallCommand, CommandHistory } from "@roomcraft/editor-core";
import { projectLevel2D } from "@roomcraft/render-2d";
import { Button, Panel, SegmentedControl, Toolbar } from "@roomcraft/ui";
import { useRef, useState } from "react";

type ViewMode = "2d" | "3d";

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

  const level = document.levels[0];
  if (!level) throw new Error("The project must contain at least one level.");

  const projection = projectLevel2D(document, level.id);
  const hasDemoRoom = level.walls.length > 0;

  function createDemoRoom() {
    if (history.document.levels[0]?.walls.length) return;

    const commands = [
      new AddWallCommand({
        levelId: level.id,
        wallId: "wall_north",
        start: { kind: "new" as const, vertex: { id: "vertex_nw", xMm: 0, yMm: 0 } },
        end: { kind: "new" as const, vertex: { id: "vertex_ne", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
      new AddWallCommand({
        levelId: level.id,
        wallId: "wall_east",
        start: { kind: "existing" as const, vertexId: "vertex_ne" },
        end: { kind: "new" as const, vertex: { id: "vertex_se", xMm: 4000, yMm: 3000 } },
        thicknessMm: 120,
      }),
      new AddWallCommand({
        levelId: level.id,
        wallId: "wall_south",
        start: { kind: "existing" as const, vertexId: "vertex_se" },
        end: { kind: "new" as const, vertex: { id: "vertex_sw", xMm: 0, yMm: 3000 } },
        thicknessMm: 120,
      }),
      new AddWallCommand({
        levelId: level.id,
        wallId: "wall_west",
        start: { kind: "existing" as const, vertexId: "vertex_sw" },
        end: { kind: "existing" as const, vertexId: "vertex_nw" },
        thicknessMm: 120,
      }),
    ];

    let next = history.document;
    for (const command of commands) next = history.execute(command);
    setDocument(next);
  }

  function undo() {
    setDocument(history.undo());
  }

  function redo() {
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
            onChange={setViewMode}
            ariaLabel="Editor view"
          />
        </Toolbar>
      </header>

      <main className="editor-layout">
        <aside className="tool-rail" aria-label="Drawing tools">
          <Button variant="primary" disabled title="Interactive wall drawing is the next editor tool">
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
            <PlanCanvas walls={projection.walls} />
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
              </dl>

              <Button variant="primary" onClick={createDemoRoom} disabled={hasDemoRoom}>
                Create 4 × 3 m room
              </Button>
              <p className="hint">
                This action already uses the same commands that pointer and touch tools will use.
              </p>
            </div>
          </Panel>
        </aside>
      </main>
    </div>
  );
}

interface PlanCanvasProps {
  walls: ReturnType<typeof projectLevel2D>["walls"];
}

function PlanCanvas({ walls }: PlanCanvasProps) {
  return (
    <svg className="plan-canvas" viewBox="-600 -600 5200 4200" role="img" aria-label="2D floor plan">
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
    </svg>
  );
}
