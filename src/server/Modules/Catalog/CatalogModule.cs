using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace RoomCraft.Modules.Catalog;

public static class CatalogModule
{
    private const int DefaultPageSize = 40;
    private const int MaxPageSize = 100;

    public static IServiceCollection AddCatalogModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("RoomCraft");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("ConnectionStrings:RoomCraft is required.");
        }

        services.AddDbContext<CatalogDbContext>(options =>
            options.UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable("__catalog_migrations_history")));

        return services;
    }

    public static async Task ApplyCatalogMigrationsAsync(
        this IServiceProvider services,
        CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        await db.Database.MigrateAsync(cancellationToken);
    }

    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/catalog/items");

        group.MapGet("", SearchItemsAsync);
        group.MapGet("/{itemId}", GetItemAsync);
        group.MapPost("", CreateItemAsync);
        group.MapPut("/{itemId}", UpdateItemMetadataAsync);
        group.MapPost("/{itemId}/versions", AppendVersionAsync);

        return endpoints;
    }

    private static async Task<IResult> SearchItemsAsync(
        string? query,
        string? category,
        string? manufacturer,
        int? limit,
        int? offset,
        CatalogDbContext db,
        CancellationToken cancellationToken)
    {
        var pageSize = Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize);
        var pageOffset = Math.Max(0, offset ?? 0);

        var itemsQuery = db.Items.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(query))
        {
            var pattern = $"%{EscapeLike(query.Trim())}%";
            itemsQuery = itemsQuery.Where(item =>
                EF.Functions.ILike(item.Name, pattern, "\\") ||
                (item.Manufacturer != null &&
                 EF.Functions.ILike(item.Manufacturer, pattern, "\\")) ||
                (item.Sku != null &&
                 EF.Functions.ILike(item.Sku, pattern, "\\")));
        }

        if (!string.IsNullOrWhiteSpace(category))
        {
            var categoryValue = category.Trim();
            itemsQuery = itemsQuery.Where(item =>
                EF.Functions.ILike(item.Category, categoryValue));
        }

        if (!string.IsNullOrWhiteSpace(manufacturer))
        {
            var manufacturerValue = manufacturer.Trim();
            itemsQuery = itemsQuery.Where(item =>
                item.Manufacturer != null &&
                EF.Functions.ILike(item.Manufacturer, manufacturerValue));
        }

        var total = await itemsQuery.CountAsync(cancellationToken);
        var items = await itemsQuery
            .OrderBy(item => item.Name)
            .ThenBy(item => item.Id)
            .Skip(pageOffset)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var versions = await LoadCurrentVersionsAsync(items, db, cancellationToken);
        var responseItems = items
            .Select(item => ToSummary(item, versions[item.Id]))
            .ToArray();

        return Results.Ok(new CatalogSearchResponse(
            responseItems,
            total,
            pageOffset,
            pageSize));
    }

    private static async Task<IResult> GetItemAsync(
        string itemId,
        CatalogDbContext db,
        CancellationToken cancellationToken)
    {
        var item = await db.Items
            .AsNoTracking()
            .SingleOrDefaultAsync(value => value.Id == itemId, cancellationToken);
        if (item is null) return Results.NotFound();

        var versions = await db.Versions
            .AsNoTracking()
            .Where(value => value.CatalogItemId == itemId)
            .OrderByDescending(value => value.Version)
            .ToListAsync(cancellationToken);

        return Results.Ok(ToDetail(item, versions));
    }

    private static async Task<IResult> CreateItemAsync(
        CatalogItemCreateRequest request,
        CatalogDbContext db,
        CancellationToken cancellationToken)
    {
        ValidatedCatalogMetadata metadata;
        ValidatedCatalogVersion version;
        try
        {
            metadata = ValidateMetadata(
                request.Name,
                request.Category,
                request.Manufacturer,
                request.Sku,
                request.ProductUrl);
            version = ValidateVersion(request.Version);
        }
        catch (ArgumentException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }

        var id = string.IsNullOrWhiteSpace(request.Id)
            ? $"catalog_{Guid.NewGuid():N}"
            : request.Id.Trim();

        if (!IsValidId(id))
        {
            return Results.BadRequest(new
            {
                error = "Catalog item id may only contain letters, numbers, ':', '_' and '-'.",
            });
        }

        if (await db.Items.AnyAsync(value => value.Id == id, cancellationToken))
        {
            return Results.Conflict(new { error = "Catalog item already exists." });
        }

        var now = DateTimeOffset.UtcNow;
        var item = new CatalogItemRecord
        {
            Id = id,
            Name = metadata.Name,
            Category = metadata.Category,
            Manufacturer = metadata.Manufacturer,
            Sku = metadata.Sku,
            ProductUrl = metadata.ProductUrl,
            CurrentVersion = 1,
            CreatedUtc = now,
            UpdatedUtc = now,
        };
        var versionRecord = CreateVersionRecord(item, 1, version, now);

        db.Items.Add(item);
        db.Versions.Add(versionRecord);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/catalog/items/{item.Id}",
            ToDetail(item, [versionRecord]));
    }

    private static async Task<IResult> UpdateItemMetadataAsync(
        string itemId,
        CatalogItemMetadataRequest request,
        CatalogDbContext db,
        CancellationToken cancellationToken)
    {
        ValidatedCatalogMetadata metadata;
        try
        {
            metadata = ValidateMetadata(
                request.Name,
                request.Category,
                request.Manufacturer,
                request.Sku,
                request.ProductUrl);
        }
        catch (ArgumentException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }

        var item = await db.Items.SingleOrDefaultAsync(
            value => value.Id == itemId,
            cancellationToken);
        if (item is null) return Results.NotFound();

        item.Name = metadata.Name;
        item.Category = metadata.Category;
        item.Manufacturer = metadata.Manufacturer;
        item.Sku = metadata.Sku;
        item.ProductUrl = metadata.ProductUrl;
        item.UpdatedUtc = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(cancellationToken);

        var currentVersion = await db.Versions
            .AsNoTracking()
            .SingleAsync(
                value =>
                    value.CatalogItemId == item.Id &&
                    value.Version == item.CurrentVersion,
                cancellationToken);

        return Results.Ok(ToSummary(item, currentVersion));
    }

    private static async Task<IResult> AppendVersionAsync(
        string itemId,
        CatalogVersionRequest request,
        CatalogDbContext db,
        CancellationToken cancellationToken)
    {
        ValidatedCatalogVersion version;
        try
        {
            version = ValidateVersion(request);
        }
        catch (ArgumentException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }

        var item = await db.Items.SingleOrDefaultAsync(
            value => value.Id == itemId,
            cancellationToken);
        if (item is null) return Results.NotFound();

        var nextVersion = checked(item.CurrentVersion + 1);
        var now = DateTimeOffset.UtcNow;
        var versionRecord = CreateVersionRecord(item, nextVersion, version, now);
        item.CurrentVersion = nextVersion;
        item.UpdatedUtc = now;
        db.Versions.Add(versionRecord);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Results.Conflict(new
            {
                error = "Catalog item changed while a version was being appended.",
            });
        }

        return Results.Created(
            $"/api/catalog/items/{item.Id}",
            ToVersion(versionRecord));
    }

    private static async Task<Dictionary<string, CatalogItemVersionRecord>> LoadCurrentVersionsAsync(
        IReadOnlyCollection<CatalogItemRecord> items,
        CatalogDbContext db,
        CancellationToken cancellationToken)
    {
        if (items.Count == 0) return [];

        var ids = items.Select(item => item.Id).ToArray();
        var versions = await db.Versions
            .AsNoTracking()
            .Where(version => ids.Contains(version.CatalogItemId))
            .ToListAsync(cancellationToken);

        return items.ToDictionary(
            item => item.Id,
            item => versions.Single(version =>
                version.CatalogItemId == item.Id &&
                version.Version == item.CurrentVersion),
            StringComparer.Ordinal);
    }

    private static CatalogItemVersionRecord CreateVersionRecord(
        CatalogItemRecord item,
        int versionNumber,
        ValidatedCatalogVersion version,
        DateTimeOffset createdUtc) =>
        new()
        {
            CatalogItemId = item.Id,
            Version = versionNumber,
            AssetId = version.AssetId,
            ThumbnailAssetId = version.ThumbnailAssetId,
            WidthMm = version.WidthMm,
            DepthMm = version.DepthMm,
            HeightMm = version.HeightMm,
            MetadataJson = version.MetadataJson,
            CreatedUtc = createdUtc,
            CatalogItem = item,
        };

    private static CatalogItemSummaryResponse ToSummary(
        CatalogItemRecord item,
        CatalogItemVersionRecord version) =>
        new(
            item.Id,
            item.Name,
            item.Category,
            item.Manufacturer,
            item.Sku,
            item.ProductUrl,
            item.CurrentVersion,
            item.UpdatedUtc,
            ToVersion(version));

    private static CatalogItemDetailResponse ToDetail(
        CatalogItemRecord item,
        IReadOnlyCollection<CatalogItemVersionRecord> versions) =>
        new(
            item.Id,
            item.Name,
            item.Category,
            item.Manufacturer,
            item.Sku,
            item.ProductUrl,
            item.CurrentVersion,
            item.CreatedUtc,
            item.UpdatedUtc,
            versions.Select(ToVersion).ToArray());

    private static CatalogVersionResponse ToVersion(CatalogItemVersionRecord version)
    {
        using var metadata = JsonDocument.Parse(version.MetadataJson);
        return new CatalogVersionResponse(
            version.Version,
            version.AssetId,
            version.ThumbnailAssetId,
            version.WidthMm,
            version.DepthMm,
            version.HeightMm,
            metadata.RootElement.Clone(),
            version.CreatedUtc);
    }

    private static ValidatedCatalogMetadata ValidateMetadata(
        string name,
        string category,
        string? manufacturer,
        string? sku,
        string? productUrl)
    {
        var validName = RequiredText(name, "name", 256);
        var validCategory = RequiredText(category, "category", 128);
        var validManufacturer = OptionalText(manufacturer, "manufacturer", 256);
        var validSku = OptionalText(sku, "sku", 128);
        var validProductUrl = OptionalText(productUrl, "productUrl", 2048);

        if (validProductUrl is not null &&
            (!Uri.TryCreate(validProductUrl, UriKind.Absolute, out var uri) ||
             (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)))
        {
            throw new ArgumentException("productUrl must be an absolute HTTP or HTTPS URL.");
        }

        return new(
            validName,
            validCategory,
            validManufacturer,
            validSku,
            validProductUrl);
    }

    private static ValidatedCatalogVersion ValidateVersion(CatalogVersionRequest request)
    {
        if (request.WidthMm <= 0 || request.DepthMm <= 0 || request.HeightMm <= 0)
        {
            throw new ArgumentException("Catalog version dimensions must be positive integer millimetres.");
        }

        var assetId = OptionalText(request.AssetId, "assetId", 128);
        var thumbnailAssetId = OptionalText(
            request.ThumbnailAssetId,
            "thumbnailAssetId",
            128);

        string metadataJson;
        if (request.Metadata is null)
        {
            metadataJson = "{}";
        }
        else if (request.Metadata.Value.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("metadata must be a JSON object.");
        }
        else
        {
            metadataJson = request.Metadata.Value.GetRawText();
        }

        return new(
            assetId,
            thumbnailAssetId,
            request.WidthMm,
            request.DepthMm,
            request.HeightMm,
            metadataJson);
    }

    private static string RequiredText(string value, string field, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException($"{field} is required.");
        }

        var trimmed = value.Trim();
        if (trimmed.Length > maxLength)
        {
            throw new ArgumentException($"{field} is too long.");
        }

        return trimmed;
    }

    private static string? OptionalText(string? value, string field, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        if (trimmed.Length > maxLength)
        {
            throw new ArgumentException($"{field} is too long.");
        }

        return trimmed;
    }

    private static bool IsValidId(string value)
    {
        if (value.Length is < 1 or > 128) return false;
        return value.All(character =>
            char.IsAsciiLetterOrDigit(character) ||
            character is ':' or '_' or '-');
    }

    private static string EscapeLike(string value) =>
        value
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);

    private sealed record ValidatedCatalogMetadata(
        string Name,
        string Category,
        string? Manufacturer,
        string? Sku,
        string? ProductUrl);

    private sealed record ValidatedCatalogVersion(
        string? AssetId,
        string? ThumbnailAssetId,
        int WidthMm,
        int DepthMm,
        int HeightMm,
        string MetadataJson);
}

