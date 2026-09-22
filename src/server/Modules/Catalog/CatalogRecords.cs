namespace RoomCraft.Modules.Catalog;

internal sealed class CatalogItemRecord
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Category { get; set; }
    public string? Manufacturer { get; set; }
    public string? Sku { get; set; }
    public string? ProductUrl { get; set; }
    public int CurrentVersion { get; set; }
    public DateTimeOffset CreatedUtc { get; set; }
    public DateTimeOffset UpdatedUtc { get; set; }
    public List<CatalogItemVersionRecord> Versions { get; set; } = [];
}

internal sealed class CatalogItemVersionRecord
{
    public required string CatalogItemId { get; set; }
    public int Version { get; set; }
    public string? AssetId { get; set; }
    public string? ThumbnailAssetId { get; set; }
    public int WidthMm { get; set; }
    public int DepthMm { get; set; }
    public int HeightMm { get; set; }
    public required string MetadataJson { get; set; }
    public DateTimeOffset CreatedUtc { get; set; }
    public CatalogItemRecord CatalogItem { get; set; } = null!;
}
