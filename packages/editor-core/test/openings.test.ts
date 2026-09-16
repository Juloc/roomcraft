import { createEmptyProject } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import { snapOpeningToWall } from "../src";

describe("snapOpeningToWall", () => {
  it("projects an opening onto the nearest wall and keeps it inside the endpoints", () => {
    const document = createEmptyProject("project_1");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    level.vertices.push(
      { id: "vertex_1", xMm: 0, yMm: 0 },
      { id: "vertex_2", xMm: 4000, yMm: 0 },
    );
    level.walls.push({
      id: "wall_1",
      startVertexId: "vertex_1",
      endVertexId: "vertex_2",
      thicknessMm: 120,
      heightMm: null,
    });

    const placement = snapOpeningToWall(
      { xMm: 1980, yMm: 90 },
      level,
      { widthMm: 900, maxDistanceMm: 200 },
    );

    expect(placement).toMatchObject({
      wallId: "wall_1",
      offsetMm: 1980,
      point: { xMm: 1980, yMm: 0 },
    });
  });

  it("clamps a placement so the full opening stays on the wall", () => {
    const document = createEmptyProject("project_1");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    level.vertices.push(
      { id: "vertex_1", xMm: 0, yMm: 0 },
      { id: "vertex_2", xMm: 4000, yMm: 0 },
    );
    level.walls.push({
      id: "wall_1",
      startVertexId: "vertex_1",
      endVertexId: "vertex_2",
      thicknessMm: 120,
      heightMm: null,
    });

    const placement = snapOpeningToWall(
      { xMm: 100, yMm: 0 },
      level,
      { widthMm: 900, maxDistanceMm: 500 },
    );

    expect(placement?.offsetMm).toBe(450);
    expect(placement?.point).toEqual({ xMm: 450, yMm: 0 });
  });
});
