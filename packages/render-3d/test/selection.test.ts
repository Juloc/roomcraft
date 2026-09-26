import { describe, expect, it } from "vitest";
import { Group, Object3D } from "three";
import { semanticRoomSceneHit } from "../src";

describe("semanticRoomSceneHit", () => {
  it("resolves wall metadata from the closest semantic ancestor", () => {
    const wall = new Group();
    wall.userData.roomcraftId = "wall_1";
    wall.userData.roomcraftKind = "wall";
    const part = new Object3D();
    wall.add(part);

    expect(semanticRoomSceneHit(part)).toEqual({
      id: "wall_1",
      kind: "wall",
    });
  });

  it("maps room surfaces to the shared room selection kind", () => {
    const floor = new Object3D();
    floor.userData.roomcraftId = "room:a|b|c";
    floor.userData.roomcraftKind = "room-surface";

    expect(semanticRoomSceneHit(floor)).toEqual({
      id: "room:a|b|c",
      kind: "room",
    });
  });

  it("ignores scene helpers without RoomCraft semantic metadata", () => {
    expect(semanticRoomSceneHit(new Object3D())).toBeNull();
  });
});
