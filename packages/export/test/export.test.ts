import { createEmptyProject } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import {
  exportLevelSvg,
  exportProjectGlb,
  glbProjectFileName,
  parseRoomCraftDocumentFile,
  rasterFloorPlanFileName,
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
    expect(
      rasterFloorPlanFileName(document, document.levels[0]!.id, "png"),
    ).toBe("My apartment-Ground floor.png");
    expect(
      rasterFloorPlanFileName(document, document.levels[0]!.id, "jpeg"),
    ).toBe("My apartment-Ground floor.jpg");
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
  it("exports a binary glTF 2.0 project from the shared 3D scene builder", async () => {
    const originalFileReader = globalThis.FileReader;
    globalThis.FileReader = TestFileReader as unknown as typeof FileReader;

    try {
      const document = createEmptyProject("project_glb_export", "GLB apartment");
      const level = document.levels[0]!;
      level.vertices.push(
        { id: "a", xMm: 0, yMm: 0 },
        { id: "b", xMm: 4000, yMm: 0 },
      );
      level.walls.push({
        id: "wall_1",
        startVertexId: "a",
        endVertexId: "b",
        thicknessMm: 120,
        heightMm: null,
      });
      level.objects.push({
        id: "table_1",
        assetId: "builtin:table",
        xMm: 2000,
        yMm: 1000,
        zMm: 0,
        rotationDeg: 15,
        widthMm: 1600,
        depthMm: 900,
        heightMm: 750,
        locked: false,
      });

      const binary = await exportProjectGlb(document);
      const bytes = new Uint8Array(binary);
      const view = new DataView(binary);

      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("glTF");
      expect(view.getUint32(4, true)).toBe(2);
      expect(view.getUint32(8, true)).toBe(binary.byteLength);
      expect(glbProjectFileName(document)).toBe("GLB apartment.glb");
    } finally {
      if (originalFileReader) {
        globalThis.FileReader = originalFileReader;
      } else {
        delete (globalThis as { FileReader?: typeof FileReader }).FileReader;
      }
    }
  });

});


class TestFileReader {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onloadend: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.call(
        this as unknown as FileReader,
        {} as ProgressEvent<FileReader>,
      );
    });
  }
}
