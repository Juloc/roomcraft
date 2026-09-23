import { describe, expect, it } from "vitest";
import { createEmptyProject, type ProjectDocument } from "@roomcraft/document";
import { derivePlanarFaces } from "@roomcraft/geometry";
import { AddOpeningCommand, CommandHistory } from "../src/commands";
import {
  InsertWallWithTopologyCommand,
  RemoveWallByIdCommand,
  SetWallAngleCommand,
  SetWallThicknessCommand,
} from "../src/wall-topology";

function projectWithHorizontalWall(): ProjectDocument {
  const document = createEmptyProject("project_topology", "Topology");
  const level = document.levels[0]!;
  return {
    ...document,
    levels: [{
      ...level,
      vertices: [
        { id: "v_left", xMm: 0, yMm: 0 },
        { id: "v_right", xMm: 4000, yMm: 0 },
      ],
      walls: [{
        id: "wall_horizontal",
        startVertexId: "v_left",
        endVertexId: "v_right",
        thicknessMm: 120,
        heightMm: null,
        leftMaterialId: null,
        rightMaterialId: null,
      }],
    }],
  };
}

function ids() {
  let vertex = 0;
  let wall = 0;
  return (prefix: "vertex" | "wall") =>
    prefix === "vertex" ? `v_auto_${++vertex}` : `wall_auto_${++wall}`;
}

