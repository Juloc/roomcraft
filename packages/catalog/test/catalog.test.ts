import { describe, expect, it } from "vitest";
import {
  BUILTIN_ASSETS,
  catalogVersionAssetId,
  getBuiltinAssetDefinition,
  isBuiltinAssetId,
  parseCatalogVersionAssetId,
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

  it("round-trips immutable catalog version references", () => {
    const assetId = catalogVersionAssetId("catalog_table_1", 3);
    expect(assetId).toBe("catalog:catalog_table_1@3");
    expect(parseCatalogVersionAssetId(assetId)).toEqual({
      itemId: "catalog_table_1",
      version: 3,
    });
    expect(parseCatalogVersionAssetId("builtin:table")).toBeNull();
    expect(parseCatalogVersionAssetId("catalog:item@0")).toBeNull();
  });

  it("rejects ambiguous or invalid catalog version ids", () => {
    expect(() => catalogVersionAssetId("bad@id", 1)).toThrow();
    expect(() => catalogVersionAssetId("item", 0)).toThrow();
  });
});
