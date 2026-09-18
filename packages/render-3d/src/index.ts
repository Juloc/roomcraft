import type { Level, Opening, ProjectDocument, Vertex, Wall } from "@roomcraft/document";
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
  private readonly selectedWallMaterial = new MeshStandardMaterial({
    color: new Color(0x5f86f2),
    roughness: 0.72,
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

  setDocument(document: ProjectDocument, levelId: string): void {
    this.assertActive();
    const level = document.levels.find((candidate) => candidate.id === levelId);
    if (!level) throw new Error(`Level ${levelId} does not exist.`);

    this.clearGenerated();
    this.buildLevel(level);
    this.frameLevel(level);
    this.render();
  }

  setSelection(id: string | null): void {
    this.assertActive();
    this.selectedId = id;

    for (const child of this.generated.children) {
      if (!(child instanceof Mesh)) continue;
      child.material =
        child.userData.roomcraftId === id ? this.selectedWallMaterial : this.wallMaterial;
    }

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
    mesh.userData.roomcraftPart = part;
    mesh.position.set(
      mmToMetres(start.xMm + ux * centerDistanceMm),
      mmToMetres(level.elevationMm + bottomMm + blockHeightMm / 2),
      mmToMetres(start.yMm + uz * centerDistanceMm),
    );
    mesh.rotation.y = rotationY;
    this.generated.add(mesh);
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

    const center = new Vector3((minX + maxX) / 2, mmToMetres(level.elevationMm) + 0.8, (minZ + maxZ) / 2);
    const span = Math.max(maxX - minX, maxZ - minZ, 2);
    const distance = Math.max(4.5, span * 1.45);

    this.controls.target.copy(center);
    this.camera.position.set(center.x + distance, center.y + distance * 0.85, center.z + distance);
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
