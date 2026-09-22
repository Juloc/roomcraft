export type RasterFloorPlanFormat = "png" | "jpeg";

export interface RasterFloorPlanOptions {
  format: RasterFloorPlanFormat;
  maxDimensionPx?: number;
  jpegQuality?: number;
  backgroundColor?: string;
}

export interface RasterDimensions {
  widthPx: number;
  heightPx: number;
}

export async function rasterizeSvgFloorPlan(
  svg: string,
  options: RasterFloorPlanOptions,
): Promise<Blob> {
  const maxDimensionPx = options.maxDimensionPx ?? 2400;
  if (
    !Number.isSafeInteger(maxDimensionPx) ||
    maxDimensionPx < 256 ||
    maxDimensionPx > 8192
  ) {
    throw new Error("Raster maxDimensionPx must be an integer between 256 and 8192.");
  }

  const viewBox = readSvgViewBox(svg);
  const dimensions = rasterDimensionsForViewBox(
    viewBox.width,
    viewBox.height,
    maxDimensionPx,
  );
  const preparedSvg = withRasterDimensions(
    svg,
    dimensions.widthPx,
    dimensions.heightPx,
  );
  const sourceBlob = new Blob([preparedSvg], {
    type: "image/svg+xml;charset=utf-8",
  });
  const sourceUrl = URL.createObjectURL(sourceBlob);

  try {
    const image = await loadImage(sourceUrl);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.widthPx;
    canvas.height = dimensions.heightPx;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("2D canvas is unavailable for raster export.");
    }

    context.fillStyle = options.backgroundColor ?? "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const mimeType =
      options.format === "jpeg" ? "image/jpeg" : "image/png";
    const quality =
      options.format === "jpeg"
        ? normalizeJpegQuality(options.jpegQuality ?? 0.92)
        : undefined;

    return await canvasToBlob(canvas, mimeType, quality);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function rasterDimensionsForViewBox(
  width: number,
  height: number,
  maxDimensionPx: number,
): RasterDimensions {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("SVG viewBox dimensions must be positive and finite.");
  }
  if (
    !Number.isSafeInteger(maxDimensionPx) ||
    maxDimensionPx <= 0
  ) {
    throw new Error("Raster maxDimensionPx must be a positive integer.");
  }

  const scale = maxDimensionPx / Math.max(width, height);
  return {
    widthPx: Math.max(1, Math.round(width * scale)),
    heightPx: Math.max(1, Math.round(height * scale)),
  };
}

function readSvgViewBox(svg: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const match = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(svg);
  if (!match?.[1]) {
    throw new Error("SVG export does not contain a viewBox.");
  }

  const parts = match[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    parts.length !== 4 ||
    parts.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("SVG export contains an invalid viewBox.");
  }

  const [x, y, width, height] = parts;
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("SVG export contains an invalid viewBox.");
  }

  return { x, y, width, height };
}

function withRasterDimensions(
  svg: string,
  widthPx: number,
  heightPx: number,
): string {
  const openingTag = /<svg\b/i;
  if (!openingTag.test(svg)) {
    throw new Error("SVG export does not contain an svg root element.");
  }

  return svg.replace(
    openingTag,
    `<svg width="${widthPx}" height="${heightPx}"`,
  );
}

function normalizeJpegQuality(value: number): number {
  if (!Number.isFinite(value) || value < 0.1 || value > 1) {
    throw new Error("JPEG quality must be between 0.1 and 1.");
  }
  return value;
}

function loadImage(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("SVG could not be decoded for raster export."));
    image.src = sourceUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Browser could not encode the raster export."));
      },
      mimeType,
      quality,
    );
  });
}
