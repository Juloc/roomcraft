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
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Object3D,
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

export type RoomSceneHitKind = "wall" | "object" | "room";

export interface RoomSceneHit {
  id: string;
  kind: RoomSceneHitKind;
}

export interface RoomSceneInteractionHandlers {
  onSelect?(hit: RoomSceneHit | null, additive: boolean): void;
  onHover?(hit: RoomSceneHit | null): void;
}

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
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly selectionHelpers: Box3Helper[] = [];
  private hoverHelper: Box3Helper | null = null;
  private renderGeneration = 0;
  private selectedIds = new Set<string>();
  private primarySelectedId: string | null = null;
  private hoveredId: string | null = null;
  private interactionHandlers: RoomSceneInteractionHandlers = {};
  private pointerDown: { x: number; y: number; pointerId: number } | null = null;
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
    this.renderer.domElement.tabIndex = 0;
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
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.handlePointerCancel);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerleave", this.handlePointerLeave);

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
    this.updateSelectionHelpers();
    this.updateHoverHelper();
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

          this.updateSelectionHelpers();
          this.updateHoverHelper();
          this.render();
        });
    }
  }

  setSelection(ids: readonly string[], primaryId: string | null = null): void {
    this.assertActive();
    this.selectedIds = new Set(ids);
    this.primarySelectedId = primaryId;
    this.updateSelectionHelpers();
    this.render();
  }

  setHover(id: string | null): void {
    this.assertActive();
    this.hoveredId = id;
    this.updateHoverHelper();
    this.render();
  }

  setInteractionHandlers(handlers: RoomSceneInteractionHandlers): void {
    this.assertActive();
    this.interactionHandlers = handlers;
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
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.removeEventListener("pointercancel", this.handlePointerCancel);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("pointerleave", this.handlePointerLeave);
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

  private updateSelectionHelpers(): void {
    this.removeSelectionHelpers();

    for (const id of this.selectedIds) {
      const bounds = this.boundsForId(id);
      if (!bounds) continue;

      const helper = new Box3Helper(
        bounds,
        new Color(id === this.primarySelectedId ? 0x5f86f2 : 0x91a8eb),
      );
      helper.userData.roomcraftSelectionHelper = true;
      this.selectionHelpers.push(helper);
      this.scene.add(helper);
    }
  }

  private updateHoverHelper(): void {
    this.removeHoverHelper();
    if (!this.hoveredId || this.selectedIds.has(this.hoveredId)) return;

    const bounds = this.boundsForId(this.hoveredId);
    if (!bounds) return;

    const helper = new Box3Helper(bounds, new Color(0xe1a52b));
    helper.userData.roomcraftHoverHelper = true;
    this.hoverHelper = helper;
    this.scene.add(helper);
  }

  private boundsForId(id: string): Box3 | null {
    const build = this.currentBuild;
    if (!build) return null;

    const bounds = new Box3();
    let found = false;
    for (const child of build.group.children) {
      if (child.userData.roomcraftId !== id) continue;
      bounds.expandByObject(child);
      found = true;
    }
    return found && !bounds.isEmpty() ? bounds : null;
  }

  private removeSelectionHelpers(): void {
    for (const helper of this.selectionHelpers.splice(0)) {
      this.scene.remove(helper);
      helper.geometry.dispose();
      disposeMaterials(helper.material);
    }
  }

  private removeHoverHelper(): void {
    const helper = this.hoverHelper;
    if (!helper) return;
    this.scene.remove(helper);
    helper.geometry.dispose();
    disposeMaterials(helper.material);
    this.hoverHelper = null;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.renderer.domElement.focus({ preventScroll: true });
    this.pointerDown = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (!start || start.pointerId !== event.pointerId || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;

    this.interactionHandlers.onSelect?.(
      this.pick(event.clientX, event.clientY),
      event.shiftKey || event.ctrlKey || event.metaKey,
    );
  };

  private readonly handlePointerCancel = (): void => {
    this.pointerDown = null;
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.buttons !== 0) return;
    const hit = this.pick(event.clientX, event.clientY);
    this.renderer.domElement.style.cursor = hit ? "pointer" : "";
    this.interactionHandlers.onHover?.(hit);
  };

  private readonly handlePointerLeave = (): void => {
    this.renderer.domElement.style.cursor = "";
    this.interactionHandlers.onHover?.(null);
  };

  private pick(clientX: number, clientY: number): RoomSceneHit | null {
    const build = this.currentBuild;
    if (!build) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);

    for (const intersection of this.raycaster.intersectObject(build.group, true)) {
      const hit = semanticRoomSceneHit(intersection.object);
      if (hit) return hit;
    }
    return null;
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
    this.removeSelectionHelpers();
    this.removeHoverHelper();

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

export function semanticRoomSceneHit(object: Object3D): RoomSceneHit | null {
  let current: Object3D | null = object;
  while (current) {
    const id = current.userData.roomcraftId;
    const kind = current.userData.roomcraftKind;
    if (typeof id === "string") {
      if (kind === "wall") return { id, kind: "wall" };
      if (kind === "object") return { id, kind: "object" };
      if (kind === "room-surface") return { id, kind: "room" };
    }
    current = current.parent;
  }
  return null;
}
