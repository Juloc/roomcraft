import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, createEmptyProject, parseProjectDocument, validateProjectDocument } from "../src";

describe("project document validation", () => {
  it("accepts a newly created project", () => {
    const document = createEmptyProject("project_test", "Test project");

    expect(() => validateProjectDocument(document)).not.toThrow();
    expect(document.levels).toHaveLength(1);
    expect(document.levels[0]?.defaultWallHeightMm).toBe(2500);
  });

  it("rejects fractional millimetre coordinates", () => {
    const document = createEmptyProject("project_test");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    level.vertices.push({ id: "vertex_a", xMm: 10.5, yMm: 0 });

    expect(() => validateProjectDocument(document)).toThrow(
      "vertex.xMm must be an integer millimetre value.",
    );
  });

  it("rejects walls that reference missing vertices", () => {
    const document = createEmptyProject("project_test");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    level.vertices.push({ id: "vertex_a", xMm: 0, yMm: 0 });
    level.walls.push({
      id: "wall_a",
      startVertexId: "vertex_a",
      endVertexId: "vertex_missing",
      thicknessMm: 120,
      heightMm: null,
    });

    expect(() => validateProjectDocument(document)).toThrow(
      "Wall wall_a references a missing vertex.",
    );
  });

  it("accepts an opening whose offset is the centre distance from the wall start", () => {
    const document = createEmptyProject("project_test");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    level.vertices.push(
      { id: "vertex_a", xMm: 0, yMm: 0 },
      { id: "vertex_b", xMm: 4000, yMm: 0 },
    );
    level.walls.push({
      id: "wall_a",
      startVertexId: "vertex_a",
      endVertexId: "vertex_b",
      thicknessMm: 120,
      heightMm: null,
    });
    level.openings.push({
      id: "door_a",
      wallId: "wall_a",
      type: "door",
      offsetMm: 2000,
      widthMm: 900,
      heightMm: 2100,
      sillHeightMm: 0,
      flip: false,
      swing: "left",
    });

    expect(() => validateProjectDocument(document)).not.toThrow();
  });

  it("rejects an opening that extends beyond a wall endpoint", () => {
    const document = createEmptyProject("project_test");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    level.vertices.push(
      { id: "vertex_a", xMm: 0, yMm: 0 },
      { id: "vertex_b", xMm: 4000, yMm: 0 },
    );
    level.walls.push({
      id: "wall_a",
      startVertexId: "vertex_a",
      endVertexId: "vertex_b",
      thicknessMm: 120,
      heightMm: null,
    });
    level.openings.push({
      id: "door_a",
      wallId: "wall_a",
      type: "door",
      offsetMm: 200,
      widthMm: 900,
      heightMm: 2100,
      sillHeightMm: 0,
      flip: false,
      swing: "left",
    });

    expect(() => validateProjectDocument(document)).toThrow(
      "Opening door_a does not fit inside wall wall_a.",
    );
  });
  it("migrates a v1 project to v2 without mutating the source", () => {
    const legacy = {
      schemaVersion: 1,
      id: "project_v1",
      name: "Legacy",
      settings: {
        unitSystem: "metric",
        gridSizeMm: 100,
        angleSnapDeg: 15,
      },
      levels: [
        {
          id: "level_ground",
          name: "Ground floor",
          elevationMm: 0,
          defaultWallHeightMm: 2500,
          vertices: [],
          walls: [],
          openings: [],
          objects: [],
        },
      ],
    } as const;

    const migrated = parseProjectDocument(legacy);

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.levels[0]?.blueprints).toEqual([]);
    expect("blueprints" in legacy.levels[0]).toBe(false);
  });

  it("accepts a calibrated blueprint reference", () => {
    const document = createEmptyProject("project_blueprint");
    const level = document.levels[0];
    if (!level) throw new Error("Test fixture must contain a level.");

    level.blueprints.push({
      id: "blueprint_1",
      assetId: "asset_1",
      sourceWidthPx: 2000,
      sourceHeightPx: 1200,
      originXmm: -500,
      originYmm: -250,
      millimetresPerPixel: 2.5,
      rotationDeg: 0,
      opacity: 0.55,
      locked: true,
      visible: true,
    });

    expect(() => validateProjectDocument(document)).not.toThrow();
  });

  it("rejects documents from a future schema version", () => {
    expect(() =>
      parseProjectDocument({
        schemaVersion: CURRENT_SCHEMA_VERSION + 1,
        id: "future",
        name: "Future",
        settings: {},
        levels: [],
      }),
    ).toThrow("newer than supported");
  });

});
