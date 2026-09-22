import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  createNormalizedModelInstance,
  disposeModelResources,
} from "../src";

describe("GLB model normalization", () => {
  it("fits imported geometry to exact RoomCraft dimensions and places it on the floor", () => {
    const prototype = new Group();
    const material = new MeshStandardMaterial();
    const geometry = new BoxGeometry(2, 4, 1);
    prototype.add(new Mesh(geometry, material));

    const instance = createNormalizedModelInstance(
      prototype,
      {
        widthMm: 1000,
        depthMm: 500,
        heightMm: 2000,
      },
      "object_1",
    );
    instance.updateMatrixWorld(true);

    const bounds = new Box3().setFromObject(instance);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());

    expect(size.x).toBeCloseTo(1);
    expect(size.y).toBeCloseTo(2);
    expect(size.z).toBeCloseTo(0.5);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);

    let markedMeshes = 0;
    instance.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      markedMeshes += 1;
      expect(child.userData.roomcraftId).toBe("object_1");
      expect(child.userData.roomcraftExternalAsset).toBe(true);
    });
    expect(markedMeshes).toBe(1);

    // The normalized instance shares resources with the prototype. Only the
    // prototype owns their final disposal in the renderer cache.
    disposeModelResources(prototype);
  });

  it("rejects target dimensions that cannot form a physical volume", () => {
    const prototype = new Group();
    prototype.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));

    expect(() =>
      createNormalizedModelInstance(
        prototype,
        { widthMm: 0, depthMm: 500, heightMm: 500 },
        "object_1",
      ),
    ).toThrow("widthMm must be positive");

    disposeModelResources(prototype);
  });
});
