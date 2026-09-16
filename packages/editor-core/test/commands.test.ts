import { createEmptyProject } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import { AddWallCommand, CommandHistory } from "../src";

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
});
