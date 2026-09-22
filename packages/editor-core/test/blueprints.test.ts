import type { BlueprintReference } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import { calibrateBlueprintReference, planPointToBlueprintPixel } from "../src";

const blueprint: BlueprintReference = {
  id: "blueprint_1",
  assetId: "asset_1",
  sourceWidthPx: 2000,
  sourceHeightPx: 1000,
  crop: {
    leftPx: 0,
    topPx: 0,
    widthPx: 2000,
    heightPx: 1000,
  },
  originXmm: 1000,
  originYmm: 500,
  millimetresPerPixel: 2,
  rotationDeg: 0,
  opacity: 0.5,
  locked: true,
  visible: true,
};

describe("blueprint calibration", () => {
  it("maps plan points back to source image pixels", () => {
    expect(planPointToBlueprintPixel(blueprint, { xMm: 3000, yMm: 1500 })).toEqual({
      xPx: 1000,
      yPx: 500,
    });
  });

  it("recalibrates scale while keeping the first calibration point anchored", () => {
    const calibrated = calibrateBlueprintReference(
      blueprint,
      { xMm: 2000, yMm: 500 },
      { xMm: 4000, yMm: 500 },
      4000,
    );

    expect(calibrated.millimetresPerPixel).toBe(4);
    expect(planPointToBlueprintPixel(calibrated, { xMm: 2000, yMm: 500 })).toEqual({
      xPx: 500,
      yPx: 0,
    });
    expect(calibrated.originXmm).toBe(0);
    expect(calibrated.originYmm).toBe(500);
  });

  it("supports rotated blueprints", () => {
    const rotated = { ...blueprint, rotationDeg: 90 };
    const calibrated = calibrateBlueprintReference(
      rotated,
      { xMm: 1000, yMm: 2500 },
      { xMm: 1000, yMm: 4500 },
      3000,
    );

    expect(calibrated.millimetresPerPixel).toBeCloseTo(3);
    const anchoredPixel = planPointToBlueprintPixel(calibrated, { xMm: 1000, yMm: 2500 });
    expect(anchoredPixel.xPx).toBeCloseTo(1000);
    expect(anchoredPixel.yPx).toBeCloseTo(0);
  });
});
