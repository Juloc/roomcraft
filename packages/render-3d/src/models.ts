import {
  Box3,
  Group,
  Mesh,
  Object3D,
  Texture,
  Vector3,
  type Material,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface GlbInspection {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  meshCount: number;
}

export interface RuntimeModelAsset {
  objectAssetId: string;
  contentUrl: string;
}

export interface ModelDimensionsMm {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export async function inspectGlbFile(file: File): Promise<GlbInspection> {
  const objectUrl = URL.createObjectURL(file);
  let root: Group | null = null;

  try {
    const gltf = await new GLTFLoader().loadAsync(objectUrl);
    root = gltf.scene;
    return inspectModelObject(root);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `GLB could not be loaded: ${error.message}`
        : "GLB could not be loaded.",
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
    if (root) disposeModelResources(root);
  }
}

export async function loadGlbPrototype(contentUrl: string): Promise<Group> {
  const gltf = await new GLTFLoader().loadAsync(contentUrl);
  inspectModelObject(gltf.scene);
  return gltf.scene;
}

export function createNormalizedModelInstance(
  prototype: Group,
  dimensions: ModelDimensionsMm,
  objectId: string,
): Group {
  validateTargetDimensions(dimensions);

  const model = prototype.clone(true);
  const wrapper = new Group();
  wrapper.add(model);
  wrapper.updateMatrixWorld(true);

  const sourceBounds = new Box3().setFromObject(wrapper);
  const sourceSize = sourceBounds.getSize(new Vector3());
  validateSourceSize(sourceSize);

  wrapper.scale.set(
    dimensions.widthMm / 1000 / sourceSize.x,
    dimensions.heightMm / 1000 / sourceSize.y,
    dimensions.depthMm / 1000 / sourceSize.z,
  );
  wrapper.updateMatrixWorld(true);

  const scaledBounds = new Box3().setFromObject(wrapper);
  const center = scaledBounds.getCenter(new Vector3());
  wrapper.position.set(-center.x, -scaledBounds.min.y, -center.z);
  wrapper.updateMatrixWorld(true);

  wrapper.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.userData.roomcraftId = objectId;
    child.userData.roomcraftKind = "object";
    child.userData.roomcraftExternalAsset = true;
  });

  return wrapper;
}

export function disposeModelResources(root: Object3D): void {
  const geometries = new Set<object>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;

    if (child.geometry && !geometries.has(child.geometry)) {
      geometries.add(child.geometry);
      child.geometry.dispose();
    }

    const meshMaterials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of meshMaterials) {
      if (!material || materials.has(material)) continue;
      materials.add(material);

      for (const value of Object.values(material)) {
        if (value instanceof Texture && !textures.has(value)) {
          textures.add(value);
          value.dispose();
        }
      }

      material.dispose();
    }
  });
}

function inspectModelObject(root: Object3D): GlbInspection {
  let meshCount = 0;
  root.traverse((child) => {
    if (child instanceof Mesh) meshCount += 1;
  });
  if (meshCount === 0) {
    throw new Error("GLB does not contain renderable mesh geometry.");
  }

  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    throw new Error("GLB geometry has no measurable bounds.");
  }

  const size = bounds.getSize(new Vector3());
  validateSourceSize(size);

  return {
    widthMm: Math.max(1, Math.round(size.x * 1000)),
    heightMm: Math.max(1, Math.round(size.y * 1000)),
    depthMm: Math.max(1, Math.round(size.z * 1000)),
    meshCount,
  };
}

function validateSourceSize(size: Vector3): void {
  for (const value of [size.x, size.y, size.z]) {
    if (!Number.isFinite(value) || value <= 1e-6) {
      throw new Error("GLB geometry must have non-zero width, depth and height.");
    }
  }
}

function validateTargetDimensions(dimensions: ModelDimensionsMm): void {
  for (const [field, value] of Object.entries(dimensions)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${field} must be positive and finite.`);
    }
  }
}
