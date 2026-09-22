import type { BlueprintReference } from "@roomcraft/document";
import { distanceMm, type Point2Mm } from "@roomcraft/geometry";

export interface BlueprintPixelPoint {
  xPx: number;
  yPx: number;
}

export function planPointToBlueprintPixel(
  blueprint: BlueprintReference,
  point: Point2Mm,
): BlueprintPixelPoint {
  const radians = (blueprint.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dxMm = point.xMm - blueprint.originXmm;
  const dyMm = point.yMm - blueprint.originYmm;

  return {
    xPx: (cosine * dxMm + sine * dyMm) / blueprint.millimetresPerPixel,
    yPx: (-sine * dxMm + cosine * dyMm) / blueprint.millimetresPerPixel,
  };
}

export function calibrateBlueprintReference(
  blueprint: BlueprintReference,
  firstPlanPoint: Point2Mm,
  secondPlanPoint: Point2Mm,
  knownLengthMm: number,
): BlueprintReference {
  if (!Number.isSafeInteger(knownLengthMm) || knownLengthMm <= 0) {
    throw new Error("Calibration length must be a positive integer millimetre value.");
  }

  const firstPixel = planPointToBlueprintPixel(blueprint, firstPlanPoint);
  const secondPixel = planPointToBlueprintPixel(blueprint, secondPlanPoint);
  const pixelDistance = Math.hypot(
    secondPixel.xPx - firstPixel.xPx,
    secondPixel.yPx - firstPixel.yPx,
  );
  if (!Number.isFinite(pixelDistance) || pixelDistance < 0.001) {
    throw new Error("Calibration points must be different.");
  }

  const millimetresPerPixel = knownLengthMm / pixelDistance;
  const radians = (blueprint.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const firstLocalXmm = firstPixel.xPx * millimetresPerPixel;
  const firstLocalYmm = firstPixel.yPx * millimetresPerPixel;
  const rotatedXmm = cosine * firstLocalXmm - sine * firstLocalYmm;
  const rotatedYmm = sine * firstLocalXmm + cosine * firstLocalYmm;

  return {
    ...blueprint,
    originXmm: Math.round(firstPlanPoint.xMm - rotatedXmm),
    originYmm: Math.round(firstPlanPoint.yMm - rotatedYmm),
    millimetresPerPixel,
  };
}

export function blueprintPlanDiagonalMm(blueprint: BlueprintReference): number {
  return distanceMm(
    { xMm: 0, yMm: 0 },
    {
      xMm: blueprint.crop.widthPx * blueprint.millimetresPerPixel,
      yMm: blueprint.crop.heightPx * blueprint.millimetresPerPixel,
    },
  );
}
