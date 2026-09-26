import { createEmptyProject } from "@roomcraft/document";
import { describe, expect, it } from "vitest";
import { AddBlueprintCommand, AddLevelCommand, AddObjectCommand, AddOpeningCommand, AddParametricAssetCommand, AddWallCommand, BatchCommand, CalibrateBlueprintCommand, CommandHistory, MoveBlueprintLayerCommand, MoveWallCommand, RemoveBlueprintCommand, RemoveLevelCommand, RemoveObjectCommand, RemoveParametricAssetCommand, SetRoomSurfaceMaterialsCommand, SetWallLengthCommand, SetWallMaterialsCommand, UpdateLevelCommand, UpdateObjectCommand, UpdateParametricAssetCommand } from "../src";

describe("CommandHistory", () => {
  it("adds a wall through a command and restores it through undo/redo", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));

    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );

    expect(history.document.levels[0]?.walls).toHaveLength(1);
    expect(history.document.levels[0]?.vertices).toHaveLength(2);

    history.undo();
    expect(history.document.levels[0]?.walls).toHaveLength(0);
    expect(history.document.levels[0]?.vertices).toHaveLength(0);

    history.redo();
    expect(history.document.levels[0]?.walls[0]?.id).toBe("wall_1");
  });

  it("adds an opening to a wall and restores it through undo/redo", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));

    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new AddOpeningCommand({
        levelId: "level_ground",
        opening: {
          id: "door_1",
          wallId: "wall_1",
          type: "door",
          offsetMm: 2000,
          widthMm: 900,
          heightMm: 2100,
          sillHeightMm: 0,
          flip: false,
          swing: "left",
        },
      }),
    );

    expect(history.document.levels[0]?.openings[0]?.id).toBe("door_1");

    history.undo();
    expect(history.document.levels[0]?.openings).toHaveLength(0);

    history.redo();
    expect(history.document.levels[0]?.openings[0]?.wallId).toBe("wall_1");
  });

  it("rejects overlapping openings on the same wall", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new AddOpeningCommand({
        levelId: "level_ground",
        opening: {
          id: "door_1",
          wallId: "wall_1",
          type: "door",
          offsetMm: 1800,
          widthMm: 900,
          heightMm: 2100,
          sillHeightMm: 0,
          flip: false,
          swing: "left",
        },
      }),
    );

    expect(() =>
      history.execute(
        new AddOpeningCommand({
          levelId: "level_ground",
          opening: {
            id: "door_2",
            wallId: "wall_1",
            type: "door",
            offsetMm: 2200,
            widthMm: 900,
            heightMm: 2100,
            sillHeightMm: 0,
            flip: false,
            swing: "right",
          },
        }),
      ),
    ).toThrow("overlaps opening door_1");
  });
  it("sets an exact wall length and restores it through undo/redo", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new SetWallLengthCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        lengthMm: 5000,
      }),
    );

    expect(history.document.levels[0]?.vertices.find((vertex) => vertex.id === "vertex_2")).toMatchObject({
      xMm: 5000,
      yMm: 0,
    });

    history.undo();
    expect(history.document.levels[0]?.vertices.find((vertex) => vertex.id === "vertex_2")).toMatchObject({
      xMm: 4000,
      yMm: 0,
    });

    history.redo();
    expect(history.document.levels[0]?.vertices.find((vertex) => vertex.id === "vertex_2")).toMatchObject({
      xMm: 5000,
      yMm: 0,
    });
  });

  it("moves a shared endpoint so connected walls stay topologically connected", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_2",
        start: { kind: "existing", vertexId: "vertex_2" },
        end: { kind: "new", vertex: { id: "vertex_3", xMm: 4000, yMm: 3000 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new SetWallLengthCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        lengthMm: 5000,
      }),
    );

    const level = history.document.levels[0];
    expect(level?.vertices.find((vertex) => vertex.id === "vertex_2")).toMatchObject({
      xMm: 5000,
      yMm: 0,
    });
    expect(level?.walls.find((wall) => wall.id === "wall_2")?.startVertexId).toBe("vertex_2");
  });

  it("rejects shortening a wall when an existing opening would no longer fit", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );
    history.execute(
      new AddOpeningCommand({
        levelId: "level_ground",
        opening: {
          id: "door_1",
          wallId: "wall_1",
          type: "door",
          offsetMm: 3300,
          widthMm: 900,
          heightMm: 2100,
          sillHeightMm: 0,
          flip: false,
          swing: "left",
        },
      }),
    );

    expect(() =>
      history.execute(
        new SetWallLengthCommand({
          levelId: "level_ground",
          wallId: "wall_1",
          lengthMm: 3000,
        }),
      ),
    ).toThrow("does not fit inside wall wall_1");
  });

  it("adds and calibrates a blueprint through undoable commands", () => {
    const history = new CommandHistory(createEmptyProject("project_1"));

    history.execute(
      new AddBlueprintCommand({
        levelId: "level_ground",
        blueprint: {
          id: "blueprint_1",
          assetId: "asset_1",
          sourceWidthPx: 2000,
          sourceHeightPx: 1000,
          crop: {
            leftPx: 0,
            topPx: 0,
            widthPx: 2000,
            heightPx: 1000,
          },
          originXmm: 0,
          originYmm: 0,
          millimetresPerPixel: 2,
          rotationDeg: 0,
          opacity: 0.5,
          locked: true,
          visible: true,
        },
      }),
    );

    history.execute(
      new CalibrateBlueprintCommand({
        levelId: "level_ground",
        blueprintId: "blueprint_1",
        firstPlanPoint: { xMm: 0, yMm: 0 },
        secondPlanPoint: { xMm: 2000, yMm: 0 },
        knownLengthMm: 4000,
      }),
    );

    expect(history.document.levels[0]?.blueprints[0]?.millimetresPerPixel).toBe(4);

    history.undo();
    expect(history.document.levels[0]?.blueprints[0]?.millimetresPerPixel).toBe(2);

    history.undo();
    expect(history.document.levels[0]?.blueprints).toHaveLength(0);

    history.redo();
    expect(history.document.levels[0]?.blueprints[0]?.assetId).toBe("asset_1");
  });

  it("reorders blueprint layers and restores the order through undo", () => {
    const history = new CommandHistory(createEmptyProject("project_layers"));
    const baseBlueprint = {
      assetId: "asset_1",
      sourceWidthPx: 1000,
      sourceHeightPx: 800,
      crop: { leftPx: 0, topPx: 0, widthPx: 1000, heightPx: 800 },
      originXmm: 0,
      originYmm: 0,
      millimetresPerPixel: 2,
      rotationDeg: 0,
      opacity: 0.5,
      locked: false,
      visible: true,
    };

    history.execute(
      new AddBlueprintCommand({
        levelId: "level_ground",
        blueprint: { ...baseBlueprint, id: "blueprint_a" },
      }),
    );
    history.execute(
      new AddBlueprintCommand({
        levelId: "level_ground",
        blueprint: { ...baseBlueprint, id: "blueprint_b", assetId: "asset_2" },
      }),
    );

    history.execute(
      new MoveBlueprintLayerCommand({
        levelId: "level_ground",
        blueprintId: "blueprint_a",
        toIndex: 1,
      }),
    );

    expect(history.document.levels[0]?.blueprints.map((blueprint) => blueprint.id)).toEqual([
      "blueprint_b",
      "blueprint_a",
    ]);

    history.undo();
    expect(history.document.levels[0]?.blueprints.map((blueprint) => blueprint.id)).toEqual([
      "blueprint_a",
      "blueprint_b",
    ]);
  });

  it("removes a blueprint and restores its original layer index through undo", () => {
    const history = new CommandHistory(createEmptyProject("project_remove_blueprint"));
    const baseBlueprint = {
      sourceWidthPx: 1000,
      sourceHeightPx: 800,
      crop: { leftPx: 0, topPx: 0, widthPx: 1000, heightPx: 800 },
      originXmm: 0,
      originYmm: 0,
      millimetresPerPixel: 2,
      rotationDeg: 0,
      opacity: 0.5,
      locked: false,
      visible: true,
    };

    history.execute(
      new AddBlueprintCommand({
        levelId: "level_ground",
        blueprint: { ...baseBlueprint, id: "blueprint_a", assetId: "asset_a" },
      }),
    );
    history.execute(
      new AddBlueprintCommand({
        levelId: "level_ground",
        blueprint: { ...baseBlueprint, id: "blueprint_b", assetId: "asset_b" },
      }),
    );
    history.execute(
      new AddBlueprintCommand({
        levelId: "level_ground",
        blueprint: { ...baseBlueprint, id: "blueprint_c", assetId: "asset_c" },
      }),
    );

    history.execute(new RemoveBlueprintCommand("level_ground", "blueprint_b"));
    expect(history.document.levels[0]?.blueprints.map((blueprint) => blueprint.id)).toEqual([
      "blueprint_a",
      "blueprint_c",
    ]);

    history.undo();
    expect(history.document.levels[0]?.blueprints.map((blueprint) => blueprint.id)).toEqual([
      "blueprint_a",
      "blueprint_b",
      "blueprint_c",
    ]);
  });

  it("adds, updates and removes an object through undoable commands", () => {
    const history = new CommandHistory(createEmptyProject("project_objects"));
    const object = {
      id: "object_1",
      assetId: "builtin:table",
      xMm: 2000,
      yMm: 1500,
      zMm: 0,
      rotationDeg: 0,
      widthMm: 1600,
      depthMm: 900,
      heightMm: 760,
      locked: false,
    };

    history.execute(
      new AddObjectCommand({
        levelId: "level_ground",
        object,
      }),
    );
    expect(history.document.levels[0]?.objects[0]).toEqual(object);

    history.execute(
      new UpdateObjectCommand({
        levelId: "level_ground",
        object: {
          ...object,
          xMm: 2500,
          rotationDeg: 90,
          widthMm: 1800,
        },
      }),
    );
    expect(history.document.levels[0]?.objects[0]).toMatchObject({
      xMm: 2500,
      rotationDeg: 90,
      widthMm: 1800,
    });

    history.execute(new RemoveObjectCommand("level_ground", "object_1"));
    expect(history.document.levels[0]?.objects).toEqual([]);

    history.undo();
    expect(history.document.levels[0]?.objects[0]).toMatchObject({
      id: "object_1",
      xMm: 2500,
      rotationDeg: 90,
    });

    history.undo();
    expect(history.document.levels[0]?.objects[0]).toEqual(object);
  });

  it("rejects changing an object's asset id through update", () => {
    const history = new CommandHistory(createEmptyProject("project_objects"));
    const object = {
      id: "object_1",
      assetId: "builtin:box",
      xMm: 0,
      yMm: 0,
      zMm: 0,
      rotationDeg: 0,
      widthMm: 800,
      depthMm: 600,
      heightMm: 800,
      locked: false,
    };
    history.execute(new AddObjectCommand({ levelId: "level_ground", object }));

    expect(() =>
      history.execute(
        new UpdateObjectCommand({
          levelId: "level_ground",
          object: { ...object, assetId: "builtin:bed" },
        }),
      ),
    ).toThrow("assetId is immutable");
  });

  it("adds, edits and removes levels through undoable commands", () => {
    const history = new CommandHistory(createEmptyProject("project_levels"));

    history.execute(
      new AddLevelCommand({
        level: {
          id: "level_upper",
          name: "Upper floor",
          elevationMm: 2700,
          defaultWallHeightMm: 2500,
          floorThicknessMm: 200,
          vertices: [],
          walls: [],
          openings: [],
          objects: [],
          blueprints: [],
          roomFinishes: [],
        },
      }),
    );

    expect(history.document.levels.map((level) => level.id)).toEqual([
      "level_ground",
      "level_upper",
    ]);

    history.execute(
      new UpdateLevelCommand({
        levelId: "level_upper",
        name: "First floor",
        elevationMm: 2800,
        floorThicknessMm: 220,
      }),
    );

    expect(history.document.levels[1]).toMatchObject({
      name: "First floor",
      elevationMm: 2800,
      floorThicknessMm: 220,
    });

    history.execute(new RemoveLevelCommand("level_upper"));
    expect(history.document.levels).toHaveLength(1);

    history.undo();
    expect(history.document.levels[1]).toMatchObject({
      id: "level_upper",
      name: "First floor",
      elevationMm: 2800,
    });

    history.undo();
    expect(history.document.levels[1]).toMatchObject({
      name: "Upper floor",
      elevationMm: 2700,
      floorThicknessMm: 200,
    });

    history.undo();
    expect(history.document.levels).toHaveLength(1);

    history.redo();
    expect(history.document.levels[1]?.id).toBe("level_upper");
  });

  it("does not allow deleting the last level", () => {
    const history = new CommandHistory(createEmptyProject("project_levels"));

    expect(() =>
      history.execute(new RemoveLevelCommand("level_ground")),
    ).toThrow("keep at least one level");
  });

  it("assigns wall side materials and restores them through undo", () => {
    const history = new CommandHistory(createEmptyProject("project_material_wall"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new SetWallMaterialsCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        leftMaterialId: "material:beige",
        rightMaterialId: "material:white",
      }),
    );

    expect(history.document.levels[0]?.walls[0]).toMatchObject({
      leftMaterialId: "material:beige",
      rightMaterialId: "material:white",
    });

    history.undo();
    expect(history.document.levels[0]?.walls[0]).toMatchObject({
      leftMaterialId: null,
      rightMaterialId: null,
    });
  });

  it("assigns room floor and ceiling materials without persisting room geometry", () => {
    const history = new CommandHistory(createEmptyProject("project_material_room"));

    history.execute(
      new SetRoomSurfaceMaterialsCommand({
        levelId: "level_ground",
        roomKey: "room:a|b|c|d",
        floorMaterialId: "material:oak",
        ceilingMaterialId: "material:white",
      }),
    );

    expect(history.document.levels[0]?.roomFinishes).toEqual([
      {
        roomKey: "room:a|b|c|d",
        floorMaterialId: "material:oak",
        ceilingMaterialId: "material:white",
      },
    ]);

    history.undo();
    expect(history.document.levels[0]?.roomFinishes).toEqual([]);
  });

  it("rejects surface assignments to unknown materials", () => {
    const history = new CommandHistory(createEmptyProject("project_material_invalid"));

    expect(() =>
      history.execute(
        new SetRoomSurfaceMaterialsCommand({
          levelId: "level_ground",
          roomKey: "room:test",
          floorMaterialId: "material:missing",
        }),
      ),
    ).toThrow("references missing material");
  });

  it("adds and updates parametric cabinet definitions through undo", () => {
    const history = new CommandHistory(createEmptyProject("project_parametric_commands"));
    const definition = {
      id: "cabinet_1",
      kind: "cabinet" as const,
      name: "Hall cabinet",
      panelThicknessMm: 18,
      backThicknessMm: 8,
      shelfThicknessMm: 18,
      shelfCount: 3,
      frontStyle: "double-door" as const,
      frontThicknessMm: 18,
      plinthHeightMm: 100,
      worktopThicknessMm: 0,
      materialId: "material:white",
    };

    history.execute(new AddParametricAssetCommand({ definition }));
    expect(history.document.parametricAssets).toEqual([definition]);

    history.execute(
      new UpdateParametricAssetCommand({
        definition: { ...definition, shelfCount: 4, materialId: "material:oak" },
      }),
    );
    expect(history.document.parametricAssets[0]).toMatchObject({
      shelfCount: 4,
      materialId: "material:oak",
    });

    history.undo();
    expect(history.document.parametricAssets[0]).toEqual(definition);

    history.undo();
    expect(history.document.parametricAssets).toEqual([]);
  });

  it("prevents deleting a parametric definition while an object uses it", () => {
    const history = new CommandHistory(createEmptyProject("project_parametric_in_use"));
    const definition = {
      id: "cabinet_1",
      kind: "cabinet" as const,
      name: "Cabinet",
      panelThicknessMm: 18,
      backThicknessMm: 8,
      shelfThicknessMm: 18,
      shelfCount: 3,
      frontStyle: "double-door" as const,
      frontThicknessMm: 18,
      plinthHeightMm: 100,
      worktopThicknessMm: 0,
      materialId: "material:white",
    };
    history.execute(new AddParametricAssetCommand({ definition }));
    history.execute(
      new AddObjectCommand({
        levelId: "level_ground",
        object: {
          id: "object_1",
          assetId: "parametric:cabinet_1",
          xMm: 0,
          yMm: 0,
          zMm: 0,
          rotationDeg: 0,
          widthMm: 800,
          depthMm: 400,
          heightMm: 2000,
          locked: false,
        },
      }),
    );

    expect(() =>
      history.execute(new RemoveParametricAssetCommand("cabinet_1")),
    ).toThrow("is still used by object object_1");

    history.execute(new RemoveObjectCommand("level_ground", "object_1"));
    history.execute(new RemoveParametricAssetCommand("cabinet_1"));
    expect(history.document.parametricAssets).toEqual([]);

    history.undo();
    expect(history.document.parametricAssets[0]?.id).toBe("cabinet_1");
  });

  it("rejects cabinet definition changes that make placed instances impossible", () => {
    const history = new CommandHistory(createEmptyProject("project_parametric_limits"));
    const definition = {
      id: "cabinet_1",
      kind: "cabinet" as const,
      name: "Cabinet",
      panelThicknessMm: 18,
      backThicknessMm: 8,
      shelfThicknessMm: 18,
      shelfCount: 3,
      frontStyle: "open" as const,
      frontThicknessMm: 18,
      plinthHeightMm: 100,
      worktopThicknessMm: 0,
      materialId: "material:white",
    };
    history.execute(new AddParametricAssetCommand({ definition }));
    history.execute(
      new AddObjectCommand({
        levelId: "level_ground",
        object: {
          id: "object_1",
          assetId: "parametric:cabinet_1",
          xMm: 0,
          yMm: 0,
          zMm: 0,
          rotationDeg: 0,
          widthMm: 800,
          depthMm: 400,
          heightMm: 2000,
          locked: false,
        },
      }),
    );

    expect(() =>
      history.execute(
        new UpdateParametricAssetCommand({
          definition: { ...definition, shelfCount: 30 },
        }),
      ),
    ).toThrow("heightMm must be at least");
  });


  it("moves a complete wall as one undoable command", () => {
    const history = new CommandHistory(createEmptyProject("project_move_wall"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new MoveWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        deltaXmm: 500,
        deltaYmm: -250,
      }),
    );

    expect(history.document.levels[0]?.vertices).toEqual([
      { id: "vertex_1", xMm: 500, yMm: -250 },
      { id: "vertex_2", xMm: 4500, yMm: -250 },
    ]);

    history.undo();
    expect(history.document.levels[0]?.vertices).toEqual([
      { id: "vertex_1", xMm: 0, yMm: 0 },
      { id: "vertex_2", xMm: 4000, yMm: 0 },
    ]);
  });

  it("moves shared endpoints with a wall so connected geometry stays connected", () => {
    const history = new CommandHistory(createEmptyProject("project_move_connected"));
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        start: { kind: "new", vertex: { id: "vertex_1", xMm: 0, yMm: 0 } },
        end: { kind: "new", vertex: { id: "vertex_2", xMm: 4000, yMm: 0 } },
        thicknessMm: 120,
      }),
    );
    history.execute(
      new AddWallCommand({
        levelId: "level_ground",
        wallId: "wall_2",
        start: { kind: "existing", vertexId: "vertex_2" },
        end: { kind: "new", vertex: { id: "vertex_3", xMm: 4000, yMm: 3000 } },
        thicknessMm: 120,
      }),
    );

    history.execute(
      new MoveWallCommand({
        levelId: "level_ground",
        wallId: "wall_1",
        deltaXmm: 1000,
        deltaYmm: 500,
      }),
    );

    expect(
      history.document.levels[0]?.vertices.find((vertex) => vertex.id === "vertex_2"),
    ).toMatchObject({ xMm: 5000, yMm: 500 });
    expect(
      history.document.levels[0]?.walls.find((wall) => wall.id === "wall_2")?.startVertexId,
    ).toBe("vertex_2");
  });

  it("executes a batch as one undo entry", () => {
    const history = new CommandHistory(createEmptyProject("project_batch"));
    const objectA = {
      id: "object_a",
      assetId: "builtin:box",
      xMm: 0,
      yMm: 0,
      zMm: 0,
      rotationDeg: 0,
      widthMm: 800,
      depthMm: 600,
      heightMm: 800,
      locked: false,
    };
    const objectB = { ...objectA, id: "object_b", xMm: 1000 };

    history.execute(
      new BatchCommand([
        new AddObjectCommand({ levelId: "level_ground", object: objectA }),
        new AddObjectCommand({ levelId: "level_ground", object: objectB }),
      ]),
    );

    expect(history.document.levels[0]?.objects.map((object) => object.id)).toEqual([
      "object_a",
      "object_b",
    ]);

    history.undo();
    expect(history.document.levels[0]?.objects).toEqual([]);

    history.redo();
    expect(history.document.levels[0]?.objects).toHaveLength(2);
  });

});
