using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace RoomCraft.Modules.Assets;

public static class AssetsModule
{
    private const long DefaultMaxBlueprintBytes = 25 * 1024 * 1024;
    private const long DefaultMaxModelBytes = 50 * 1024 * 1024;

    public static IServiceCollection AddAssetsModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("RoomCraft");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("ConnectionStrings:RoomCraft is required.");
        }

        services.AddDbContext<AssetsDbContext>(options =>
            options.UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable("__assets_migrations_history")));

        var configuredPath = configuration["Assets:StoragePath"];
        var storagePath = string.IsNullOrWhiteSpace(configuredPath)
            ? Path.Combine(AppContext.BaseDirectory, "data", "assets")
            : Path.GetFullPath(configuredPath);

        var maxBlueprintBytes =
            configuration.GetValue<long?>("Assets:MaxBlueprintBytes") ?? DefaultMaxBlueprintBytes;
        var maxModelBytes =
            configuration.GetValue<long?>("Assets:MaxModelBytes") ?? DefaultMaxModelBytes;
        if (maxBlueprintBytes <= 0)
        {
            throw new InvalidOperationException("Assets:MaxBlueprintBytes must be positive.");
        }
        if (maxModelBytes <= 0)
        {
            throw new InvalidOperationException("Assets:MaxModelBytes must be positive.");
        }

        services.AddSingleton<IAssetBlobStore>(new LocalAssetBlobStore(storagePath));
        services.AddSingleton(new AssetUploadOptions(maxBlueprintBytes, maxModelBytes));
        return services;
    }

    public static async Task ApplyAssetsMigrationsAsync(
        this IServiceProvider services,
        CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AssetsDbContext>();
        await db.Database.MigrateAsync(cancellationToken);
    }

    public static IEndpointRouteBuilder MapAssetsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/assets");
        group.MapPost("/blueprints", UploadBlueprintAsync).DisableAntiforgery();
        group.MapPost("/models", UploadModelAsync).DisableAntiforgery();
        group.MapGet("/{assetId}", GetAssetAsync);
        group.MapGet("/{assetId}/content", GetAssetContentAsync);
        return endpoints;
    }

    private static async Task<IResult> UploadBlueprintAsync(
        HttpRequest request,
        AssetsDbContext db,
        IAssetBlobStore blobStore,
        AssetUploadOptions options,
        CancellationToken cancellationToken)
    {
        if (!request.HasFormContentType)
        {
            return Results.BadRequest(new { error = "multipart/form-data is required." });
        }

        var form = await request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file");
        if (file is null || file.Length <= 0)
        {
            return Results.BadRequest(new { error = "A non-empty file field is required." });
        }

        if (file.Length > options.MaxBlueprintBytes)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        var contentType = await DetectImageContentTypeAsync(file, cancellationToken);
        if (contentType is null)
        {
            return Results.BadRequest(new { error = "Blueprint must be a PNG, JPEG or WebP image." });
        }

        StoredBlob stored;
        try
        {
            await using var source = file.OpenReadStream();
            stored = await blobStore.StoreAsync(
                source,
                options.MaxBlueprintBytes,
                cancellationToken);
        }
        catch (AssetTooLargeException)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        var existing = await db.Assets
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.Kind == "blueprint" && item.Sha256 == stored.Sha256,
                cancellationToken);
        if (existing is not null) return Results.Ok(ToResponse(existing));

        var originalFileName = SafeOriginalFileName(file, "blueprint");

        var asset = new AssetRecord
        {
            Id = $"asset_bp_{stored.Sha256[..32]}",
            Kind = "blueprint",
            ContentType = contentType,
            OriginalFileName = originalFileName,
            SizeBytes = stored.SizeBytes,
            Sha256 = stored.Sha256,
            StorageKey = stored.StorageKey,
            MetadataJson = "{}",
            CreatedUtc = DateTimeOffset.UtcNow,
        };

        db.Assets.Add(asset);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            existing = await db.Assets
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    item => item.Kind == "blueprint" && item.Sha256 == stored.Sha256,
                    cancellationToken);
            if (existing is not null) return Results.Ok(ToResponse(existing));
            throw;
        }

        return Results.Created($"/api/assets/{asset.Id}", ToResponse(asset));
    }

    private static async Task<IResult> UploadModelAsync(
        HttpRequest request,
        AssetsDbContext db,
        IAssetBlobStore blobStore,
        AssetUploadOptions options,
        CancellationToken cancellationToken)
    {
        var file = await ReadUploadFileAsync(request, cancellationToken);
        if (file is null)
        {
            return Results.BadRequest(
                new { error = "A non-empty multipart/form-data file field is required." });
        }

        if (file.Length > options.MaxModelBytes)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        GlbInspectionResult inspection;
        try
        {
            await using var inspectionStream = file.OpenReadStream();
            inspection = await GlbInspector.InspectAsync(
                inspectionStream,
                file.Length,
                cancellationToken);
        }
        catch (InvalidDataException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }

        StoredBlob stored;
        try
        {
            await using var source = file.OpenReadStream();
            stored = await blobStore.StoreAsync(
                source,
                options.MaxModelBytes,
                cancellationToken);
        }
        catch (AssetTooLargeException)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        var existing = await db.Assets
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.Kind == "model" && item.Sha256 == stored.Sha256,
                cancellationToken);
        if (existing is not null) return Results.Ok(ToResponse(existing));

        var asset = new AssetRecord
        {
            Id = $"asset_glb_{stored.Sha256[..32]}",
            Kind = "model",
            ContentType = "model/gltf-binary",
            OriginalFileName = SafeOriginalFileName(file, "model.glb"),
            SizeBytes = stored.SizeBytes,
            Sha256 = stored.Sha256,
            StorageKey = stored.StorageKey,
            MetadataJson = inspection.MetadataJson,
            CreatedUtc = DateTimeOffset.UtcNow,
        };

        db.Assets.Add(asset);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            existing = await db.Assets
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    item => item.Kind == "model" && item.Sha256 == stored.Sha256,
                    cancellationToken);
            if (existing is not null) return Results.Ok(ToResponse(existing));
            throw;
        }

        return Results.Created($"/api/assets/{asset.Id}", ToResponse(asset));
    }

    private static async Task<IResult> GetAssetAsync(
        string assetId,
        AssetsDbContext db,
        CancellationToken cancellationToken)
    {
        var asset = await db.Assets
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == assetId, cancellationToken);
        return asset is null ? Results.NotFound() : Results.Ok(ToResponse(asset));
    }

    private static async Task<IResult> GetAssetContentAsync(
        string assetId,
        HttpResponse response,
        AssetsDbContext db,
        IAssetBlobStore blobStore,
        CancellationToken cancellationToken)
    {
        var asset = await db.Assets
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == assetId, cancellationToken);
        if (asset is null) return Results.NotFound();

        var stream = await blobStore.OpenReadAsync(asset.StorageKey, cancellationToken);
        if (stream is null) return Results.NotFound();

        response.Headers.CacheControl = "public, max-age=31536000, immutable";
        response.Headers.ETag = $"\"{asset.Sha256}\"";
        return Results.File(stream, asset.ContentType, enableRangeProcessing: true);
    }

    private static AssetResponse ToResponse(AssetRecord asset)
    {
        using var metadata = JsonDocument.Parse(asset.MetadataJson);
        return new AssetResponse(
            asset.Id,
            asset.Kind,
            asset.ContentType,
            asset.OriginalFileName,
            asset.SizeBytes,
            asset.Sha256,
            metadata.RootElement.Clone(),
            asset.CreatedUtc,
            $"/api/assets/{asset.Id}/content");
    }

    private static async Task<IFormFile?> ReadUploadFileAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        if (!request.HasFormContentType) return null;
        var form = await request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file");
        return file is { Length: > 0 } ? file : null;
    }

    private static string SafeOriginalFileName(IFormFile file, string fallback)
    {
        var value = Path.GetFileName(file.FileName);
        if (string.IsNullOrWhiteSpace(value)) value = fallback;
        return value.Length > 512 ? value[..512] : value;
    }

    private static async Task<string?> DetectImageContentTypeAsync(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        var header = new byte[12];
        await using var stream = file.OpenReadStream();
        var read = 0;
        while (read < header.Length)
        {
            var count = await stream.ReadAsync(
                header.AsMemory(read, header.Length - read),
                cancellationToken);
            if (count == 0) break;
            read += count;
        }

        if (read >= 8 &&
            header[0] == 0x89 &&
            header[1] == 0x50 &&
            header[2] == 0x4E &&
            header[3] == 0x47 &&
            header[4] == 0x0D &&
            header[5] == 0x0A &&
            header[6] == 0x1A &&
            header[7] == 0x0A)
        {
            return "image/png";
        }

        if (read >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF)
        {
            return "image/jpeg";
        }

        if (read >= 12 &&
            header[0] == (byte)'R' &&
            header[1] == (byte)'I' &&
            header[2] == (byte)'F' &&
            header[3] == (byte)'F' &&
            header[8] == (byte)'W' &&
            header[9] == (byte)'E' &&
            header[10] == (byte)'B' &&
            header[11] == (byte)'P')
        {
            return "image/webp";
        }

        return null;
    }

    private sealed record AssetUploadOptions(
        long MaxBlueprintBytes,
        long MaxModelBytes);
}

public sealed record AssetResponse(
    string Id,
    string Kind,
    string ContentType,
    string OriginalFileName,
    long SizeBytes,
    string Sha256,
    JsonElement Metadata,
    DateTimeOffset CreatedUtc,
    string ContentUrl);
