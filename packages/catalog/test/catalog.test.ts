import { describe, expect, it } from "vitest";
import {
  BUILTIN_ASSETS,
  getBuiltinAssetDefinition,
  isBuiltinAssetId,
} from "../src";

describe("builtin catalog", () => {
  it("keeps ids unique and dimensions positive", () => {
    const ids = new Set<string>();

    for (const asset of BUILTIN_ASSETS) {
      expect(ids.has(asset.id)).toBe(false);
      ids.add(asset.id);
      expect(asset.defaultDimensionsMm.widthMm).toBeGreaterThan(0);
      expect(asset.defaultDimensionsMm.depthMm).toBeGreaterThan(0);
      expect(asset.defaultDimensionsMm.heightMm).toBeGreaterThan(0);
    }
  });

  it("resolves known assets without inventing unknown definitions", () => {
    expect(getBuiltinAssetDefinition("builtin:table")?.primitive).toBe("table");
    expect(getBuiltinAssetDefinition("catalog:unknown")).toBeNull();
    expect(isBuiltinAssetId("builtin:bed")).toBe(true);
  });
});
