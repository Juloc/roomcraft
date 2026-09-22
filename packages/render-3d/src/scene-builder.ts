import {
  getBuiltinAssetDefinition,
  type BuiltinPrimitiveKind,
} from "@roomcraft/catalog";
import type {
  Level,
  MaterialDefinition,
  ObjectInstance,
  Opening,
  ParametricCabinetDefinition,
  ProjectDocument,
  Vertex,
  Wall,
} from "@roomcraft/document";
import { analyzePlanarFaces, mmToMetres } from "@roomcraft/geometry";
import {
  deriveCabinetParts,
  parseParametricAssetId,
} from "@roomcraft/parametric";
import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
} from "three";
import {
  createNormalizedModelInstance,
  loadGlbPrototype,
  type RuntimeModelAsset,
} from "./models";

export type RoomSceneLevelScope = "active" | "all";

export interface RoomSceneGraphOptions {
  levelScope?: RoomSceneLevelScope;
  modelAssets?: readonly RuntimeModelAsset[];
  showCeilings?: boolean;
  externalModelFailure?: "record" | "reject";
  loadModelPrototype?: (contentUrl: string) => Promise<Group>;
}

export interface RoomSceneGraphBuild {
  group: Group;
  levels: readonly Level[];
  pending: readonly Promise<void>[];
  dispose(): void;
}

