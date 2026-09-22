import { createEmptyProject } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import { duplicateLevelShell } from "../src";

describe("duplicateLevelShell", () => {
  it("duplicates structural geometry with remapped ids only", () => {
    const project = createEmptyProject("project_levels");
    const source = project.levels[0];
    if (!source) throw new Error("Fixture needs a level.");

    source.vertices.push(
      { id: "v1", xMm: 0, yMm: 0 },
      { id: "v2", xMm: 4000, yMm: 0 },
    );
    source.walls.push({
      id: "w1",
      startVertexId: "v1",
      endVertexId: "v2",
      thicknessMm: 120,
      heightMm: null,
    });
    source.openings.push({
      id: "o1",
      wallId: "w1",
      type: "door",
      offsetMm: 2000,
      widthMm: 900,
      heightMm: 2100,
      sillHeightMm: 0,
      flip: false,
      swing: "left",
    });
    source.objects.push({
      id: "object_1",
      assetId: "asset_1",
      xMm: 100,
      yMm: 100,
      zMm: 0,
      rotationDeg: 0,
      widthMm: 800,
      depthMm: 400,
      heightMm: 2000,
      locked: false,
    });

    let counter = 0;
    const duplicate = duplicateLevelShell(source, {
      levelId: "level_upper",
      name: "Upper floor",
      elevationMm: 2700,
      createId: (prefix) => `${prefix}_copy_${++counter}`,
    });

    expect(duplicate).toMatchObject({
      id: "level_upper",
      name: "Upper floor",
      elevationMm: 2700,
      defaultWallHeightMm: source.defaultWallHeightMm,
      floorThicknessMm: source.floorThicknessMm,
    });
    expect(duplicate.vertices).toHaveLength(2);
    expect(duplicate.walls).toHaveLength(1);
    expect(duplicate.openings).toHaveLength(1);
    expect(duplicate.objects).toEqual([]);
    expect(duplicate.blueprints).toEqual([]);
    expect(duplicate.roomFinishes).toEqual([]);

    const wall = duplicate.walls[0];
    const opening = duplicate.openings[0];
    expect(wall?.startVertexId).not.toBe("v1");
    expect(wall?.endVertexId).not.toBe("v2");
    expect(opening?.wallId).toBe(wall?.id);
    expect(opening?.id).not.toBe("o1");
  });
});
