import { describe, expect, it } from "vitest";
import {
  DEFAULT_CABINET_DIMENSIONS,
  cabinetMinimumDimensions,
  createDefaultCabinetDefinition,
  deriveCabinetCutList,
  deriveCabinetParts,
  parametricAssetId,
  parseParametricAssetId,
} from "../src";

describe("parametric cabinets", () => {
  it("derives a deterministic cabinet from semantic construction values", () => {
    const definition = createDefaultCabinetDefinition("cabinet_1");
    const parts = deriveCabinetParts(definition, DEFAULT_CABINET_DIMENSIONS);

    expect(parts.filter((part) => part.role === "side")).toHaveLength(2);
    expect(parts.filter((part) => part.role === "carcass-horizontal")).toHaveLength(2);
    expect(parts.filter((part) => part.role === "back")).toHaveLength(1);
    expect(parts.filter((part) => part.role === "shelf")).toHaveLength(3);
    expect(parts.filter((part) => part.role === "door")).toHaveLength(2);
    expect(parts.filter((part) => part.role === "plinth")).toHaveLength(1);
    expect(parts.every((part) => part.materialId === "material:white")).toBe(true);
  });

  it("groups equal panels into a compact cut list", () => {
    const definition = createDefaultCabinetDefinition("cabinet_1");
    const cutList = deriveCabinetCutList(definition, DEFAULT_CABINET_DIMENSIONS);

    expect(cutList.find((item) => item.label === "Side")).toMatchObject({
      quantity: 2,
      thicknessMm: 18,
    });
    expect(cutList.find((item) => item.label === "Shelf")).toMatchObject({
      quantity: 3,
      thicknessMm: 18,
    });
    expect(cutList.find((item) => item.label === "Door")?.quantity).toBe(2);
  });

  it("rejects dimensions that cannot contain the configured construction", () => {
    const definition = createDefaultCabinetDefinition("cabinet_1");
    const minimum = cabinetMinimumDimensions(definition);

    expect(() =>
      deriveCabinetParts(definition, {
        widthMm: minimum.widthMm - 1,
        depthMm: DEFAULT_CABINET_DIMENSIONS.depthMm,
        heightMm: DEFAULT_CABINET_DIMENSIONS.heightMm,
      }),
    ).toThrow("Cabinet width must be at least");
  });

  it("round-trips parametric asset ids", () => {
    expect(parametricAssetId("cabinet_1")).toBe("parametric:cabinet_1");
    expect(parseParametricAssetId("parametric:cabinet_1")).toBe("cabinet_1");
    expect(parseParametricAssetId("builtin:box")).toBeNull();
  });
});
