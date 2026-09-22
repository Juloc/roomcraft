using System.Security.Cryptography;

namespace RoomCraft.Modules.Assets;

internal interface IAssetBlobStore
{
    Task<StoredBlob> StoreAsync(Stream source, long maxBytes, CancellationToken cancellationToken);
    Task<Stream?> OpenReadAsync(string storageKey, CancellationToken cancellationToken);
}

internal sealed record StoredBlob(string StorageKey, string Sha256, long SizeBytes);

internal sealed class AssetTooLargeException(long maxBytes)
    : Exception($"Asset exceeds the configured {maxBytes} byte limit.");

internal sealed class LocalAssetBlobStore : IAssetBlobStore
{
    private readonly string rootPath;
    private readonly string incomingPath;

    public LocalAssetBlobStore(string rootPath)
    {
        this.rootPath = Path.GetFullPath(rootPath);
        incomingPath = Path.Combine(this.rootPath, ".incoming");
        Directory.CreateDirectory(incomingPath);
    }

    public async Task<StoredBlob> StoreAsync(
        Stream source,
        long maxBytes,
        CancellationToken cancellationToken)
    {
        var tempPath = Path.Combine(incomingPath, $"{Guid.NewGuid():N}.upload");
        long sizeBytes = 0;

        try
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using (var target = new FileStream(
                tempPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 81920,
                options: FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                var buffer = new byte[81920];
                while (true)
                {
                    var read = await source.ReadAsync(buffer, cancellationToken);
                    if (read == 0) break;

                    sizeBytes = checked(sizeBytes + read);
                    if (sizeBytes > maxBytes) throw new AssetTooLargeException(maxBytes);

                    hash.AppendData(buffer.AsSpan(0, read));
                    await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                }

                await target.FlushAsync(cancellationToken);
            }

            var sha256 = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
            var storageKey = $"{sha256[..2]}/{sha256}";
            var finalPath = ResolvePath(storageKey);
            Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);

            if (!File.Exists(finalPath))
            {
                try
                {
                    File.Move(tempPath, finalPath);
                }
                catch (IOException) when (File.Exists(finalPath))
                {
                    File.Delete(tempPath);
                }
            }
            else
            {
                File.Delete(tempPath);
            }

            return new StoredBlob(storageKey, sha256, sizeBytes);
        }
        catch
        {
            if (File.Exists(tempPath)) File.Delete(tempPath);
            throw;
        }
    }

    public Task<Stream?> OpenReadAsync(string storageKey, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var path = ResolvePath(storageKey);
        if (!File.Exists(path)) return Task.FromResult<Stream?>(null);

        Stream stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 81920,
            options: FileOptions.Asynchronous | FileOptions.SequentialScan);
        return Task.FromResult<Stream?>(stream);
    }

    private string ResolvePath(string storageKey)
    {
        if (string.IsNullOrWhiteSpace(storageKey) ||
            storageKey.Contains("..", StringComparison.Ordinal) ||
            Path.IsPathRooted(storageKey))
        {
            throw new InvalidOperationException("Invalid asset storage key.");
        }

        var normalized = storageKey.Replace('/', Path.DirectorySeparatorChar);
        var fullPath = Path.GetFullPath(Path.Combine(rootPath, normalized));
        var rootPrefix = rootPath.EndsWith(Path.DirectorySeparatorChar)
            ? rootPath
            : rootPath + Path.DirectorySeparatorChar;

        if (!fullPath.StartsWith(rootPrefix, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Asset storage key escapes the configured root.");
        }

        return fullPath;
    }
}
