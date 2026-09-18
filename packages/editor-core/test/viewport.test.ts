import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_CAMERA,
  fitPlanCamera,
  panPlanCamera,
  planViewBox,
  zoomPlanCameraAt,
} from "../src";

describe("2D plan viewport", () => {
  it("derives a viewBox from camera scale and viewport size", () => {
    expect(
      planViewBox(
        { centerXmm: 2000, centerYmm: 1000, mmPerPixel: 4 },
        { width: 1000, height: 500 },
      ),
    ).toEqual({
      xMm: 0,
      yMm: 0,
      widthMm: 4000,
      heightMm: 2000,
    });
  });

  it("keeps the zoom anchor at the same screen position", () => {
    const camera = { centerXmm: 2000, centerYmm: 1500, mmPerPixel: 5 };
    const anchor = { xMm: 3000, yMm: 2000 };
    const next = zoomPlanCameraAt(camera, anchor, 0.5);

    expect(next).toEqual({
      centerXmm: 2500,
      centerYmm: 1750,
      mmPerPixel: 2.5,
    });
  });

  it("pans in screen-pixel units", () => {
    expect(
      panPlanCamera(
        { centerXmm: 2000, centerYmm: 1500, mmPerPixel: 5 },
        { xPx: 100, yPx: -20 },
      ),
    ).toEqual({
      centerXmm: 1500,
      centerYmm: 1600,
      mmPerPixel: 5,
    });
  });

  it("fits plan points with padding while preserving aspect", () => {
    const camera = fitPlanCamera(
      [
        { xMm: 0, yMm: 0 },
        { xMm: 4000, yMm: 3000 },
      ],
      { width: 1000, height: 800 },
      100,
    );

    expect(camera.centerXmm).toBe(2000);
    expect(camera.centerYmm).toBe(1500);
    expect(camera.mmPerPixel).toBeCloseTo(5);
  });

  it("uses the default camera for an empty plan", () => {
    expect(fitPlanCamera([], { width: 800, height: 600 })).toEqual(DEFAULT_PLAN_CAMERA);
  });
});
