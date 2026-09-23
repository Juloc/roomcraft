import { describe, expect, it } from "vitest";
import { isInteriorParameter, segmentIntersection } from "../src";

describe("segment topology", () => {
  it("finds a proper crossing with parameters on both segments", () => {
    const result = segmentIntersection(
      { start: { xMm: 0, yMm: 0 }, end: { xMm: 1000, yMm: 0 } },
      { start: { xMm: 500, yMm: -500 }, end: { xMm: 500, yMm: 500 } },
    );

    expect(result).toMatchObject({
      kind: "point",
      point: { xMm: 500, yMm: 0 },
      aT: 0.5,
      bT: 0.5,
    });
  });

  it("reports an endpoint-on-segment T junction as one point", () => {
    const result = segmentIntersection(
      { start: { xMm: 500, yMm: -500 }, end: { xMm: 500, yMm: 0 } },
      { start: { xMm: 0, yMm: 0 }, end: { xMm: 1000, yMm: 0 } },
    );

    expect(result?.kind).toBe("point");
    if (result?.kind !== "point") throw new Error("Expected point intersection.");
    expect(result.aT).toBe(1);
    expect(result.bT).toBe(0.5);
    expect(isInteriorParameter(result.aT)).toBe(false);
    expect(isInteriorParameter(result.bT)).toBe(true);
  });

  it("distinguishes collinear overlap from a single shared endpoint", () => {
    const overlap = segmentIntersection(
      { start: { xMm: 0, yMm: 0 }, end: { xMm: 1000, yMm: 0 } },
      { start: { xMm: 500, yMm: 0 }, end: { xMm: 1500, yMm: 0 } },
    );
    expect(overlap?.kind).toBe("overlap");

    const endpoint = segmentIntersection(
      { start: { xMm: 0, yMm: 0 }, end: { xMm: 1000, yMm: 0 } },
      { start: { xMm: 1000, yMm: 0 }, end: { xMm: 1500, yMm: 0 } },
    );
    expect(endpoint?.kind).toBe("point");
  });

  it("returns null for parallel separated segments", () => {
    expect(
      segmentIntersection(
        { start: { xMm: 0, yMm: 0 }, end: { xMm: 1000, yMm: 0 } },
        { start: { xMm: 0, yMm: 100 }, end: { xMm: 1000, yMm: 100 } },
      ),
    ).toBeNull();
  });

  it("keeps millimetre tolerance independent of segment length", () => {
    expect(
      segmentIntersection(
        { start: { xMm: 0, yMm: 0 }, end: { xMm: 10000, yMm: 0 } },
        { start: { xMm: 10010, yMm: 0 }, end: { xMm: 12000, yMm: 0 } },
      ),
    ).toBeNull();
  });
});
