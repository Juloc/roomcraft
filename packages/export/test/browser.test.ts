import { describe, expect, it } from "vitest";
import { rasterDimensionsForViewBox } from "../src/browser";

describe("raster export sizing", () => {
  it("fits a landscape plan to the requested maximum dimension", () => {
    expect(rasterDimensionsForViewBox(6000, 3000, 2400)).toEqual({
      widthPx: 2400,
      heightPx: 1200,
    });
  });

  it("fits a portrait plan while preserving aspect ratio", () => {
    expect(rasterDimensionsForViewBox(2000, 5000, 3000)).toEqual({
      widthPx: 1200,
      heightPx: 3000,
    });
  });

  it("rejects invalid viewBox dimensions", () => {
    expect(() => rasterDimensionsForViewBox(0, 1000, 2400)).toThrow(
      "positive and finite",
    );
  });
});
