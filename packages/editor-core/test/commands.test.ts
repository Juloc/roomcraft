import { createEmptyProject } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import { AddOpeningCommand, AddWallCommand, CommandHistory } from "../src";

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
});
