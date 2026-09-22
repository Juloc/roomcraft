import { getBuiltinAssetDefinition, type BuiltinPrimitiveKind } from "@roomcraft/catalog";
import type {
  Level,
  MaterialDefinition,
  ObjectInstance,
  ParametricCabinetDefinition,
  Opening,
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
  AmbientLight,
  BoxGeometry,
  BoxHelper,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createNormalizedModelInstance,
  disposeModelResources,
  loadGlbPrototype,
  type RuntimeModelAsset,
} from "./models";

export * from "./models";

export type RoomSceneLevelScope = "active" | "all";

export interface RoomSceneOptions {
  levelScope?: RoomSceneLevelScope;
  modelAssets?: readonly RuntimeModelAsset[];
  showCeilings?: boolean;
}

export class RoomSceneRenderer {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.05, 250);
  private readonly renderer: WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly generated = new Group();
  private readonly wallMaterial = new MeshStandardMaterial({
    color: new Color(0xc9c7c2),
    roughness: 0.82,
    metalness: 0,
  });
  private readonly selectedWallMaterial = new MeshStandardMaterial({
    color: new Color(0x5f86f2),
    roughness: 0.72,
    metalness: 0,
  });
  private readonly defaultSurfaceMaterial = new MeshStandardMaterial({
    color: new Color(0xe4e0d8),
    roughness: 0.92,
    metalness: 0,
    side: DoubleSide,
  });
  private readonly objectMaterial = new MeshStandardMaterial({
    color: new Color(0xa89f91),
    roughness: 0.78,
    metalness: 0,
  });
  private readonly selectedObjectMaterial = new MeshStandardMaterial({
    color: new Color(0x5f86f2),
    roughness: 0.68,
    metalness: 0,
  });
  private readonly resizeObserver: ResizeObserver;
  private readonly grid: GridHelper;
  private readonly modelAssetsByObjectAssetId = new Map<string, RuntimeModelAsset>();
  private readonly modelPrototypePromises = new Map<string, Promise<Group>>();
  private readonly modelPrototypes = new Map<string, Group>();
  private readonly materialDefinitionById = new Map<string, MaterialDefinition>();
  private readonly parametricAssetById = new Map<string, ParametricCabinetDefinition>();
  private readonly projectMaterialCache = new Map<string, MeshStandardMaterial>();
  private selectionHelper: BoxHelper | null = null;
  private showCeilings = false;
  private renderGeneration = 0;
  private selectedId: string | null = null;
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.className = "roomcraft-three-canvas";
    this.container.replaceChildren(this.renderer.domElement);

    this.scene.background = new Color(0xf1f1ef);
    this.scene.add(this.generated);

    this.grid = new GridHelper(20, 40, 0x92928d, 0xd7d7d2);
    this.scene.add(this.grid);

    const ambient = new AmbientLight(0xffffff, 1.6);
    this.scene.add(ambient);

    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(5, 9, 4);
    this.scene.add(sun);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.addEventListener("change", this.render);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  setDocument(
    document: ProjectDocument,
    levelId: string,
    options: RoomSceneOptions = {},
  ): void {
    this.assertActive();
    const activeLevel = document.levels.find((candidate) => candidate.id === levelId);
    if (!activeLevel) throw new Error(`Level ${levelId} does not exist.`);

    const levels =
      options.levelScope === "all" ? document.levels : [activeLevel];

    this.renderGeneration += 1;
    this.showCeilings = options.showCeilings ?? false;
    this.setMaterialDefinitions(document.materials);
    this.parametricAssetById.clear();
    for (const definition of document.parametricAssets) {
      this.parametricAssetById.set(definition.id, definition);
    }
    this.modelAssetsByObjectAssetId.clear();
    for (const asset of options.modelAssets ?? []) {
      this.modelAssetsByObjectAssetId.set(asset.objectAssetId, asset);
    }

    this.clearGenerated();
    for (const level of levels) this.buildLevel(level);
    this.frameLevels(levels);
    this.updateSelectionHelper();
    this.render();
  }

  setSelection(id: string | null): void {
    this.assertActive();
    this.selectedId = id;

    this.generated.traverse((child) => {
      if (!(child instanceof Mesh) || child.userData.roomcraftExternalAsset) return;
      child.material = this.materialForMesh(child);
    });

    this.updateSelectionHelper();
    this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.resizeObserver.disconnect();
    this.controls.removeEventListener("change", this.render);
    this.controls.dispose();
    this.clearGenerated();
    for (const prototype of this.modelPrototypes.values()) {
      disposeModelResources(prototype);
    }
    this.modelPrototypePromises.clear();
    this.modelPrototypes.clear();
    for (const material of this.projectMaterialCache.values()) material.dispose();
    this.projectMaterialCache.clear();
    this.materialDefinitionById.clear();
    this.parametricAssetById.clear();
    this.wallMaterial.dispose();
    this.selectedWallMaterial.dispose();
    this.defaultSurfaceMaterial.dispose();
    this.objectMaterial.dispose();
    this.selectedObjectMaterial.dispose();
    this.grid.geometry.dispose();
    disposeMaterials(this.grid.material);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly render = (): void => {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private buildLevel(level: Level): void {
    const vertices = new Map(level.vertices.map((vertex) => [vertex.id, vertex]));

    this.buildRoomSurfaces(level);

    for (const wall of level.walls) {
      const start = vertices.get(wall.startVertexId);
      const end = vertices.get(wall.endVertexId);
      if (!start || !end) continue;

      const openings = level.openings
        .filter((opening) => opening.wallId === wall.id)
        .sort((a, b) => a.offsetMm - b.offsetMm);
      this.buildWall(level, wall, start, end, openings);
    }

    for (const object of level.objects) {
      this.buildObject(level, object);
    }
  }

  private buildWall(
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

    const wallHeightMm = wall.heightMm ?? level.defaultWallHeightMm;
    const ux = dxMm / lengthMm;
    const uz = dzMm / lengthMm;
    const rotationY = -Math.atan2(dzMm, dxMm);
    let cursorMm = 0;

    for (const opening of openings) {
      const openingStartMm = opening.offsetMm - opening.widthMm / 2;
      const openingEndMm = opening.offsetMm + opening.widthMm / 2;
      if (openingStartMm < cursorMm || openingEndMm > lengthMm) {
        throw new Error(`Opening ${opening.id} is invalid for wall ${wall.id}.`);
      }

      this.addWallBlock(
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
        this.addWallBlock(
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

      const openingTopMm = opening.sillHeightMm + opening.heightMm;
      if (openingTopMm < wallHeightMm) {
        this.addWallBlock(
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

    this.addWallBlock(
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

  private addWallBlock(
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
    const blockLengthMm = endDistanceMm - startDistanceMm;
    const blockHeightMm = topMm - bottomMm;
    if (blockLengthMm <= 0 || blockHeightMm <= 0) return;

    const centerDistanceMm = (startDistanceMm + endDistanceMm) / 2;
    const geometry = new BoxGeometry(
      mmToMetres(blockLengthMm),
      mmToMetres(blockHeightMm),
      mmToMetres(wall.thicknessMm),
    );
    const mesh = new Mesh(
      geometry,
      this.selectedId === wall.id
        ? this.selectedWallMaterial
        : this.wallMaterialsFor(wall),
    );
    mesh.name = `${wall.id}:${part}`;
    mesh.userData.roomcraftId = wall.id;
    mesh.userData.roomcraftKind = "wall";
    mesh.userData.roomcraftPart = part;
    mesh.userData.roomcraftLeftMaterialId = wall.leftMaterialId ?? null;
    mesh.userData.roomcraftRightMaterialId = wall.rightMaterialId ?? null;
    mesh.position.set(
      mmToMetres(start.xMm + ux * centerDistanceMm),
      mmToMetres(level.elevationMm + bottomMm + blockHeightMm / 2),
      mmToMetres(start.yMm + uz * centerDistanceMm),
    );
    mesh.rotation.y = rotationY;
    this.generated.add(mesh);
  }

  private buildRoomSurfaces(level: Level): void {
    const analysis = analyzePlanarFaces(level.vertices, level.walls);
    if (analysis.issues.length > 0) return;

    const finishByKey = new Map(
      level.roomFinishes.map((finish) => [finish.roomKey, finish]),
    );

    for (const face of analysis.faces) {
      const finish = finishByKey.get(face.key);
      this.addRoomSurface(
        level,
        face.key,
        face.points,
        level.elevationMm + 1,
        finish?.floorMaterialId ?? null,
        "floor",
      );

      if (this.showCeilings) {
        this.addRoomSurface(
          level,
          face.key,
          face.points,
          level.elevationMm + level.defaultWallHeightMm - 1,
          finish?.ceilingMaterialId ?? null,
          "ceiling",
        );
      }
    }
  }

  private addRoomSurface(
    level: Level,
    roomKey: string,
    points: readonly { xMm: number; yMm: number }[],
    elevationMm: number,
    materialId: string | null,
    part: "floor" | "ceiling",
  ): void {
    if (points.length < 3) return;

    const shape = new Shape();
    const first = points[0];
    if (!first) return;
    shape.moveTo(mmToMetres(first.xMm), mmToMetres(first.yMm));
    for (const point of points.slice(1)) {
      shape.lineTo(mmToMetres(point.xMm), mmToMetres(point.yMm));
    }
    shape.closePath();

    const geometry = new ShapeGeometry(shape);
    const baseMaterial = this.materialForId(
      materialId,
      this.defaultSurfaceMaterial,
    );
    const mesh = new Mesh(
      geometry,
      this.selectedId === roomKey ? this.selectedWallMaterial : baseMaterial,
    );
    mesh.name = `${level.id}:${roomKey}:${part}`;
    mesh.userData.roomcraftId = roomKey;
    mesh.userData.roomcraftKind = "room-surface";
    mesh.userData.roomcraftPart = part;
    mesh.userData.roomcraftMaterialId = materialId;
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = mmToMetres(elevationMm);
    this.generated.add(mesh);
  }

  private buildObject(level: Level, object: ObjectInstance): void {
    const parametricDefinitionId = parseParametricAssetId(object.assetId);
    if (parametricDefinitionId) {
      const definition = this.parametricAssetById.get(parametricDefinitionId);
      if (!definition) {
        throw new Error(
          `Object ${object.id} references missing parametric asset ${parametricDefinitionId}.`,
        );
      }
      this.buildParametricCabinet(level, object, definition);
      return;
    }

    const runtimeAsset = this.modelAssetsByObjectAssetId.get(object.assetId);
    if (runtimeAsset) {
      this.buildExternalObject(level, object, runtimeAsset);
      return;
    }

    const definition = getBuiltinAssetDefinition(object.assetId);
    const primitive: BuiltinPrimitiveKind = definition?.primitive ?? "box";

    const group = this.createObjectGroup(level, object);
    this.addPrimitiveParts(group, object, primitive);
    this.generated.add(group);
  }

  private buildParametricCabinet(
    level: Level,
    object: ObjectInstance,
    definition: ParametricCabinetDefinition,
  ): void {
    const group = this.createObjectGroup(level, object);
    group.userData.roomcraftParametricAssetId = definition.id;

    const parts = deriveCabinetParts(definition, {
      widthMm: object.widthMm,
      depthMm: object.depthMm,
      heightMm: object.heightMm,
    });

    for (const part of parts) {
      this.addObjectPart(
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

    this.generated.add(group);
  }

  private createObjectGroup(level: Level, object: ObjectInstance): Group {
    const group = new Group();
    group.name = object.id;
    group.userData.roomcraftId = object.id;
    group.userData.roomcraftKind = "object";
    group.position.set(
      mmToMetres(object.xMm),
      mmToMetres(level.elevationMm + object.zMm),
      mmToMetres(object.yMm),
    );
    group.rotation.y = -(object.rotationDeg * Math.PI) / 180;
    return group;
  }

  private buildExternalObject(
    level: Level,
    object: ObjectInstance,
    runtimeAsset: RuntimeModelAsset,
  ): void {
    const group = this.createObjectGroup(level, object);
    group.userData.roomcraftUsesExternalModel = true;

    // Keep a correctly sized semantic placeholder while the immutable GLB loads.
    this.addObjectPart(
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
    this.generated.add(group);

    const generation = this.renderGeneration;
    void this.getModelPrototype(runtimeAsset.contentUrl)
      .then((prototype) => {
        if (
          this.disposed ||
          generation !== this.renderGeneration ||
          group.parent !== this.generated
        ) {
          return;
        }

        for (const child of [...group.children]) {
          child.traverse((descendant) => {
            if (descendant instanceof Mesh && !descendant.userData.roomcraftExternalAsset) {
              descendant.geometry.dispose();
            }
          });
          group.remove(child);
        }

        const instance = createNormalizedModelInstance(
          prototype,
          {
            widthMm: object.widthMm,
            depthMm: object.depthMm,
            heightMm: object.heightMm,
          },
          object.id,
        );
        group.add(instance);
        delete group.userData.roomcraftModelLoadError;
        this.updateSelectionHelper();
        this.render();
      })
      .catch((error: unknown) => {
        if (
          this.disposed ||
          generation !== this.renderGeneration ||
          group.parent !== this.generated
        ) {
          return;
        }

        group.userData.roomcraftModelLoadError =
          error instanceof Error ? error.message : "Model could not be loaded.";
        this.render();
      });
  }

  private getModelPrototype(contentUrl: string): Promise<Group> {
    const cached = this.modelPrototypes.get(contentUrl);
    if (cached) return Promise.resolve(cached);

    const pending = this.modelPrototypePromises.get(contentUrl);
    if (pending) return pending;

    const promise = loadGlbPrototype(contentUrl)
      .then((prototype) => {
        this.modelPrototypePromises.delete(contentUrl);
        if (this.disposed) {
          disposeModelResources(prototype);
          throw new Error("RoomSceneRenderer has been disposed.");
        }

        this.modelPrototypes.set(contentUrl, prototype);
        return prototype;
      })
      .catch((error) => {
        this.modelPrototypePromises.delete(contentUrl);
        throw error;
      });

    this.modelPrototypePromises.set(contentUrl, promise);
    return promise;
  }

  private addPrimitiveParts(
    group: Group,
    object: ObjectInstance,
    primitive: BuiltinPrimitiveKind,
  ): void {
    const width = object.widthMm;
    const depth = object.depthMm;
    const height = object.heightMm;

    switch (primitive) {
      case "table": {
        const topThickness = Math.min(80, Math.max(30, Math.round(height * 0.1)));
        const legSize = Math.min(80, Math.max(35, Math.round(Math.min(width, depth) * 0.08)));
        const legHeight = Math.max(1, height - topThickness);
        this.addObjectPart(group, object, width, topThickness, depth, 0, height - topThickness / 2, 0, "top");
        const x = Math.max(0, width / 2 - legSize / 2 - 40);
        const z = Math.max(0, depth / 2 - legSize / 2 - 40);
        for (const [px, pz] of [[-x, -z], [x, -z], [-x, z], [x, z]] as const) {
          this.addObjectPart(group, object, legSize, legHeight, legSize, px, legHeight / 2, pz, "leg");
        }
        break;
      }
      case "sofa": {
        const baseHeight = Math.max(160, Math.round(height * 0.45));
        const backDepth = Math.max(120, Math.round(depth * 0.16));
        const armWidth = Math.max(100, Math.round(width * 0.08));
        this.addObjectPart(group, object, width, baseHeight, depth, 0, baseHeight / 2, 0, "base");
        this.addObjectPart(
          group,
          object,
          width,
          Math.max(1, height - baseHeight),
          backDepth,
          0,
          baseHeight + (height - baseHeight) / 2,
          depth / 2 - backDepth / 2,
          "back",
        );
        const armHeight = Math.min(height, Math.max(baseHeight, Math.round(height * 0.7)));
        this.addObjectPart(group, object, armWidth, armHeight, depth, -width / 2 + armWidth / 2, armHeight / 2, 0, "arm");
        this.addObjectPart(group, object, armWidth, armHeight, depth, width / 2 - armWidth / 2, armHeight / 2, 0, "arm");
        break;
      }
      case "bed": {
        const baseHeight = Math.max(120, Math.round(height * 0.45));
        const mattressHeight = Math.max(80, Math.round(height * 0.35));
        const headDepth = Math.max(50, Math.round(depth * 0.05));
        this.addObjectPart(group, object, width, baseHeight, depth, 0, baseHeight / 2, 0, "base");
        this.addObjectPart(
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
        this.addObjectPart(group, object, width, height, headDepth, 0, height / 2, depth / 2 - headDepth / 2, "headboard");
        break;
      }
      case "cabinet":
      case "box":
        this.addObjectPart(group, object, width, height, depth, 0, height / 2, 0, primitive);
        break;
    }
  }

  private addObjectPart(
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
    const geometry = new BoxGeometry(
      mmToMetres(Math.max(1, widthMm)),
      mmToMetres(Math.max(1, heightMm)),
      mmToMetres(Math.max(1, depthMm)),
    );
    const mesh = new Mesh(
      geometry,
      this.selectedId === object.id
        ? this.selectedObjectMaterial
        : this.materialForId(materialId, this.objectMaterial),
    );
    mesh.position.set(mmToMetres(xMm), mmToMetres(yMm), mmToMetres(zMm));
    mesh.userData.roomcraftId = object.id;
    mesh.userData.roomcraftKind = "object";
    mesh.userData.roomcraftPart = part;
    mesh.userData.roomcraftParametricMaterialId = materialId;
    group.add(mesh);
  }

  private materialForMesh(mesh: Mesh): Material | Material[] {
    const selected = mesh.userData.roomcraftId === this.selectedId;
    if (mesh.userData.roomcraftKind === "object") {
      return selected
        ? this.selectedObjectMaterial
        : this.materialForId(
            (mesh.userData.roomcraftParametricMaterialId as
              | string
              | null
              | undefined) ?? null,
            this.objectMaterial,
          );
    }
    if (mesh.userData.roomcraftKind === "room-surface") {
      return selected
        ? this.selectedWallMaterial
        : this.materialForId(
            (mesh.userData.roomcraftMaterialId as string | null | undefined) ?? null,
            this.defaultSurfaceMaterial,
          );
    }

    if (selected) return this.selectedWallMaterial;
    return [
      this.wallMaterial,
      this.wallMaterial,
      this.wallMaterial,
      this.wallMaterial,
      this.materialForId(
        (mesh.userData.roomcraftLeftMaterialId as string | null | undefined) ?? null,
        this.wallMaterial,
      ),
      this.materialForId(
        (mesh.userData.roomcraftRightMaterialId as string | null | undefined) ?? null,
        this.wallMaterial,
      ),
    ];
  }

  private wallMaterialsFor(wall: Wall): Material[] {
    return [
      this.wallMaterial,
      this.wallMaterial,
      this.wallMaterial,
      this.wallMaterial,
      this.materialForId(wall.leftMaterialId ?? null, this.wallMaterial),
      this.materialForId(wall.rightMaterialId ?? null, this.wallMaterial),
    ];
  }

  private materialForId(
    materialId: string | null,
    fallback: MeshStandardMaterial,
  ): MeshStandardMaterial {
    if (!materialId) return fallback;

    const cached = this.projectMaterialCache.get(materialId);
    if (cached) return cached;

    const definition = this.materialDefinitionById.get(materialId);
    if (!definition) return fallback;

    const material = new MeshStandardMaterial({
      color: new Color(definition.baseColorHex),
      roughness: definition.roughness,
      metalness: definition.metalness,
      side: DoubleSide,
    });
    this.projectMaterialCache.set(materialId, material);
    return material;
  }

  private setMaterialDefinitions(
    definitions: readonly MaterialDefinition[],
  ): void {
    for (const material of this.projectMaterialCache.values()) material.dispose();
    this.projectMaterialCache.clear();
    this.materialDefinitionById.clear();
    for (const definition of definitions) {
      this.materialDefinitionById.set(definition.id, definition);
    }
  }

  private updateSelectionHelper(): void {
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry.dispose();
      disposeMaterials(this.selectionHelper.material);
      this.selectionHelper = null;
    }

    if (!this.selectedId) return;

    const selected = this.generated.children.find(
      (child) =>
        child.userData.roomcraftId === this.selectedId &&
        child.userData.roomcraftUsesExternalModel === true,
    );
    if (!selected) return;

    const helper = new BoxHelper(selected, 0x5f86f2);
    helper.userData.roomcraftSelectionHelper = true;
    this.selectionHelper = helper;
    this.scene.add(helper);
  }

  private frameLevels(levels: readonly Level[]): void {
    const levelsWithContent = levels.filter(
      (level) => level.vertices.length > 0 || level.objects.length > 0,
    );
    if (levelsWithContent.length === 0) {
      this.controls.target.set(0, 0.8, 0);
      this.camera.position.set(5, 5, 5);
      this.controls.update();
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (const level of levelsWithContent) {
      minY = Math.min(minY, mmToMetres(level.elevationMm));
      const maxWallHeightMm =
        level.walls.length > 0
          ? Math.max(
              level.defaultWallHeightMm,
              ...level.walls.map((wall) => wall.heightMm ?? level.defaultWallHeightMm),
            )
          : 0;
      maxY = Math.max(
        maxY,
        mmToMetres(level.elevationMm + maxWallHeightMm),
      );

      for (const vertex of level.vertices) {
        minX = Math.min(minX, mmToMetres(vertex.xMm));
        maxX = Math.max(maxX, mmToMetres(vertex.xMm));
        minZ = Math.min(minZ, mmToMetres(vertex.yMm));
        maxZ = Math.max(maxZ, mmToMetres(vertex.yMm));
      }

      for (const object of level.objects) {
        const radiusMm = Math.hypot(object.widthMm, object.depthMm) / 2;
        minX = Math.min(minX, mmToMetres(object.xMm - radiusMm));
        maxX = Math.max(maxX, mmToMetres(object.xMm + radiusMm));
        minZ = Math.min(minZ, mmToMetres(object.yMm - radiusMm));
        maxZ = Math.max(maxZ, mmToMetres(object.yMm + radiusMm));
        minY = Math.min(minY, mmToMetres(level.elevationMm + object.zMm));
        maxY = Math.max(
          maxY,
          mmToMetres(level.elevationMm + object.zMm + object.heightMm),
        );
      }
    }

    const center = new Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    );
    const span = Math.max(
      maxX - minX,
      maxY - minY,
      maxZ - minZ,
      2,
    );
    const distance = Math.max(4.5, span * 1.55);

    this.controls.target.copy(center);
    this.camera.position.set(
      center.x + distance,
      center.y + distance * 0.8,
      center.z + distance,
    );
    this.camera.lookAt(center);
    this.controls.update();
  }

  private clearGenerated(): void {
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry.dispose();
      disposeMaterials(this.selectionHelper.material);
      this.selectionHelper = null;
    }

    this.generated.traverse((child) => {
      if (child instanceof Mesh && !child.userData.roomcraftExternalAsset) {
        child.geometry.dispose();
      }
    });
    this.generated.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("RoomSceneRenderer has been disposed.");
  }
}

function disposeMaterials(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}
