import {
  createEmptyProject,
  type ObjectInstance,
} from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import { Mesh } from "three";
import { buildRoomSceneGraph } from "../src";

describe("shared 3D scene builder", () => {
  it("derives walls, room surfaces and furniture from the canonical document", () => {
    const document = createEmptyProject("project_scene");
    const level = document.levels[0]!;
    level.vertices.push(
      { id: "a", xMm: 0, yMm: 0 },
      { id: "b", xMm: 4000, yMm: 0 },
      { id: "c", xMm: 4000, yMm: 3000 },
      { id: "d", xMm: 0, yMm: 3000 },
    );
    level.walls.push(
      wall("ab", "a", "b"),
      wall("bc", "b", "c"),
      wall("cd", "c", "d"),
      wall("da", "d", "a"),
    );
    level.objects.push({
      id: "table_1",
      assetId: "builtin:table",
      xMm: 2000,
      yMm: 1500,
      zMm: 0,
      rotationDeg: 0,
      widthMm: 1600,
      depthMm: 900,
      heightMm: 750,
      locked: false,
    });

    const build = buildRoomSceneGraph(document, level.id, {
      showCeilings: true,
    });

    const kinds = new Map<string, number>();
    build.group.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const kind = String(child.userData.roomcraftKind ?? "unknown");
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    });

    expect(kinds.get("wall")).toBe(4);
    expect(kinds.get("room-surface")).toBe(2);
    expect(kinds.get("object")).toBe(5);
    expect(build.pending).toHaveLength(0);

    build.dispose();
  });

  it("uses the same derived cabinet parts as the parametric package", () => {
    const document = createEmptyProject("project_cabinet_scene");
    document.parametricAssets.push({
      id: "cabinet_1",
      kind: "cabinet",
      name: "Cabinet",
      panelThicknessMm: 18,
      backThicknessMm: 8,
      shelfThicknessMm: 18,
      shelfCount: 2,
      frontStyle: "double-door",
      frontThicknessMm: 18,
      plinthHeightMm: 100,
      worktopThicknessMm: 0,
      materialId: "material:white",
    });
    document.levels[0]!.objects.push({
      id: "cabinet_object",
      assetId: "parametric:cabinet_1",
      xMm: 0,
      yMm: 0,
      zMm: 0,
      rotationDeg: 0,
      widthMm: 800,
      depthMm: 400,
      heightMm: 2000,
      locked: false,
    });

    const build = buildRoomSceneGraph(
      document,
      document.levels[0]!.id,
    );
    const parts: string[] = [];
    build.group.traverse((child) => {
      if (
        child instanceof Mesh &&
        child.userData.roomcraftId === "cabinet_object"
      ) {
        parts.push(String(child.userData.roomcraftPart));
      }
    });

    expect(parts).toContain("side-left");
    expect(parts).toContain("side-right");
    expect(parts).toContain("back");
    expect(parts).toContain("door-left");
    expect(parts).toContain("door-right");
    expect(parts.filter((part) => part.startsWith("shelf-"))).toHaveLength(2);

    build.dispose();
  });

  it("loads external models through the injected resolver before export", async () => {
    const document = createEmptyProject("project_external_scene");
    const object: ObjectInstance = {
      id: "external_1",
      assetId: "catalog:chair@1",
      xMm: 0,
      yMm: 0,
      zMm: 0,
      rotationDeg: 0,
      widthMm: 500,
      depthMm: 500,
      heightMm: 900,
      locked: false,
    };
    document.levels[0]!.objects.push(object);

    const { Group, BoxGeometry, MeshStandardMaterial } = await import("three");
    const prototype = new Group();
    prototype.add(
      new Mesh(
        new BoxGeometry(1, 1, 1),
        new MeshStandardMaterial(),
      ),
    );

    const build = buildRoomSceneGraph(
      document,
      document.levels[0]!.id,
      {
        modelAssets: [
          {
            objectAssetId: object.assetId,
            contentUrl: "/chair.glb",
          },
        ],
        externalModelFailure: "reject",
        loadModelPrototype: async () => prototype,
      },
    );

    expect(build.pending).toHaveLength(1);
    await Promise.all(build.pending);

    const group = build.group.children.find(
      (child) => child.userData.roomcraftId === object.id,
    );
    expect(group?.userData.roomcraftUsesExternalModel).toBe(true);
    let externalMeshFound = false;
    group?.traverse((child) => {
      if (
        child instanceof Mesh &&
        child.userData.roomcraftExternalAsset === true
      ) {
        externalMeshFound = true;
      }
    });
    expect(externalMeshFound).toBe(true);

    build.dispose();
    prototype.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  });
});

function wall(
  id: string,
  startVertexId: string,
  endVertexId: string,
) {
  return {
    id,
    startVertexId,
    endVertexId,
    thicknessMm: 120,
    heightMm: null,
  };
}
