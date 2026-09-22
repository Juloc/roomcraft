export interface CatalogVersionDto {
  version: number;
  assetId: string | null;
  thumbnailAssetId: string | null;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  metadata: Record<string, unknown>;
  createdUtc: string;
}

export interface CatalogItemSummaryDto {
  id: string;
  name: string;
  category: string;
  manufacturer: string | null;
  sku: string | null;
  productUrl: string | null;
  currentVersion: number;
  updatedUtc: string;
  version: CatalogVersionDto;
}

export interface CatalogItemDetailDto {
  id: string;
  name: string;
  category: string;
  manufacturer: string | null;
  sku: string | null;
  productUrl: string | null;
  currentVersion: number;
  createdUtc: string;
  updatedUtc: string;
  versions: CatalogVersionDto[];
}

export interface CatalogSearchResponseDto {
  items: CatalogItemSummaryDto[];
  total: number;
  offset: number;
  limit: number;
}

export interface CatalogSearchOptions {
  query?: string;
  category?: string;
  manufacturer?: string;
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}

export async function searchCatalogItems(
  options: CatalogSearchOptions = {},
): Promise<CatalogSearchResponseDto> {
  const params = new URLSearchParams();
  if (options.query?.trim()) params.set("query", options.query.trim());
  if (options.category?.trim()) params.set("category", options.category.trim());
  if (options.manufacturer?.trim()) {
    params.set("manufacturer", options.manufacturer.trim());
  }
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  if (options.limit !== undefined) params.set("limit", String(options.limit));

  const response = await fetch(
    `/api/catalog/items${params.size > 0 ? `?${params.toString()}` : ""}`,
    { signal: options.signal },
  );
  if (!response.ok) {
    throw new Error(await readApiError(response, "Catalog search failed."));
  }
  return (await response.json()) as CatalogSearchResponseDto;
}

export async function getCatalogItem(
  itemId: string,
  signal?: AbortSignal,
): Promise<CatalogItemDetailDto> {
  const response = await fetch(
    `/api/catalog/items/${encodeURIComponent(itemId)}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(await readApiError(response, "Catalog item could not be loaded."));
  }
  return (await response.json()) as CatalogItemDetailDto;
}

async function readApiError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Fall through to the stable fallback.
  }
  return fallback;
}