describe("topology-safe wall editing", () => {
  it("splits both walls at a proper crossing and leaves no crossing issue", () => {
    const history = new CommandHistory(projectWithHorizontalWall());
    history.execute(new InsertWallWithTopologyCommand({
      levelId: "level_ground",
      wallId: "wall_vertical",
      start: { kind: "new", vertex: { id: "v_top", xMm: 2000, yMm: -2000 } },
      end: { kind: "new", vertex: { id: "v_bottom", xMm: 2000, yMm: 2000 } },
      thicknessMm: 120,
      createId: ids(),
    }));

    const level = history.document.levels[0]!;
    expect(level.walls).toHaveLength(4);
    const junction = level.vertices.find(
      (vertex) => vertex.xMm === 2000 && vertex.yMm === 0,
    );
    expect(junction).toBeDefined();
    expect(
      level.walls.filter(
        (wall) =>
          wall.startVertexId === junction?.id ||
          wall.endVertexId === junction?.id,
      ),
    ).toHaveLength(4);

    const graph = derivePlanarFaces(level);
    expect(graph.issues.filter((issue) => issue.type === "crossing")).toHaveLength(0);

    history.undo();
    expect(history.document.levels[0]!.walls).toHaveLength(1);
    expect(history.document.levels[0]!.vertices).toHaveLength(2);
  });

  it("creates a T junction when the new wall ends on an existing wall", () => {
    const history = new CommandHistory(projectWithHorizontalWall());
    history.execute(new InsertWallWithTopologyCommand({
      levelId: "level_ground",
      wallId: "wall_t",
      start: { kind: "new", vertex: { id: "v_top", xMm: 1000, yMm: -1500 } },
      end: { kind: "new", vertex: { id: "v_join", xMm: 1000, yMm: 0 } },
      thicknessMm: 120,
      createId: ids(),
    }));

    const level = history.document.levels[0]!;
    expect(level.walls).toHaveLength(3);
    const junction = level.vertices.find((vertex) => vertex.id === "v_join");
    expect(junction).toMatchObject({ xMm: 1000, yMm: 0 });
    expect(level.walls.filter(
      (wall) => wall.startVertexId === "v_join" || wall.endVertexId === "v_join",
    )).toHaveLength(3);
    expect(derivePlanarFaces(level).issues.filter((issue) => issue.type === "crossing")).toHaveLength(0);
  });

  it("moves an opening to the correct replacement segment when its wall is split", () => {
    const history = new CommandHistory(projectWithHorizontalWall());
    history.execute(new AddOpeningCommand({
      levelId: "level_ground",
      opening: {
        id: "door_1",
        wallId: "wall_horizontal",
        type: "door",
        offsetMm: 3000,
        widthMm: 800,
        heightMm: 2100,
        sillHeightMm: 0,
        flip: false,
        swing: "left",
      },
    }));

    history.execute(new InsertWallWithTopologyCommand({
      levelId: "level_ground",
      wallId: "wall_vertical",
      start: { kind: "new", vertex: { id: "v_top", xMm: 2000, yMm: -1000 } },
      end: { kind: "new", vertex: { id: "v_bottom", xMm: 2000, yMm: 1000 } },
      thicknessMm: 120,
      createId: ids(),
    }));

    const level = history.document.levels[0]!;
    const opening = level.openings.find((item) => item.id === "door_1")!;
    expect(opening.wallId).not.toBe("wall_horizontal");
    expect(opening.offsetMm).toBe(1000);
  });

  it("rejects a junction that would cut through an opening", () => {
    const history = new CommandHistory(projectWithHorizontalWall());
    history.execute(new AddOpeningCommand({
      levelId: "level_ground",
      opening: {
        id: "door_1",
        wallId: "wall_horizontal",
        type: "door",
        offsetMm: 2000,
        widthMm: 900,
        heightMm: 2100,
        sillHeightMm: 0,
        flip: false,
        swing: "left",
      },
    }));

    expect(() => history.execute(new InsertWallWithTopologyCommand({
      levelId: "level_ground",
      wallId: "wall_vertical",
      start: { kind: "new", vertex: { id: "v_top", xMm: 2000, yMm: -1000 } },
      end: { kind: "new", vertex: { id: "v_bottom", xMm: 2000, yMm: 1000 } },
      thicknessMm: 120,
      createId: ids(),
    }))).toThrow(/through opening/);
  });

  it("rejects collinear overlap and duplicate geometry", () => {
    const history = new CommandHistory(projectWithHorizontalWall());
    expect(() => history.execute(new InsertWallWithTopologyCommand({
      levelId: "level_ground",
      wallId: "wall_overlap",
      start: { kind: "new", vertex: { id: "v_a", xMm: 1000, yMm: 0 } },
      end: { kind: "new", vertex: { id: "v_b", xMm: 3000, yMm: 0 } },
      thicknessMm: 120,
      createId: ids(),
    }))).toThrow(/overlaps/);
  });

  it("edits angle and thickness through undoable commands", () => {
    const history = new CommandHistory(projectWithHorizontalWall());

    history.execute(new SetWallAngleCommand({
      levelId: "level_ground",
      wallId: "wall_horizontal",
      angleDeg: 90,
      anchor: "start",
    }));
    let level = history.document.levels[0]!;
    expect(level.vertices.find((vertex) => vertex.id === "v_right")).toMatchObject({
      xMm: 0,
      yMm: 4000,
    });

    history.execute(new SetWallThicknessCommand({
      levelId: "level_ground",
      wallId: "wall_horizontal",
      thicknessMm: 200,
    }));
    level = history.document.levels[0]!;
    expect(level.walls[0]!.thicknessMm).toBe(200);

    history.undo();
    expect(history.document.levels[0]!.walls[0]!.thicknessMm).toBe(120);
  });

  it("removes a wall, its openings and orphan vertices in one undoable command", () => {
    const history = new CommandHistory(projectWithHorizontalWall());
    history.execute(new AddOpeningCommand({
      levelId: "level_ground",
      opening: {
        id: "door_1",
        wallId: "wall_horizontal",
        type: "door",
        offsetMm: 2000,
        widthMm: 800,
        heightMm: 2100,
        sillHeightMm: 0,
        flip: false,
        swing: "left",
      },
    }));

    history.execute(new RemoveWallByIdCommand("level_ground", "wall_horizontal"));
    expect(history.document.levels[0]!.walls).toHaveLength(0);
    expect(history.document.levels[0]!.openings).toHaveLength(0);
    expect(history.document.levels[0]!.vertices).toHaveLength(0);

    history.undo();
    expect(history.document.levels[0]!.walls).toHaveLength(1);
    expect(history.document.levels[0]!.openings).toHaveLength(1);
  });
});
