export interface UploadedAsset {
  id: string;
  kind: string;
  contentType: string;
  originalFileName: string;
  sizeBytes: number;
  sha256: string;
  createdUtc: string;
  contentUrl: string;
}

export interface ImageDimensions {
  widthPx: number;
  heightPx: number;
}

export async function uploadBlueprintAsset(file: File): Promise<UploadedAsset> {
  const form = new FormData();
  form.set("file", file);

  const response = await fetch("/api/assets/blueprints", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message ?? `Blueprint upload failed with HTTP ${response.status}.`);
  }

  return parseAsset(await response.json());
}

export async function readImageDimensions(file: File): Promise<ImageDimensions> {
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error("Blueprint image has invalid dimensions.");
    }

    return {
      widthPx: bitmap.width,
      heightPx: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

export function assetContentUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/content`;
}

async function readError(response: Response): Promise<string | null> {
  try {
    const value = (await response.json()) as unknown;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>).error === "string"
    ) {
      return (value as Record<string, string>).error;
    }
  } catch {
    // The status code fallback below is enough when no JSON error exists.
  }
  return null;
}

function parseAsset(value: unknown): UploadedAsset {
  if (!value || typeof value !== "object") throw new Error("Invalid asset response.");
  const asset = value as Record<string, unknown>;

  for (const field of ["id", "kind", "contentType", "originalFileName", "sha256", "createdUtc", "contentUrl"] as const) {
    if (typeof asset[field] !== "string") {
      throw new Error(`Asset response ${field} is invalid.`);
    }
  }
  if (
    typeof asset.sizeBytes !== "number" ||
    !Number.isSafeInteger(asset.sizeBytes) ||
    asset.sizeBytes <= 0
  ) {
    throw new Error("Asset response sizeBytes is invalid.");
  }

  return asset as unknown as UploadedAsset;
}
