import type { Level, ProjectDocument } from "@roomcraft/document";
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
  private readonly resizeObserver: ResizeObserver;
  private readonly grid: GridHelper;
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

  setDocument(document: ProjectDocument, levelId: string): void {
    this.assertActive();
    const level = document.levels.find((candidate) => candidate.id === levelId);
    if (!level) throw new Error(`Level ${levelId} does not exist.`);

    this.clearGenerated();
    this.buildLevel(level);
    this.frameLevel(level);
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

      const dxMm = end.xMm - start.xMm;
      const dzMm = end.yMm - start.yMm;
      const lengthMm = Math.hypot(dxMm, dzMm);
      if (lengthMm <= 0) continue;

      const heightMm = wall.heightMm ?? level.defaultWallHeightMm;
      const geometry = new BoxGeometry(
        mmToMetres(lengthMm),
        mmToMetres(heightMm),
        mmToMetres(wall.thicknessMm),
      );
      const mesh = new Mesh(geometry, this.wallMaterial);
      mesh.name = wall.id;
      mesh.userData.roomcraftId = wall.id;
      mesh.position.set(
        mmToMetres((start.xMm + end.xMm) / 2),
        mmToMetres(heightMm) / 2,
        mmToMetres((start.yMm + end.yMm) / 2),
      );
      mesh.rotation.y = -Math.atan2(dzMm, dxMm);
      this.generated.add(mesh);
    }
  }

  private frameLevel(level: Level): void {
    if (level.vertices.length === 0) {
      this.controls.target.set(0, 0.8, 0);
      this.camera.position.set(5, 5, 5);
      this.controls.update();
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (const vertex of level.vertices) {
      minX = Math.min(minX, mmToMetres(vertex.xMm));
      maxX = Math.max(maxX, mmToMetres(vertex.xMm));
      minZ = Math.min(minZ, mmToMetres(vertex.yMm));
      maxZ = Math.max(maxZ, mmToMetres(vertex.yMm));
    }

    const center = new Vector3((minX + maxX) / 2, 0.8, (minZ + maxZ) / 2);
    const span = Math.max(maxX - minX, maxZ - minZ, 2);
    const distance = Math.max(4.5, span * 1.45);

    this.controls.target.copy(center);
    this.camera.position.set(center.x + distance, distance * 0.85, center.z + distance);
    this.camera.lookAt(center);
    this.controls.update();
  }

  private clearGenerated(): void {
    for (const child of [...this.generated.children]) {
      if (child instanceof Mesh) child.geometry.dispose();
      this.generated.remove(child);
    }
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
