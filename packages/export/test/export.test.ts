import { createEmptyProject } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import {
  exportLevelSvg,
  parseRoomCraftDocumentFile,
  roomCraftFileName,
  serializeRoomCraftDocument,
} from "../src";

describe("RoomCraft export", () => {
  it("round-trips the native document format through central migrations and validation", () => {
    const document = createEmptyProject("project_export", "My apartment");
    document.parametricAssets.push({
      id: "cabinet_1",
      kind: "cabinet",
      name: "Dining cabinet",
      panelThicknessMm: 18,
      backThicknessMm: 8,
      shelfThicknessMm: 18,
      shelfCount: 3,
      frontStyle: "double-door",
      frontThicknessMm: 18,
      plinthHeightMm: 100,
      worktopThicknessMm: 0,
      materialId: "material:white",
    });

    const source = serializeRoomCraftDocument(document);
    expect(parseRoomCraftDocumentFile(source)).toEqual(document);
    expect(roomCraftFileName(document)).toBe("My apartment.roomcraft");
  });

  it("exports semantic floor-plan geometry as standalone svg", () => {
    const document = createEmptyProject("project_svg", "Apartment");
    const level = document.levels[0]!;
    level.vertices.push(
      { id: "a", xMm: 0, yMm: 0 },
      { id: "b", xMm: 4000, yMm: 0 },
      { id: "c", xMm: 4000, yMm: 3000 },
      { id: "d", xMm: 0, yMm: 3000 },
    );
    level.walls.push(
      {
        id: "ab",
        startVertexId: "a",
        endVertexId: "b",
        thicknessMm: 120,
        heightMm: null,
      },
      {
        id: "bc",
        startVertexId: "b",
        endVertexId: "c",
        thicknessMm: 120,
        heightMm: null,
      },
      {
        id: "cd",
        startVertexId: "c",
        endVertexId: "d",
        thicknessMm: 120,
        heightMm: null,
      },
      {
        id: "da",
        startVertexId: "d",
        endVertexId: "a",
        thicknessMm: 120,
        heightMm: null,
      },
    );
    level.openings.push({
      id: "door_1",
      wallId: "ab",
      type: "door",
      offsetMm: 2000,
      widthMm: 900,
      heightMm: 2100,
      sillHeightMm: 0,
      flip: false,
      swing: "left",
    });
    level.objects.push({
      id: "table_1",
      assetId: "builtin:table",
      xMm: 2000,
      yMm: 1500,
      zMm: 0,
      rotationDeg: 15,
      widthMm: 1600,
      depthMm: 900,
      heightMm: 750,
      locked: false,
    });

    const svg = exportLevelSvg(document, level.id);

    expect(svg).toContain("<svg ");
    expect(svg).toContain('data-wall-id="ab"');
    expect(svg).toContain('data-opening-id="door_1"');
    expect(svg).toContain('data-object-id="table_1"');
    expect(svg).toContain("12.0 m²");
    expect(svg).not.toContain("<script");
  });

  it("rejects malformed native project files", () => {
    expect(() => parseRoomCraftDocumentFile("{not-json")).toThrow(
      "not valid JSON",
    );
  });
});
