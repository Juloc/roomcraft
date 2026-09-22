using System.Buffers.Binary;
using System.Numerics;
using System.Text;
using System.Text.Json;

namespace RoomCraft.Modules.Assets;

internal static class GlbInspector
{
    private const uint GlbMagic = 0x46546C67;
    private const uint JsonChunkType = 0x4E4F534A;
    private const int MaxJsonChunkBytes = 16 * 1024 * 1024;

    private static readonly HashSet<string> DecoderRequiredExtensions =
    [
        "KHR_draco_mesh_compression",
        "KHR_texture_basisu",
        "EXT_meshopt_compression",
    ];

    public static async Task<GlbInspectionResult> InspectAsync(
        Stream stream,
        long fileLength,
        CancellationToken cancellationToken)
    {
        if (!stream.CanRead)
        {
            throw new InvalidDataException("GLB stream is not readable.");
        }

        if (fileLength < 20 || fileLength > uint.MaxValue)
        {
            throw new InvalidDataException("GLB file length is invalid.");
        }

        var header = new byte[12];
        await ReadExactlyAsync(stream, header, cancellationToken);

        var magic = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(0, 4));
        var version = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(4, 4));
        var declaredLength = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(8, 4));

        if (magic != GlbMagic)
        {
            throw new InvalidDataException("File is not a GLB asset.");
        }
        if (version != 2)
        {
            throw new InvalidDataException("Only glTF 2.0 GLB assets are supported.");
        }
        if (declaredLength != fileLength)
        {
            throw new InvalidDataException("GLB declared length does not match the uploaded file.");
        }

        var chunkHeader = new byte[8];
        await ReadExactlyAsync(stream, chunkHeader, cancellationToken);
        var jsonLength = BinaryPrimitives.ReadUInt32LittleEndian(chunkHeader.AsSpan(0, 4));
        var chunkType = BinaryPrimitives.ReadUInt32LittleEndian(chunkHeader.AsSpan(4, 4));

        if (chunkType != JsonChunkType)
        {
            throw new InvalidDataException("The first GLB chunk must be JSON.");
        }
        if (jsonLength == 0 || jsonLength > MaxJsonChunkBytes)
        {
            throw new InvalidDataException("GLB JSON chunk size is invalid.");
        }
        if (20L + jsonLength > fileLength)
        {
            throw new InvalidDataException("GLB JSON chunk exceeds the uploaded file.");
        }

        var jsonBytes = new byte[jsonLength];
        await ReadExactlyAsync(stream, jsonBytes, cancellationToken);

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(jsonBytes);
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("GLB JSON chunk is invalid.", exception);
        }

        using (document)
        {
            var root = document.RootElement;
            ValidateAssetVersion(root);
            ValidateSelfContainedReferences(root);
            var requiredExtensions = ReadRequiredExtensions(root);
            ValidateRequiredExtensions(requiredExtensions);
            var bounds = CalculateSceneBounds(root);

            var size = bounds.Max - bounds.Min;
            if (!IsFinitePositive(size.X) ||
                !IsFinitePositive(size.Y) ||
                !IsFinitePositive(size.Z))
            {
                throw new InvalidDataException(
                    "GLB scene must have non-zero finite geometry bounds on all three axes.");
            }

            var centerX = (bounds.Min.X + bounds.Max.X) / 2f;
            var centerZ = (bounds.Min.Z + bounds.Max.Z) / 2f;

            var metadata = new
            {
                format = "glb",
                gltfVersion = "2.0",
                sourceBoundsMetres = new
                {
                    min = new[] { bounds.Min.X, bounds.Min.Y, bounds.Min.Z },
                    max = new[] { bounds.Max.X, bounds.Max.Y, bounds.Max.Z },
                },
                sourceSizeMetres = new
                {
                    x = size.X,
                    y = size.Y,
                    z = size.Z,
                },
                normalization = new
                {
                    units = "metres",
                    upAxis = "Y",
                    centerXMetres = centerX,
                    floorYMetres = bounds.Min.Y,
                    centerZMetres = centerZ,
                },
                requiredExtensions,
            };

            return new GlbInspectionResult(
                JsonSerializer.Serialize(metadata),
                size.X,
                size.Y,
                size.Z);
        }
    }

    private static void ValidateAssetVersion(JsonElement root)
    {
        if (!root.TryGetProperty("asset", out var asset) ||
            !asset.TryGetProperty("version", out var versionElement) ||
            versionElement.ValueKind != JsonValueKind.String ||
            !string.Equals(versionElement.GetString(), "2.0", StringComparison.Ordinal))
        {
            throw new InvalidDataException("GLB asset.version must be 2.0.");
        }
    }

    private static void ValidateSelfContainedReferences(JsonElement root)
    {
        ValidateUris(root, "buffers");
        ValidateUris(root, "images");
    }

    private static void ValidateUris(JsonElement root, string collectionName)
    {
        if (!root.TryGetProperty(collectionName, out var collection) ||
            collection.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var item in collection.EnumerateArray())
        {
            if (!item.TryGetProperty("uri", out var uriElement) ||
                uriElement.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            var uri = uriElement.GetString();
            if (!string.IsNullOrWhiteSpace(uri) &&
                !uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(
                    $"GLB {collectionName} must be embedded; external URI '{uri}' is not supported.");
            }
        }
    }

    private static string[] ReadRequiredExtensions(JsonElement root)
    {
        if (!root.TryGetProperty("extensionsRequired", out var extensions) ||
            extensions.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return extensions
            .EnumerateArray()
            .Where(value => value.ValueKind == JsonValueKind.String)
            .Select(value => value.GetString())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
    }

    private static void ValidateRequiredExtensions(IEnumerable<string> extensions)
    {
        foreach (var extension in extensions)
        {
            if (DecoderRequiredExtensions.Contains(extension))
            {
                throw new InvalidDataException(
                    $"GLB requires unsupported decoder extension {extension}.");
            }
        }
    }

    private static SceneBounds CalculateSceneBounds(JsonElement root)
    {
        var nodes = ReadArray(root, "nodes");
        var meshes = ReadArray(root, "meshes");
        var accessors = ReadArray(root, "accessors");
        if (nodes.Count == 0 || meshes.Count == 0 || accessors.Count == 0)
        {
            throw new InvalidDataException("GLB scene contains no mesh geometry.");
        }

        var roots = ResolveSceneRoots(root, nodes);
        if (roots.Count == 0)
        {
            throw new InvalidDataException("GLB scene contains no root nodes.");
        }

        SceneBounds? bounds = null;
        foreach (var rootIndex in roots)
        {
            VisitNode(
                rootIndex,
                Matrix4x4.Identity,
                nodes,
                meshes,
                accessors,
                new HashSet<int>(),
                ref bounds);
        }

        return bounds ??
            throw new InvalidDataException("GLB scene contains no bounded POSITION geometry.");
    }

    private static List<int> ResolveSceneRoots(
        JsonElement root,
        IReadOnlyList<JsonElement> nodes)
    {
        var scenes = ReadArray(root, "scenes");
        if (scenes.Count > 0)
        {
            var sceneIndex = 0;
            if (root.TryGetProperty("scene", out var sceneElement) &&
                sceneElement.TryGetInt32(out var configuredScene))
            {
                sceneIndex = configuredScene;
            }
            if ((uint)sceneIndex >= scenes.Count)
            {
                throw new InvalidDataException("GLB default scene index is invalid.");
            }

            return ReadIndexArray(scenes[sceneIndex], "nodes", nodes.Count);
        }

        var children = new HashSet<int>();
        for (var index = 0; index < nodes.Count; index++)
        {
            foreach (var child in ReadIndexArray(nodes[index], "children", nodes.Count))
            {
                children.Add(child);
            }
        }

        return Enumerable.Range(0, nodes.Count)
            .Where(index => !children.Contains(index))
            .ToList();
    }

    private static void VisitNode(
        int nodeIndex,
        Matrix4x4 parentWorld,
        IReadOnlyList<JsonElement> nodes,
        IReadOnlyList<JsonElement> meshes,
        IReadOnlyList<JsonElement> accessors,
        HashSet<int> path,
        ref SceneBounds? bounds)
    {
        if ((uint)nodeIndex >= nodes.Count)
        {
            throw new InvalidDataException("GLB node index is invalid.");
        }
        if (!path.Add(nodeIndex))
        {
            throw new InvalidDataException("GLB node hierarchy contains a cycle.");
        }

        var node = nodes[nodeIndex];
        var world = NodeMatrix(node) * parentWorld;

        if (node.TryGetProperty("mesh", out var meshElement) &&
            meshElement.TryGetInt32(out var meshIndex))
        {
            if ((uint)meshIndex >= meshes.Count)
            {
                throw new InvalidDataException("GLB mesh index is invalid.");
            }

            AddMeshBounds(meshes[meshIndex], world, accessors, ref bounds);
        }

        foreach (var child in ReadIndexArray(node, "children", nodes.Count))
        {
            VisitNode(
                child,
                world,
                nodes,
                meshes,
                accessors,
                path,
                ref bounds);
        }

        path.Remove(nodeIndex);
    }

    private static void AddMeshBounds(
        JsonElement mesh,
        Matrix4x4 world,
        IReadOnlyList<JsonElement> accessors,
        ref SceneBounds? bounds)
    {
        if (!mesh.TryGetProperty("primitives", out var primitives) ||
            primitives.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var primitive in primitives.EnumerateArray())
        {
            if (!primitive.TryGetProperty("attributes", out var attributes) ||
                attributes.ValueKind != JsonValueKind.Object ||
                !attributes.TryGetProperty("POSITION", out var accessorElement) ||
                !accessorElement.TryGetInt32(out var accessorIndex))
            {
                continue;
            }

            if ((uint)accessorIndex >= accessors.Count)
            {
                throw new InvalidDataException("GLB POSITION accessor index is invalid.");
            }

            var accessor = accessors[accessorIndex];
            var min = ReadVector3(accessor, "min");
            var max = ReadVector3(accessor, "max");
            if (min is null || max is null)
            {
                throw new InvalidDataException(
                    "GLB POSITION accessors must provide min/max bounds.");
            }

            AddTransformedBox(min.Value, max.Value, world, ref bounds);
        }
    }

    private static void AddTransformedBox(
        Vector3 min,
        Vector3 max,
        Matrix4x4 world,
        ref SceneBounds? bounds)
    {
        foreach (var x in new[] { min.X, max.X })
        foreach (var y in new[] { min.Y, max.Y })
        foreach (var z in new[] { min.Z, max.Z })
        {
            var point = Vector3.Transform(new Vector3(x, y, z), world);
            if (!IsFinite(point))
            {
                throw new InvalidDataException("GLB node transform produced non-finite bounds.");
            }

            bounds = bounds is null
                ? new SceneBounds(point, point)
                : new SceneBounds(
                    Vector3.Min(bounds.Value.Min, point),
                    Vector3.Max(bounds.Value.Max, point));
        }
    }

    private static Matrix4x4 NodeMatrix(JsonElement node)
    {
        if (node.TryGetProperty("matrix", out var matrixElement))
        {
            var values = ReadFloatArray(matrixElement, 16, "node.matrix");
            return new Matrix4x4(
                values[0], values[1], values[2], values[3],
                values[4], values[5], values[6], values[7],
                values[8], values[9], values[10], values[11],
                values[12], values[13], values[14], values[15]);
        }

        var translation = node.TryGetProperty("translation", out var translationElement)
            ? ReadFloatArray(translationElement, 3, "node.translation")
            : new[] { 0f, 0f, 0f };
        var rotation = node.TryGetProperty("rotation", out var rotationElement)
            ? ReadFloatArray(rotationElement, 4, "node.rotation")
            : new[] { 0f, 0f, 0f, 1f };
        var scale = node.TryGetProperty("scale", out var scaleElement)
            ? ReadFloatArray(scaleElement, 3, "node.scale")
            : new[] { 1f, 1f, 1f };

        var quaternion = new Quaternion(
            rotation[0],
            rotation[1],
            rotation[2],
            rotation[3]);

        if (quaternion.LengthSquared() <= 0 ||
            !float.IsFinite(quaternion.LengthSquared()))
        {
            throw new InvalidDataException("GLB node rotation is invalid.");
        }
        quaternion = Quaternion.Normalize(quaternion);

        return Matrix4x4.CreateScale(scale[0], scale[1], scale[2]) *
               Matrix4x4.CreateFromQuaternion(quaternion) *
               Matrix4x4.CreateTranslation(
                   translation[0],
                   translation[1],
                   translation[2]);
    }

    private static Vector3? ReadVector3(JsonElement owner, string propertyName)
    {
        if (!owner.TryGetProperty(propertyName, out var element)) return null;
        var values = ReadFloatArray(element, 3, $"accessor.{propertyName}");
        return new Vector3(values[0], values[1], values[2]);
    }

    private static float[] ReadFloatArray(
        JsonElement element,
        int expectedLength,
        string field)
    {
        if (element.ValueKind != JsonValueKind.Array ||
            element.GetArrayLength() != expectedLength)
        {
            throw new InvalidDataException($"GLB {field} must have {expectedLength} values.");
        }

        var values = new float[expectedLength];
        var index = 0;
        foreach (var value in element.EnumerateArray())
        {
            if (!value.TryGetSingle(out var parsed) || !float.IsFinite(parsed))
            {
                throw new InvalidDataException($"GLB {field} contains an invalid number.");
            }
            values[index++] = parsed;
        }

        return values;
    }

    private static List<JsonElement> ReadArray(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var element) ||
            element.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return element.EnumerateArray().Select(value => value.Clone()).ToList();
    }

    private static List<int> ReadIndexArray(
        JsonElement owner,
        string propertyName,
        int upperBound)
    {
        if (!owner.TryGetProperty(propertyName, out var element) ||
            element.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<int>();
        foreach (var value in element.EnumerateArray())
        {
            if (!value.TryGetInt32(out var index) || (uint)index >= upperBound)
            {
                throw new InvalidDataException($"GLB {propertyName} contains an invalid index.");
            }
            result.Add(index);
        }

        return result;
    }

    private static async Task ReadExactlyAsync(
        Stream stream,
        Memory<byte> buffer,
        CancellationToken cancellationToken)
    {
        var read = 0;
        while (read < buffer.Length)
        {
            var count = await stream.ReadAsync(buffer[read..], cancellationToken);
            if (count == 0)
            {
                throw new InvalidDataException("GLB file ended unexpectedly.");
            }
            read += count;
        }
    }

    private static bool IsFinite(Vector3 value) =>
        float.IsFinite(value.X) &&
        float.IsFinite(value.Y) &&
        float.IsFinite(value.Z);

    private static bool IsFinitePositive(float value) =>
        float.IsFinite(value) && value > 0;

    private readonly record struct SceneBounds(Vector3 Min, Vector3 Max);
}

internal sealed record GlbInspectionResult(
    string MetadataJson,
    float WidthMetres,
    float HeightMetres,
    float DepthMetres);