export function buildRoomSceneGraph(
  document: ProjectDocument,
  levelId: string,
  options: RoomSceneGraphOptions = {},
): RoomSceneGraphBuild {
  const activeLevel = document.levels.find(
    (candidate) => candidate.id === levelId,
  );
  if (!activeLevel) throw new Error(`Level ${levelId} does not exist.`);

  const levels =
    options.levelScope === "all" ? document.levels : [activeLevel];
  const generated = new Group();
  generated.name = "RoomCraft";
  generated.userData.roomcraftProjectId = document.id;
  generated.userData.roomcraftSchemaVersion = document.schemaVersion;

  const ownedMaterials = new Set<Material>();
  const materialById = new Map(
    document.materials.map((definition) => [definition.id, definition]),
  );
  const materialCache = new Map<string, MeshStandardMaterial>();
  const parametricById = new Map(
    document.parametricAssets.map((definition) => [definition.id, definition]),
  );
  const modelAssets = new Map(
    (options.modelAssets ?? []).map((asset) => [
      asset.objectAssetId,
      asset,
    ]),
  );
  const pending: Promise<void>[] = [];
  let disposed = false;

  const wallMaterial = own(
    new MeshStandardMaterial({
      color: new Color(0xc9c7c2),
      roughness: 0.82,
      metalness: 0,
    }),
  );
  const defaultSurfaceMaterial = own(
    new MeshStandardMaterial({
      color: new Color(0xe4e0d8),
      roughness: 0.92,
      metalness: 0,
      side: DoubleSide,
    }),
  );
  const objectMaterial = own(
    new MeshStandardMaterial({
      color: new Color(0xa89f91),
      roughness: 0.78,
      metalness: 0,
    }),
  );

  for (const level of levels) buildLevel(level);

  return {
    group: generated,
    levels,
    pending,
    dispose() {
      if (disposed) return;
      disposed = true;

      generated.traverse((child) => {
        if (
          child instanceof Mesh &&
          child.userData.roomcraftExternalAsset !== true
        ) {
          child.geometry.dispose();
        }
      });
      generated.clear();

      for (const material of ownedMaterials) material.dispose();
      ownedMaterials.clear();
      materialCache.clear();
    },
  };

  function own<T extends Material>(material: T): T {
    ownedMaterials.add(material);
    return material;
  }

  function projectMaterial(
    materialId: string | null,
    fallback: MeshStandardMaterial,
  ): MeshStandardMaterial {
    if (!materialId) return fallback;

    const cached = materialCache.get(materialId);
    if (cached) return cached;

    const definition = materialById.get(materialId);
    if (!definition) return fallback;

    const material = own(
      materialFromDefinition(definition),
    );
    materialCache.set(materialId, material);
    return material;
  }

  function buildLevel(level: Level): void {
    const vertices = new Map(
      level.vertices.map((vertex) => [vertex.id, vertex]),
    );

    buildRoomSurfaces(level);

    for (const wall of level.walls) {
      const start = vertices.get(wall.startVertexId);
      const end = vertices.get(wall.endVertexId);
      if (!start || !end) continue;

      const openings = level.openings
        .filter((opening) => opening.wallId === wall.id)
        .sort((a, b) => a.offsetMm - b.offsetMm);
      buildWall(level, wall, start, end, openings);
    }

    for (const object of level.objects) buildObject(level, object);
  }

  function buildWall(
    level: Level,
    wall: Wall,
    start: Vertex,
    end: Vertex,
    openings: Opening[],
  ): void {
    const dxMm = end.xMm - start.xMm;
    const dzMm = end.yMm - start.yMm;
    const lengthMm = Math.hypot(dxMm, dzMm);
    if (lengthMm <= 0) return;

    const wallHeightMm =
      wall.heightMm ?? level.defaultWallHeightMm;
    const ux = dxMm / lengthMm;
    const uz = dzMm / lengthMm;
    const rotationY = -Math.atan2(dzMm, dxMm);
    let cursorMm = 0;

    for (const opening of openings) {
      const openingStartMm =
        opening.offsetMm - opening.widthMm / 2;
      const openingEndMm =
        opening.offsetMm + opening.widthMm / 2;
      if (
        openingStartMm < cursorMm ||
        openingEndMm > lengthMm
      ) {
        throw new Error(
          `Opening ${opening.id} is invalid for wall ${wall.id}.`,
        );
      }

      addWallBlock(
        level,
        wall,
        start,
        ux,
        uz,
        rotationY,
        cursorMm,
        openingStartMm,
        0,
        wallHeightMm,
        `solid-before-${opening.id}`,
      );

      if (opening.sillHeightMm > 0) {
        addWallBlock(
          level,
          wall,
          start,
          ux,
          uz,
          rotationY,
          openingStartMm,
          openingEndMm,
          0,
          opening.sillHeightMm,
          `sill-${opening.id}`,
        );
      }

      const openingTopMm =
        opening.sillHeightMm + opening.heightMm;
      if (openingTopMm < wallHeightMm) {
        addWallBlock(
          level,
          wall,
          start,
          ux,
          uz,
          rotationY,
          openingStartMm,
          openingEndMm,
          openingTopMm,
          wallHeightMm,
          `header-${opening.id}`,
        );
      }

      cursorMm = openingEndMm;
    }

    addWallBlock(
      level,
      wall,
      start,
      ux,
      uz,
      rotationY,
      cursorMm,
      lengthMm,
      0,
      wallHeightMm,
      "solid-end",
    );
  }

  function addWallBlock(
    level: Level,
    wall: Wall,
    start: Vertex,
    ux: number,
    uz: number,
    rotationY: number,
    startDistanceMm: number,
    endDistanceMm: number,
    bottomMm: number,
    topMm: number,
    part: string,
  ): void {
    const blockLengthMm =
      endDistanceMm - startDistanceMm;
    const blockHeightMm = topMm - bottomMm;
    if (blockLengthMm <= 0 || blockHeightMm <= 0) return;

    const centerDistanceMm =
      (startDistanceMm + endDistanceMm) / 2;
    const geometry = new BoxGeometry(
      mmToMetres(blockLengthMm),
      mmToMetres(blockHeightMm),
      mmToMetres(wall.thicknessMm),
    );
    const mesh = new Mesh(
      geometry,
      wallMaterialsFor(wall),
    );
    mesh.name = `${wall.id}:${part}`;
    mesh.userData.roomcraftId = wall.id;
    mesh.userData.roomcraftKind = "wall";
    mesh.userData.roomcraftPart = part;
    mesh.userData.roomcraftLeftMaterialId =
      wall.leftMaterialId ?? null;
    mesh.userData.roomcraftRightMaterialId =
      wall.rightMaterialId ?? null;
    mesh.position.set(
      mmToMetres(
        start.xMm + ux * centerDistanceMm,
      ),
      mmToMetres(
        level.elevationMm +
          bottomMm +
          blockHeightMm / 2,
      ),
      mmToMetres(
        start.yMm + uz * centerDistanceMm,
      ),
    );
    mesh.rotation.y = rotationY;
    generated.add(mesh);
  }

  function buildRoomSurfaces(level: Level): void {
    const analysis = analyzePlanarFaces(
      level.vertices,
      level.walls,
    );
    if (analysis.issues.length > 0) return;

    const finishByKey = new Map(
      level.roomFinishes.map((finish) => [
        finish.roomKey,
        finish,
      ]),
    );

    for (const face of analysis.faces) {
      const finish = finishByKey.get(face.key);
      addRoomSurface(
        level,
        face.key,
        face.points,
        level.elevationMm + 1,
        finish?.floorMaterialId ?? null,
        "floor",
      );

      if (options.showCeilings) {
        addRoomSurface(
          level,
          face.key,
          face.points,
          level.elevationMm +
            level.defaultWallHeightMm -
            1,
          finish?.ceilingMaterialId ?? null,
          "ceiling",
        );
      }
    }
  }

  function addRoomSurface(
    level: Level,
    roomKey: string,
    points: readonly { xMm: number; yMm: number }[],
    elevationMm: number,
    materialId: string | null,
    part: "floor" | "ceiling",
  ): void {
    if (points.length < 3) return;

    const first = points[0];
    if (!first) return;

    const shape = new Shape();
    shape.moveTo(
      mmToMetres(first.xMm),
      mmToMetres(first.yMm),
    );
    for (const point of points.slice(1)) {
      shape.lineTo(
        mmToMetres(point.xMm),
        mmToMetres(point.yMm),
      );
    }
    shape.closePath();

    const mesh = new Mesh(
      new ShapeGeometry(shape),
      projectMaterial(
        materialId,
        defaultSurfaceMaterial,
      ),
    );
    mesh.name = `${level.id}:${roomKey}:${part}`;
    mesh.userData.roomcraftId = roomKey;
    mesh.userData.roomcraftKind = "room-surface";
    mesh.userData.roomcraftPart = part;
    mesh.userData.roomcraftMaterialId = materialId;
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = mmToMetres(elevationMm);
    generated.add(mesh);
  }

  function buildObject(
    level: Level,
    object: ObjectInstance,
  ): void {
    const parametricDefinitionId =
      parseParametricAssetId(object.assetId);
    if (parametricDefinitionId) {
      const definition =
        parametricById.get(parametricDefinitionId);
      if (!definition) {
        throw new Error(
          `Object ${object.id} references missing parametric asset ${parametricDefinitionId}.`,
        );
      }
      buildParametricCabinet(
        level,
        object,
        definition,
      );
      return;
    }

    const runtimeAsset = modelAssets.get(object.assetId);
    if (runtimeAsset) {
      buildExternalObject(
        level,
        object,
        runtimeAsset,
      );
      return;
    }

    const definition =
      getBuiltinAssetDefinition(object.assetId);
    const primitive: BuiltinPrimitiveKind =
      definition?.primitive ?? "box";
    const group = createObjectGroup(level, object);
    addPrimitiveParts(group, object, primitive);
    generated.add(group);
  }

  function buildParametricCabinet(
    level: Level,
    object: ObjectInstance,
    definition: ParametricCabinetDefinition,
  ): void {
    const group = createObjectGroup(level, object);
    group.userData.roomcraftParametricAssetId =
      definition.id;

    for (const part of deriveCabinetParts(
      definition,
      {
        widthMm: object.widthMm,
        depthMm: object.depthMm,
        heightMm: object.heightMm,
      },
    )) {
      addObjectPart(
        group,
        object,
        part.widthMm,
        part.heightMm,
        part.depthMm,
        part.xMm,
        part.yMm,
        part.zMm,
        part.id,
        part.materialId,
      );
    }

    generated.add(group);
  }

  function createObjectGroup(
    level: Level,
    object: ObjectInstance,
  ): Group {
    const group = new Group();
    group.name = object.id;
    group.userData.roomcraftId = object.id;
    group.userData.roomcraftKind = "object";
    group.userData.roomcraftAssetId = object.assetId;
    group.position.set(
      mmToMetres(object.xMm),
      mmToMetres(level.elevationMm + object.zMm),
      mmToMetres(object.yMm),
    );
    group.rotation.y =
      -(object.rotationDeg * Math.PI) / 180;
    return group;
  }

  function buildExternalObject(
    level: Level,
    object: ObjectInstance,
    runtimeAsset: RuntimeModelAsset,
  ): void {
    const group = createObjectGroup(level, object);
    group.userData.roomcraftUsesExternalModel = true;

    addObjectPart(
      group,
      object,
      object.widthMm,
      object.heightMm,
      object.depthMm,
      0,
      object.heightMm / 2,
      0,
      "model-placeholder",
    );
    generated.add(group);

    const loader =
      options.loadModelPrototype ?? loadGlbPrototype;
    const promise = loader(runtimeAsset.contentUrl)
      .then((prototype) => {
        if (disposed || group.parent !== generated) return;

        for (const child of [...group.children]) {
          child.traverse((descendant) => {
            if (
              descendant instanceof Mesh &&
              descendant.userData
                .roomcraftExternalAsset !== true
            ) {
              descendant.geometry.dispose();
            }
          });
          group.remove(child);
        }

        group.add(
          createNormalizedModelInstance(
            prototype,
            {
              widthMm: object.widthMm,
              depthMm: object.depthMm,
              heightMm: object.heightMm,
            },
            object.id,
          ),
        );
        delete group.userData.roomcraftModelLoadError;
      })
      .catch((error: unknown) => {
        if (options.externalModelFailure === "reject") {
          throw error;
        }
        group.userData.roomcraftModelLoadError =
          error instanceof Error
            ? error.message
            : "Model could not be loaded.";
      });

    pending.push(promise);
  }

  function addPrimitiveParts(
    group: Group,
    object: ObjectInstance,
    primitive: BuiltinPrimitiveKind,
  ): void {
    const width = object.widthMm;
    const depth = object.depthMm;
    const height = object.heightMm;

    switch (primitive) {
      case "table": {
        const topThickness = Math.min(
          80,
          Math.max(30, Math.round(height * 0.1)),
        );
        const legSize = Math.min(
          80,
          Math.max(
            35,
            Math.round(Math.min(width, depth) * 0.08),
          ),
        );
        const legHeight = Math.max(
          1,
          height - topThickness,
        );
        addObjectPart(
          group,
          object,
          width,
          topThickness,
          depth,
          0,
          height - topThickness / 2,
          0,
          "top",
        );
        const x = Math.max(
          0,
          width / 2 - legSize / 2 - 40,
        );
        const z = Math.max(
          0,
          depth / 2 - legSize / 2 - 40,
        );
        for (const [px, pz] of [
          [-x, -z],
          [x, -z],
          [-x, z],
          [x, z],
        ] as const) {
          addObjectPart(
            group,
            object,
            legSize,
            legHeight,
            legSize,
            px,
            legHeight / 2,
            pz,
            "leg",
          );
        }
        break;
      }
      case "sofa": {
        const baseHeight = Math.max(
          160,
          Math.round(height * 0.45),
        );
        const backDepth = Math.max(
          120,
          Math.round(depth * 0.16),
        );
        const armWidth = Math.max(
          100,
          Math.round(width * 0.08),
        );
        addObjectPart(
          group,
          object,
          width,
          baseHeight,
          depth,
          0,
          baseHeight / 2,
          0,
          "base",
        );
        addObjectPart(
          group,
          object,
          width,
          Math.max(1, height - baseHeight),
          backDepth,
          0,
          baseHeight +
            (height - baseHeight) / 2,
          depth / 2 - backDepth / 2,
          "back",
        );
        const armHeight = Math.min(
          height,
          Math.max(baseHeight, Math.round(height * 0.7)),
        );
        addObjectPart(
          group,
          object,
          armWidth,
          armHeight,
          depth,
          -width / 2 + armWidth / 2,
          armHeight / 2,
          0,
          "arm",
        );
        addObjectPart(
          group,
          object,
          armWidth,
          armHeight,
          depth,
          width / 2 - armWidth / 2,
          armHeight / 2,
          0,
          "arm",
        );
        break;
      }
      case "bed": {
        const baseHeight = Math.max(
          120,
          Math.round(height * 0.45),
        );
        const mattressHeight = Math.max(
          80,
          Math.round(height * 0.35),
        );
        const headDepth = Math.max(
          50,
          Math.round(depth * 0.05),
        );
        addObjectPart(
          group,
          object,
          width,
          baseHeight,
          depth,
          0,
          baseHeight / 2,
          0,
          "base",
        );
        addObjectPart(
          group,
          object,
          width * 0.96,
          mattressHeight,
          depth * 0.92,
          0,
          baseHeight + mattressHeight / 2,
          0,
          "mattress",
        );
        addObjectPart(
          group,
          object,
          width,
          height,
          headDepth,
          0,
          height / 2,
          depth / 2 - headDepth / 2,
          "headboard",
        );
        break;
      }
      case "cabinet":
      case "box":
        addObjectPart(
          group,
          object,
          width,
          height,
          depth,
          0,
          height / 2,
          0,
          primitive,
        );
        break;
    }
  }

  function addObjectPart(
    group: Group,
    object: ObjectInstance,
    widthMm: number,
    heightMm: number,
    depthMm: number,
    xMm: number,
    yMm: number,
    zMm: number,
    part: string,
    materialId: string | null = null,
  ): void {
    const mesh = new Mesh(
      new BoxGeometry(
        mmToMetres(Math.max(1, widthMm)),
        mmToMetres(Math.max(1, heightMm)),
        mmToMetres(Math.max(1, depthMm)),
      ),
      projectMaterial(materialId, objectMaterial),
    );
    mesh.position.set(
      mmToMetres(xMm),
      mmToMetres(yMm),
      mmToMetres(zMm),
    );
    mesh.userData.roomcraftId = object.id;
    mesh.userData.roomcraftKind = "object";
    mesh.userData.roomcraftPart = part;
    mesh.userData.roomcraftParametricMaterialId =
      materialId;
    group.add(mesh);
  }

  function wallMaterialsFor(wall: Wall): Material[] {
    return [
      wallMaterial,
      wallMaterial,
      wallMaterial,
      wallMaterial,
      projectMaterial(
        wall.leftMaterialId ?? null,
        wallMaterial,
      ),
      projectMaterial(
        wall.rightMaterialId ?? null,
        wallMaterial,
      ),
    ];
  }
}

function materialFromDefinition(
  definition: MaterialDefinition,
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(definition.baseColorHex),
    roughness: definition.roughness,
    metalness: definition.metalness,
    side: DoubleSide,
  });
}
