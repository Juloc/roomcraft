namespace RoomCraft.Modules.Assets;

internal sealed class AssetRecord
{
    public required string Id { get; init; }
    public required string Kind { get; init; }
    public required string ContentType { get; init; }
    public required string OriginalFileName { get; init; }
    public required long SizeBytes { get; init; }
    public required string Sha256 { get; init; }
    public required string StorageKey { get; init; }
    public required DateTimeOffset CreatedUtc { get; init; }
}
