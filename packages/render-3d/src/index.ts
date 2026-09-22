import type { Level, ProjectDocument } from "@roomcraft/document";
import { mmToMetres } from "@roomcraft/geometry";
import {
  AmbientLight,
  Box3,
  Box3Helper,
  Color,
  DirectionalLight,
  GridHelper,
  Material,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  disposeModelResources,
  loadGlbPrototype,
} from "./models";
import {
  buildRoomSceneGraph,
  type RoomSceneGraphBuild,
  type RoomSceneGraphOptions,
} from "./scene-builder";

export * from "./models";
export * from "./scene-builder";

export interface RoomSceneOptions
  extends Pick<
    RoomSceneGraphOptions,
    "levelScope" | "modelAssets" | "showCeilings"
  > {}

export class RoomSceneRenderer {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.05, 250);
  private readonly renderer: WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly grid: GridHelper;
  private readonly modelPrototypePromises = new Map<
    string,
    Promise<import("three").Group>
  >();
  private readonly modelPrototypes = new Map<
    string,
    import("three").Group
  >();
  private currentBuild: RoomSceneGraphBuild | null = null;
  private selectionHelper: Box3Helper | null = null;
  private renderGeneration = 0;
  private selectedId: string | null = null;
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.domElement.className =
      "roomcraft-three-canvas";
    this.container.replaceChildren(
      this.renderer.domElement,
    );

    this.scene.background = new Color(0xf1f1ef);

    this.grid = new GridHelper(
      20,
      40,
      0x92928d,
      0xd7d7d2,
    );
    this.scene.add(this.grid);

    const ambient = new AmbientLight(0xffffff, 1.6);
    this.scene.add(ambient);

    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(5, 9, 4);
    this.scene.add(sun);

    this.controls = new OrbitControls(
      this.camera,
      this.renderer.domElement,
    );
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle =
      Math.PI / 2 - 0.02;
    this.controls.addEventListener(
      "change",
      this.render,
    );

    this.resizeObserver = new ResizeObserver(() =>
      this.resize(),
    );
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  setDocument(
    document: ProjectDocument,
    levelId: string,
    options: RoomSceneOptions = {},
  ): void {
    this.assertActive();
    const generation = ++this.renderGeneration;

    const build = buildRoomSceneGraph(
      document,
      levelId,
      {
        ...options,
        externalModelFailure: "record",
        loadModelPrototype: (contentUrl) =>
          this.getModelPrototype(contentUrl),
      },
    );

    this.clearGenerated();
    this.currentBuild = build;
    this.scene.add(build.group);
    this.frameLevels(build.levels);
    this.updateSelectionHelper();
    this.render();

    for (const pending of build.pending) {
      void pending
        .catch(() => {
          // Scene builder records model load errors on the
          // relevant object in viewer mode.
        })
        .finally(() => {
          if (
            this.disposed ||
            generation !== this.renderGeneration ||
            this.currentBuild !== build
          ) {
            return;
          }

          this.updateSelectionHelper();
          this.render();
        });
    }
  }

  setSelection(id: string | null): void {
    this.assertActive();
    this.selectedId = id;
    this.updateSelectionHelper();
    this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderGeneration += 1;

    this.resizeObserver.disconnect();
    this.controls.removeEventListener(
      "change",
      this.render,
    );
    this.controls.dispose();
    this.clearGenerated();

    for (const prototype of this.modelPrototypes.values()) {
      disposeModelResources(prototype);
    }
    this.modelPrototypePromises.clear();
    this.modelPrototypes.clear();

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
    const width = Math.max(
      1,
      this.container.clientWidth,
    );
    const height = Math.max(
      1,
      this.container.clientHeight,
    );
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private getModelPrototype(
    contentUrl: string,
  ): Promise<import("three").Group> {
    const cached =
      this.modelPrototypes.get(contentUrl);
    if (cached) return Promise.resolve(cached);

    const pending =
      this.modelPrototypePromises.get(contentUrl);
    if (pending) return pending;

    const promise = loadGlbPrototype(contentUrl)
      .then((prototype) => {
        this.modelPrototypePromises.delete(contentUrl);
        if (this.disposed) {
          disposeModelResources(prototype);
          throw new Error(
            "RoomSceneRenderer has been disposed.",
          );
        }

        this.modelPrototypes.set(
          contentUrl,
          prototype,
        );
        return prototype;
      })
      .catch((error) => {
        this.modelPrototypePromises.delete(contentUrl);
        throw error;
      });

    this.modelPrototypePromises.set(
      contentUrl,
      promise,
    );
    return promise;
  }

  private updateSelectionHelper(): void {
    this.removeSelectionHelper();

    const build = this.currentBuild;
    if (!build || !this.selectedId) return;

    const bounds = new Box3();
    let found = false;

    for (const child of build.group.children) {
      if (
        child.userData.roomcraftId !==
        this.selectedId
      ) {
        continue;
      }
      bounds.expandByObject(child);
      found = true;
    }

    if (!found || bounds.isEmpty()) return;

    const helper = new Box3Helper(
      bounds,
      new Color(0x5f86f2),
    );
    helper.userData.roomcraftSelectionHelper = true;
    this.selectionHelper = helper;
    this.scene.add(helper);
  }

  private removeSelectionHelper(): void {
    const helper = this.selectionHelper;
    if (!helper) return;

    this.scene.remove(helper);
    helper.geometry.dispose();
    disposeMaterials(helper.material);
    this.selectionHelper = null;
  }

  private frameLevels(
    levels: readonly Level[],
  ): void {
    const levelsWithContent = levels.filter(
      (level) =>
        level.vertices.length > 0 ||
        level.objects.length > 0,
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
      minY = Math.min(
        minY,
        mmToMetres(level.elevationMm),
      );
      const maxWallHeightMm =
        level.walls.length > 0
          ? Math.max(
              level.defaultWallHeightMm,
              ...level.walls.map(
                (wall) =>
                  wall.heightMm ??
                  level.defaultWallHeightMm,
              ),
            )
          : 0;
      maxY = Math.max(
        maxY,
        mmToMetres(
          level.elevationMm + maxWallHeightMm,
        ),
      );

      for (const vertex of level.vertices) {
        minX = Math.min(
          minX,
          mmToMetres(vertex.xMm),
        );
        maxX = Math.max(
          maxX,
          mmToMetres(vertex.xMm),
        );
        minZ = Math.min(
          minZ,
          mmToMetres(vertex.yMm),
        );
        maxZ = Math.max(
          maxZ,
          mmToMetres(vertex.yMm),
        );
      }

      for (const object of level.objects) {
        const radiusMm =
          Math.hypot(
            object.widthMm,
            object.depthMm,
          ) / 2;
        minX = Math.min(
          minX,
          mmToMetres(object.xMm - radiusMm),
        );
        maxX = Math.max(
          maxX,
          mmToMetres(object.xMm + radiusMm),
        );
        minZ = Math.min(
          minZ,
          mmToMetres(object.yMm - radiusMm),
        );
        maxZ = Math.max(
          maxZ,
          mmToMetres(object.yMm + radiusMm),
        );
        minY = Math.min(
          minY,
          mmToMetres(
            level.elevationMm + object.zMm,
          ),
        );
        maxY = Math.max(
          maxY,
          mmToMetres(
            level.elevationMm +
              object.zMm +
              object.heightMm,
          ),
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
    const distance = Math.max(
      4.5,
      span * 1.55,
    );

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
    this.removeSelectionHelper();

    const build = this.currentBuild;
    if (!build) return;

    this.scene.remove(build.group);
    build.dispose();
    this.currentBuild = null;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error(
        "RoomSceneRenderer has been disposed.",
      );
    }
  }
}

function disposeMaterials(
  material: Material | Material[],
): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}
