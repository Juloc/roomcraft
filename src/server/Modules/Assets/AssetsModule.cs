using System.Buffers.Binary;
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
    private const long DefaultMaxModelBytes = 100 * 1024 * 1024;
    private const int MaxGlbJsonChunkBytes = 4 * 1024 * 1024;
    private const uint GlbJsonChunkType = 0x4E4F534A;

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

    private static Task<IResult> UploadBlueprintAsync(
        HttpRequest request,
        AssetsDbContext db,
        IAssetBlobStore blobStore,
        AssetUploadOptions options,
        CancellationToken cancellationToken) =>
        UploadAssetAsync(
            request,
            db,
            blobStore,
            kind: "blueprint",
            idPrefix: "asset_bp_",
            maxBytes: options.MaxBlueprintBytes,
            validateAsync: DetectImageContentTypeAsync,
            invalidMessage: "Blueprint must be a PNG, JPEG or WebP image.",
            cancellationToken);

    private static Task<IResult> UploadModelAsync(
        HttpRequest request,
        AssetsDbContext db,
        IAssetBlobStore blobStore,
        AssetUploadOptions options,
        CancellationToken cancellationToken) =>
        UploadAssetAsync(
            request,
            db,
            blobStore,
            kind: "model",
            idPrefix: "asset_glb_",
            maxBytes: options.MaxModelBytes,
            validateAsync: DetectGlbContentTypeAsync,
            invalidMessage: "Model must be a valid glTF 2.0 binary (.glb) file.",
            cancellationToken);

    private static async Task<IResult> UploadAssetAsync(
        HttpRequest request,
        AssetsDbContext db,
        IAssetBlobStore blobStore,
        string kind,
        string idPrefix,
        long maxBytes,
        Func<IFormFile, CancellationToken, Task<string?>> validateAsync,
        string invalidMessage,
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

        if (file.Length > maxBytes)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        var contentType = await validateAsync(file, cancellationToken);
        if (contentType is null)
        {
            return Results.BadRequest(new { error = invalidMessage });
        }

        StoredBlob stored;
        try
        {
            await using var source = file.OpenReadStream();
            stored = await blobStore.StoreAsync(source, maxBytes, cancellationToken);
        }
        catch (AssetTooLargeException)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        var existing = await db.Assets
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.Kind == kind && item.Sha256 == stored.Sha256,
                cancellationToken);
        if (existing is not null) return Results.Ok(ToResponse(existing));

        var originalFileName = Path.GetFileName(file.FileName);
        if (string.IsNullOrWhiteSpace(originalFileName)) originalFileName = kind;
        if (originalFileName.Length > 512) originalFileName = originalFileName[..512];

        var asset = new AssetRecord
        {
            Id = $"{idPrefix}{stored.Sha256[..32]}",
            Kind = kind,
            ContentType = contentType,
            OriginalFileName = originalFileName,
            SizeBytes = stored.SizeBytes,
            Sha256 = stored.Sha256,
            StorageKey = stored.StorageKey,
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
                    item => item.Kind == kind && item.Sha256 == stored.Sha256,
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

    private static AssetResponse ToResponse(AssetRecord asset) =>
        new(
            asset.Id,
            asset.Kind,
            asset.ContentType,
            asset.OriginalFileName,
            asset.SizeBytes,
            asset.Sha256,
            asset.CreatedUtc,
            $"/api/assets/{asset.Id}/content");

    private static async Task<string?> DetectImageContentTypeAsync(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        var header = new byte[12];
        await using var stream = file.OpenReadStream();
        var read = await ReadAtMostAsync(stream, header, cancellationToken);

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

    private static async Task<string?> DetectGlbContentTypeAsync(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        if (file.Length < 20 || file.Length > uint.MaxValue) return null;

        await using var stream = file.OpenReadStream();
        var header = new byte[12];
        if (await ReadAtMostAsync(stream, header, cancellationToken) != header.Length)
        {
            return null;
        }

        if (header[0] != (byte)'g' ||
            header[1] != (byte)'l' ||
            header[2] != (byte)'T' ||
            header[3] != (byte)'F')
        {
            return null;
        }

        var version = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(4, 4));
        var declaredLength = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(8, 4));
        if (version != 2 || declaredLength != file.Length) return null;

        var chunkHeader = new byte[8];
        if (await ReadAtMostAsync(stream, chunkHeader, cancellationToken) != chunkHeader.Length)
        {
            return null;
        }

        var jsonLength = BinaryPrimitives.ReadUInt32LittleEndian(chunkHeader.AsSpan(0, 4));
        var chunkType = BinaryPrimitives.ReadUInt32LittleEndian(chunkHeader.AsSpan(4, 4));
        if (chunkType != GlbJsonChunkType ||
            jsonLength == 0 ||
            jsonLength > MaxGlbJsonChunkBytes ||
            20L + jsonLength > file.Length)
        {
            return null;
        }

        var jsonBytes = new byte[jsonLength];
        if (await ReadAtMostAsync(stream, jsonBytes, cancellationToken) != jsonBytes.Length)
        {
            return null;
        }

        try
        {
            using var json = JsonDocument.Parse(jsonBytes);
            if (!json.RootElement.TryGetProperty("asset", out var asset) ||
                !asset.TryGetProperty("version", out var assetVersion) ||
                assetVersion.ValueKind != JsonValueKind.String ||
                assetVersion.GetString() is not { } value ||
                !value.StartsWith("2.", StringComparison.Ordinal))
            {
                return null;
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return "model/gltf-binary";
    }

    private static async Task<int> ReadAtMostAsync(
        Stream stream,
        Memory<byte> buffer,
        CancellationToken cancellationToken)
    {
        var total = 0;
        while (total < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer[total..], cancellationToken);
            if (read == 0) break;
            total += read;
        }

        return total;
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
    DateTimeOffset CreatedUtc,
    string ContentUrl);
