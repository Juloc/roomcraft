import { describe, expect, it } from "vitest";
import { almostEqualMm, metresToMm, mmToMetres, snapToGrid } from "../src";

describe("geometry primitives", () => {
  it("converts only at renderer/export boundaries without losing millimetres", () => {
    expect(mmToMetres(2500)).toBe(2.5);
    expect(metresToMm(2.501)).toBe(2501);
  });

  it("uses a tolerance instead of floating point equality", () => {
    expect(almostEqualMm(100, 100.005)).toBe(true);
    expect(almostEqualMm(100, 100.02)).toBe(false);
  });

  it("snaps values to an integer millimetre grid", () => {
    expect(snapToGrid(149, 100)).toBe(100);
    expect(snapToGrid(151, 100)).toBe(200);
  });
});
