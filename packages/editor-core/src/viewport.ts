import type { Point2Mm } from "@roomcraft/geometry";

export interface PlanCamera2D {
  centerXmm: number;
  centerYmm: number;
  mmPerPixel: number;
}

export interface ViewportSizePx {
  width: number;
  height: number;
}

export interface PlanViewBox {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export const DEFAULT_PLAN_CAMERA: PlanCamera2D = Object.freeze({
  centerXmm: 2000,
  centerYmm: 1500,
  mmPerPixel: 5,
});

const MIN_MM_PER_PIXEL = 0.05;
const MAX_MM_PER_PIXEL = 10_000;

export function planViewBox(camera: PlanCamera2D, size: ViewportSizePx): PlanViewBox {
  validateSize(size);
  validateCamera(camera);

  const widthMm = size.width * camera.mmPerPixel;
  const heightMm = size.height * camera.mmPerPixel;
  return {
    xMm: camera.centerXmm - widthMm / 2,
    yMm: camera.centerYmm - heightMm / 2,
    widthMm,
    heightMm,
  };
}

export function zoomPlanCameraAt(
  camera: PlanCamera2D,
  anchor: Point2Mm,
  scale: number,
): PlanCamera2D {
  validateCamera(camera);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("Zoom scale must be a positive finite number.");
  }

  const nextMmPerPixel = clamp(camera.mmPerPixel * scale, MIN_MM_PER_PIXEL, MAX_MM_PER_PIXEL);
  const appliedScale = nextMmPerPixel / camera.mmPerPixel;

  return {
    centerXmm: anchor.xMm + (camera.centerXmm - anchor.xMm) * appliedScale,
    centerYmm: anchor.yMm + (camera.centerYmm - anchor.yMm) * appliedScale,
    mmPerPixel: nextMmPerPixel,
  };
}

export function panPlanCamera(
  camera: PlanCamera2D,
  deltaPixels: { xPx: number; yPx: number },
): PlanCamera2D {
  validateCamera(camera);
  if (!Number.isFinite(deltaPixels.xPx) || !Number.isFinite(deltaPixels.yPx)) {
    throw new Error("Pan delta must be finite.");
  }

  return {
    ...camera,
    centerXmm: camera.centerXmm - deltaPixels.xPx * camera.mmPerPixel,
    centerYmm: camera.centerYmm - deltaPixels.yPx * camera.mmPerPixel,
  };
}

export function fitPlanCamera(
  points: readonly Point2Mm[],
  size: ViewportSizePx,
  paddingPx = 56,
): PlanCamera2D {
  validateSize(size);
  if (!Number.isFinite(paddingPx) || paddingPx < 0) {
    throw new Error("Viewport padding must be a non-negative finite number.");
  }
  if (points.length === 0) return { ...DEFAULT_PLAN_CAMERA };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (!Number.isFinite(point.xMm) || !Number.isFinite(point.yMm)) {
      throw new Error("Fit points must be finite.");
    }
    minX = Math.min(minX, point.xMm);
    minY = Math.min(minY, point.yMm);
    maxX = Math.max(maxX, point.xMm);
    maxY = Math.max(maxY, point.yMm);
  }

  const usableWidthPx = Math.max(1, size.width - paddingPx * 2);
  const usableHeightPx = Math.max(1, size.height - paddingPx * 2);
  const spanXmm = Math.max(500, maxX - minX);
  const spanYmm = Math.max(500, maxY - minY);
  const mmPerPixel = clamp(
    Math.max(spanXmm / usableWidthPx, spanYmm / usableHeightPx),
    MIN_MM_PER_PIXEL,
    MAX_MM_PER_PIXEL,
  );

  return {
    centerXmm: (minX + maxX) / 2,
    centerYmm: (minY + maxY) / 2,
    mmPerPixel,
  };
}

function validateCamera(camera: PlanCamera2D): void {
  if (
    !Number.isFinite(camera.centerXmm) ||
    !Number.isFinite(camera.centerYmm) ||
    !Number.isFinite(camera.mmPerPixel) ||
    camera.mmPerPixel <= 0
  ) {
    throw new Error("Plan camera is invalid.");
  }
}

function validateSize(size: ViewportSizePx): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new Error("Viewport size must be positive and finite.");
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
