import { describe, expect, it } from "vitest";
import { createEmptyProject, validateProjectDocument } from "../src";

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
});
