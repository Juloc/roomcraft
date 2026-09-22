import { createEmptyProject } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import { AddBlueprintCommand, AddOpeningCommand, AddWallCommand, CalibrateBlueprintCommand, CommandHistory, SetWallLengthCommand } from "../src";

describe("CommandHistory", () => {
  it("adds a wall through a command and restores it through undo/redo", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));

    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );

    expect(history.document.levels[0]?.walls).toHaveLength(1);
    expect(history.document.levels[0]?.vertices).toHaveLength(2);

    history.undo();
    expect(history.document.levels[0]?.walls).toHaveLength(0);
    expect(history.document.levels[0]?.vertices).toHaveLength(0);

    history.redo();
    expect(history.document.levels[0]?.walls[0]?.id).toBe("wall_1");
  });

  it("adds an opening to a wall and restores it through undo/redo", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));

    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new AddOpeningCommand({
        levelId: "level_ground",
        opening: {
          id: "door_1",
          wallId: "wall_1",
          type: "door",
          offsetMm: 2000,
          widthMm: 900,
          heightMm: 2100,
          sillHeightMm: 0,
          flip: false,
          swing: "left",
        },
      }),
    );

    expect(history.document.levels[0]?.openings[0]?.id).toBe("door_1");

    history.undo();
    expect(history.document.levels[0]?.openings).toHaveLength(0);

    history.redo();
    expect(history.document.levels[0]?.openings[0]?.wallId).toBe("wall_1");
  });

  it("rejects overlapping openings on the same wall", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new AddOpeningCommand({
        levelId: "level_ground",
        opening: {
          id: "door_1",
          wallId: "wall_1",
          type: "door",
          offsetMm: 1800,
          widthMm: 900,
          heightMm: 2100,
          sillHeightMm: 0,
          flip: false,
          swing: "left",
        },
      }),
    );

    expect(() =>
      history.execute(
        new AddOpeningCommand({
          levelId: "level_ground",
          opening: {
            id: "door_2",
            wallId: "wall_1",
            type: "door",
            offsetMm: 2200,
            widthMm: 900,
            heightMm: 2100,
            sillHeightMm: 0,
            flip: false,
            swing: "right",
          },
        }),
      ),
    ).toThrow("overlaps opening door_1");
  });
  it("sets an exact wall length and restores it through undo/redo", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new SetWallLengthCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        lengthMm: 5000,
      }),
    );

    expect(history.document.levels[0]?.vertices.find((vertex) => vertex.id === "vertex_2")).toMatchObject({
      xMm: 5000,
      yMm: 0,
    });

    history.undo();
    expect(history.document.levels[0]?.vertices.find((vertex) => vertex.id === "vertex_2")).toMatchObject({
      xMm: 4000,
      yMm: 0,
    });

    history.redo();
    expect(history.document.levels[0]?.vertices.find((vertex) => vertex.id === "vertex_2")).toMatchObject({
      xMm: 5000,
      yMm: 0,
    });
  });

  it("moves a shared endpoint so connected walls stay topologically connected", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_2",
        start: { kind: "existing", vertexId: "vertex_2" },
        end: { kind: "new", vertex: { id: "vertex_3", xMm: 4000, yMm: 3000 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new SetWallLengthCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        lengthMm: 5000,
      }),
    );

    const level = history.document.levels[0];
    expect(level?.vertices.find((vertex) => vertex.id === "vertex_2")).toMatchObject({
      xMm: 5000,
      yMm: 0,
    });
    expect(level?.walls.find((wall) => wall.id === "wall_2")?.startVertexId).toBe("vertex_2");
  });

  it("rejects shortening a wall when an existing opening would no longer fit", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );
    history.execute(
      new AddOpeningCommand({
        levelId: "level_ground",
        opening: {
          id: "door_1",
          wallId: "wall_1",
          type: "door",
          offsetMm: 3300,
          widthMm: 900,
          heightMm: 2100,
          sillHeightMm: 0,
          flip: false,
          swing: "left",
        },
      }),
    );

    expect(() =>
      history.execute(
        new SetWallLengthCommand({
          levelId: "level_ground",
          wallId: "wall_1",
          lengthMm: 3000,
        }),
      ),
    ).toThrow("does not fit inside wall wall_1");
  });

  it("adds and calibrates a blueprint through undoable commands", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));

    history.execute(
      new AddBlueprintCommand({
        levelId: "level_ground",
        blueprint: {
          id: "blueprint_1",
          assetId: "asset_1",
          sourceWidthPx: 2000,
          sourceHeightPx: 1000,
          crop: {
            leftPx: 0,
            topPx: 0,
            widthPx: 2000,
            heightPx: 1000,
          },
          originXmm: 0,
          originYmm: 0,
          millimetresPerPixel: 2,
          rotationDeg: 0,
          opacity: 0.5,
          locked: true,
          visible: true,
        },
      }),
    );

    history.execute(
      new CalibrateBlueprintCommand({
        levelId: "level_ground",
        blueprintId: "blueprint_1",
        firstPlanPoint: { xMm: 0, yMm: 0 },
        secondPlanPoint: { xMm: 2000, yMm: 0 },
        knownLengthMm: 4000,
      }),
    );

    expect(history.document.levels[0]?.blueprints[0]?.millimetresPerPixel).toBe(4);

    history.undo();
    expect(history.document.levels[0]?.blueprints[0]?.millimetresPerPixel).toBe(2);

    history.undo();
    expect(history.document.levels[0]?.blueprints).toHaveLength(0);

    history.redo();
    expect(history.document.levels[0]?.blueprints[0]?.assetId).toBe("asset_1");
  });

});
