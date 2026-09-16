import { createEmptyProject } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import { snapPlanPoint } from "../src";

describe("snapPlanPoint", () => {
  it("snaps to an existing vertex before the grid", () => {
    const document = createEmptyProject("project_1");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    level.vertices.push({ id: "vertex_1", xMm: 950, yMm: 1000 });

    const result = snapPlanPoint(
      { xMm: 1020, yMm: 1010 },
      level,
      { gridSizeMm: 100, vertexToleranceMm: 160 },
    );

    expect(result).toEqual({
      point: { xMm: 950, yMm: 1000 },
      source: "vertex",
      vertexId: "vertex_1",
    });
  });

  it("falls back to the configured grid", () => {
    const document = createEmptyProject("project_1");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    const result = snapPlanPoint(
      { xMm: 1049, yMm: 1151 },
      level,
      { gridSizeMm: 100 },
    );

    expect(result).toEqual({
      point: { xMm: 1000, yMm: 1200 },
      source: "grid",
    });
  });
});
