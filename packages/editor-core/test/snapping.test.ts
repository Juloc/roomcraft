import { createEmptyProject } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import { snapObjectPosition, snapPlanPoint } from "../src";

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


describe("snapObjectPosition", () => {
  it("snaps a furniture edge next to another object before falling back to grid", () => {
    const document = createEmptyProject("project_objects");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    level.objects.push({
      id: "table_1",
      assetId: "builtin:table",
      xMm: 2000,
      yMm: 1500,
      zMm: 0,
      rotationDeg: 0,
      widthMm: 1600,
      depthMm: 900,
      heightMm: 760,
      locked: false,
    });

    const result = snapObjectPosition(
      { xMm: 3260, yMm: 1515 },
      {
        id: "cabinet_1",
        widthMm: 800,
        depthMm: 400,
        rotationDeg: 0,
      },
      level,
      { gridSizeMm: 100, objectToleranceMm: 140 },
    );

    expect(result).toEqual({
      point: { xMm: 3200, yMm: 1500 },
      source: "object",
      objectId: "table_1",
    });
  });

  it("uses rotated object bounds for edge snapping", () => {
    const document = createEmptyProject("project_rotated_objects");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    level.objects.push({
      id: "rotated",
      assetId: "builtin:box",
      xMm: 2000,
      yMm: 2000,
      zMm: 0,
      rotationDeg: 90,
      widthMm: 1000,
      depthMm: 400,
      heightMm: 800,
      locked: false,
    });

    const result = snapObjectPosition(
      { xMm: 2605, yMm: 2000 },
      { widthMm: 800, depthMm: 400, rotationDeg: 0 },
      level,
      { gridSizeMm: 100, objectToleranceMm: 20 },
    );

    expect(result.point.xMm).toBe(2600);
    expect(result.source).toBe("object");
  });

  it("falls back to grid when no object alignment is close enough", () => {
    const document = createEmptyProject("project_grid_objects");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    const result = snapObjectPosition(
      { xMm: 1049, yMm: 1151 },
      { widthMm: 800, depthMm: 400, rotationDeg: 0 },
      level,
      { gridSizeMm: 100 },
    );

    expect(result).toEqual({
      point: { xMm: 1000, yMm: 1200 },
      source: "grid",
    });
  });
});