public sealed record CatalogItemCreateRequest(
    string? Id,
    string Name,
    string Category,
    string? Manufacturer,
    string? Sku,
    string? ProductUrl,
    CatalogVersionRequest Version);

public sealed record CatalogItemMetadataRequest(
    string Name,
    string Category,
    string? Manufacturer,
    string? Sku,
    string? ProductUrl);

public sealed record CatalogVersionRequest(
    string? AssetId,
    string? ThumbnailAssetId,
    int WidthMm,
    int DepthMm,
    int HeightMm,
    JsonElement? Metadata);

public sealed record CatalogVersionResponse(
    int Version,
    string? AssetId,
    string? ThumbnailAssetId,
    int WidthMm,
    int DepthMm,
    int HeightMm,
    JsonElement Metadata,
    DateTimeOffset CreatedUtc);

public sealed record CatalogItemSummaryResponse(
    string Id,
    string Name,
    string Category,
    string? Manufacturer,
    string? Sku,
    string? ProductUrl,
    int CurrentVersion,
    DateTimeOffset UpdatedUtc,
    CatalogVersionResponse Version);

public sealed record CatalogItemDetailResponse(
    string Id,
    string Name,
    string Category,
    string? Manufacturer,
    string? Sku,
    string? ProductUrl,
    int CurrentVersion,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc,
    IReadOnlyList<CatalogVersionResponse> Versions);

public sealed record CatalogSearchResponse(
    IReadOnlyList<CatalogItemSummaryResponse> Items,
    int Total,
    int Offset,
    int Limit);
