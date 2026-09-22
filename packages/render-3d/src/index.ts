import { getBuiltinAssetDefinition, type BuiltinPrimitiveKind } from "@roomcraft/catalog";
import type {
  Level,
  ObjectInstance,
  Opening,
  ProjectDocument,
  Vertex,
  Wall,
} from "@roomcraft/document";
import { mmToMetres } from "@roomcraft/geometry";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type RoomSceneLevelScope = "active" | "all";

export interface RoomSceneOptions {
  levelScope?: RoomSceneLevelScope;
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

    this.clearGenerated();
    for (const level of levels) this.buildLevel(level);
    this.frameLevels(levels);
    this.render();
  }

  setSelection(id: string | null): void {
    this.assertActive();
    this.selectedId = id;

    this.generated.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.material = this.materialForMesh(child);
    });

    this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.resizeObserver.disconnect();
    this.controls.removeEventListener("change", this.render);
    this.controls.dispose();
    this.clearGenerated();
    this.wallMaterial.dispose();
    this.selectedWallMaterial.dispose();
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
      this.selectedId === wall.id ? this.selectedWallMaterial : this.wallMaterial,
    );
    mesh.name = `${wall.id}:${part}`;
    mesh.userData.roomcraftId = wall.id;
    mesh.userData.roomcraftKind = "wall";
    mesh.userData.roomcraftPart = part;
    mesh.position.set(
      mmToMetres(start.xMm + ux * centerDistanceMm),
      mmToMetres(level.elevationMm + bottomMm + blockHeightMm / 2),
      mmToMetres(start.yMm + uz * centerDistanceMm),
    );
    mesh.rotation.y = rotationY;
    this.generated.add(mesh);
  }

  private buildObject(level: Level, object: ObjectInstance): void {
    const definition = getBuiltinAssetDefinition(object.assetId);
    if (!definition) return;

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

    this.addPrimitiveParts(group, object, definition.primitive);
    this.generated.add(group);
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
  ): void {
    const geometry = new BoxGeometry(
      mmToMetres(Math.max(1, widthMm)),
      mmToMetres(Math.max(1, heightMm)),
      mmToMetres(Math.max(1, depthMm)),
    );
    const mesh = new Mesh(geometry, this.selectedId === object.id ? this.selectedObjectMaterial : this.objectMaterial);
    mesh.position.set(mmToMetres(xMm), mmToMetres(yMm), mmToMetres(zMm));
    mesh.userData.roomcraftId = object.id;
    mesh.userData.roomcraftKind = "object";
    mesh.userData.roomcraftPart = part;
    group.add(mesh);
  }

  private materialForMesh(mesh: Mesh): MeshStandardMaterial {
    const selected = mesh.userData.roomcraftId === this.selectedId;
    return mesh.userData.roomcraftKind === "object"
      ? selected
        ? this.selectedObjectMaterial
        : this.objectMaterial
      : selected
        ? this.selectedWallMaterial
        : this.wallMaterial;
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
    this.generated.traverse((child) => {
      if (child instanceof Mesh) child.geometry.dispose();
    });
    this.generated.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("RoomSceneRenderer has been disposed.");
  }
}

function disposeMaterials(material: GridHelper["material"]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}
