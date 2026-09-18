import { describe, expect, it } from "vitest";
import { analyzePlanarFaces } from "../src";

describe("analyzePlanarFaces", () => {
  it("derives one room from a closed rectangle", () => {
    const result = analyzePlanarFaces(
      [
        { id: "a", xMm: 0, yMm: 0 },
        { id: "b", xMm: 4000, yMm: 0 },
        { id: "c", xMm: 4000, yMm: 3000 },
        { id: "d", xMm: 0, yMm: 3000 },
      ],
      [
        { id: "ab", startVertexId: "a", endVertexId: "b" },
        { id: "bc", startVertexId: "b", endVertexId: "c" },
        { id: "cd", startVertexId: "c", endVertexId: "d" },
        { id: "da", startVertexId: "d", endVertexId: "a" },
      ],
    );

    expect(result.issues).toEqual([]);
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0]?.areaMm2).toBe(12_000_000);
    expect(result.faces[0]?.centroid).toEqual({ xMm: 2000, yMm: 1500 });
  });

  it("does not create a room from an open wall chain", () => {
    const result = analyzePlanarFaces(
      [
        { id: "a", xMm: 0, yMm: 0 },
        { id: "b", xMm: 4000, yMm: 0 },
        { id: "c", xMm: 4000, yMm: 3000 },
      ],
      [
        { id: "ab", startVertexId: "a", endVertexId: "b" },
        { id: "bc", startVertexId: "b", endVertexId: "c" },
      ],
    );

    expect(result.issues).toEqual([]);
    expect(result.faces).toEqual([]);
  });

  it("derives adjacent rooms that share a wall", () => {
    const result = analyzePlanarFaces(
      [
        { id: "a", xMm: 0, yMm: 0 },
        { id: "b", xMm: 3000, yMm: 0 },
        { id: "c", xMm: 6000, yMm: 0 },
        { id: "d", xMm: 6000, yMm: 3000 },
        { id: "e", xMm: 3000, yMm: 3000 },
        { id: "f", xMm: 0, yMm: 3000 },
      ],
      [
        { id: "ab", startVertexId: "a", endVertexId: "b" },
        { id: "bc", startVertexId: "b", endVertexId: "c" },
        { id: "cd", startVertexId: "c", endVertexId: "d" },
        { id: "de", startVertexId: "d", endVertexId: "e" },
        { id: "ef", startVertexId: "e", endVertexId: "f" },
        { id: "fa", startVertexId: "f", endVertexId: "a" },
        { id: "be", startVertexId: "b", endVertexId: "e" },
      ],
    );

    expect(result.issues).toEqual([]);
    expect(result.faces).toHaveLength(2);
    expect(result.faces.map((face) => face.areaMm2)).toEqual([9_000_000, 9_000_000]);
  });

  it("reports an unsplit wall intersection instead of inventing room topology", () => {
    const result = analyzePlanarFaces(
      [
        { id: "a", xMm: 0, yMm: 0 },
        { id: "b", xMm: 4000, yMm: 4000 },
        { id: "c", xMm: 0, yMm: 4000 },
        { id: "d", xMm: 4000, yMm: 0 },
      ],
      [
        { id: "ab", startVertexId: "a", endVertexId: "b" },
        { id: "cd", startVertexId: "c", endVertexId: "d" },
      ],
    );

    expect(result.faces).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      type: "unsplit-intersection",
      edgeIds: ["ab", "cd"],
      point: { xMm: 2000, yMm: 2000 },
    });
  });

  it("keeps room keys deterministic when wall directions change", () => {
    const vertices = [
      { id: "a", xMm: 0, yMm: 0 },
      { id: "b", xMm: 4000, yMm: 0 },
      { id: "c", xMm: 4000, yMm: 3000 },
      { id: "d", xMm: 0, yMm: 3000 },
    ];

    const first = analyzePlanarFaces(vertices, [
      { id: "ab", startVertexId: "a", endVertexId: "b" },
      { id: "bc", startVertexId: "b", endVertexId: "c" },
      { id: "cd", startVertexId: "c", endVertexId: "d" },
      { id: "da", startVertexId: "d", endVertexId: "a" },
    ]);
    const second = analyzePlanarFaces(vertices, [
      { id: "ab", startVertexId: "b", endVertexId: "a" },
      { id: "bc", startVertexId: "c", endVertexId: "b" },
      { id: "cd", startVertexId: "d", endVertexId: "c" },
      { id: "da", startVertexId: "a", endVertexId: "d" },
    ]);

    expect(first.faces[0]?.key).toBe(second.faces[0]?.key);
  });
});
