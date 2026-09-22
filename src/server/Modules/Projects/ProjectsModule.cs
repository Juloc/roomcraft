using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace RoomCraft.Modules.Projects;

public static class ProjectsModule
{
    public static IServiceCollection AddProjectsModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("RoomCraft");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("ConnectionStrings:RoomCraft is required.");
        }

        services.AddDbContext<ProjectsDbContext>(options => options.UseNpgsql(connectionString));
        return services;
    }

    public static async Task ApplyProjectsMigrationsAsync(
        this IServiceProvider services,
        CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ProjectsDbContext>();
        await db.Database.MigrateAsync(cancellationToken);
    }

    public static IEndpointRouteBuilder MapProjectsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/projects");

        group.MapPost("", CreateProjectAsync);
        group.MapGet("/{projectId}", GetProjectAsync);
        group.MapPut("/{projectId}", UpdateProjectAsync);

        return endpoints;
    }

    private static async Task<IResult> CreateProjectAsync(
        ProjectDocumentRequest request,
        ProjectsDbContext db,
        CancellationToken cancellationToken)
    {
        ProjectDocumentMetadata metadata;
        try
        {
            metadata = ReadMetadata(request.Document);
        }
        catch (ArgumentException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }

        if (await db.Projects.AnyAsync(item => item.Id == metadata.Id, cancellationToken))
        {
            return Results.Conflict(new { error = "Project already exists." });
        }

        var now = DateTimeOffset.UtcNow;
        var project = new ProjectRecord
        {
            Id = metadata.Id,
            Name = metadata.Name,
            CurrentRevision = 1,
            CreatedUtc = now,
            UpdatedUtc = now,
        };
        var revision = new ProjectRevisionRecord
        {
            ProjectId = project.Id,
            Revision = 1,
            DocumentJson = request.Document.GetRawText(),
            CreatedUtc = now,
            Project = project,
        };

        db.Projects.Add(project);
        db.ProjectRevisions.Add(revision);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/projects/{project.Id}", ToResponse(project, revision));
    }

    private static async Task<IResult> GetProjectAsync(
        string projectId,
        ProjectsDbContext db,
        CancellationToken cancellationToken)
    {
        var project = await db.Projects
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == projectId, cancellationToken);
        if (project is null) return Results.NotFound();

        var revision = await db.ProjectRevisions
            .AsNoTracking()
            .SingleAsync(
                item => item.ProjectId == projectId && item.Revision == project.CurrentRevision,
                cancellationToken);

        return Results.Ok(ToResponse(project, revision));
    }

    private static async Task<IResult> UpdateProjectAsync(
        string projectId,
        ProjectDocumentRequest request,
        HttpRequest httpRequest,
        ProjectsDbContext db,
        CancellationToken cancellationToken)
    {
        if (!TryReadExpectedRevision(httpRequest, out var expectedRevision))
        {
            return Results.StatusCode(StatusCodes.Status428PreconditionRequired);
        }

        ProjectDocumentMetadata metadata;
        try
        {
            metadata = ReadMetadata(request.Document);
        }
        catch (ArgumentException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }

        if (!string.Equals(metadata.Id, projectId, StringComparison.Ordinal))
        {
            return Results.BadRequest(new { error = "Document id must match the route project id." });
        }

        var project = await db.Projects.SingleOrDefaultAsync(
            item => item.Id == projectId,
            cancellationToken);
        if (project is null) return Results.NotFound();

        if (project.CurrentRevision != expectedRevision)
        {
            return Results.Conflict(new
            {
                error = "Project revision is stale.",
                currentRevision = project.CurrentRevision,
            });
        }

        var now = DateTimeOffset.UtcNow;
        var nextRevision = checked(project.CurrentRevision + 1);
        project.Name = metadata.Name;
        project.CurrentRevision = nextRevision;
        project.UpdatedUtc = now;

        var revision = new ProjectRevisionRecord
        {
            ProjectId = project.Id,
            Revision = nextRevision,
            DocumentJson = request.Document.GetRawText(),
            CreatedUtc = now,
            Project = project,
        };
        db.ProjectRevisions.Add(revision);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Results.Conflict(new { error = "Project changed while it was being saved." });
        }

        return Results.Ok(ToResponse(project, revision));
    }

    private static ProjectResponse ToResponse(ProjectRecord project, ProjectRevisionRecord revision)
    {
        using var parsed = JsonDocument.Parse(revision.DocumentJson);
        return new ProjectResponse(
            project.Id,
            project.Name,
            project.CurrentRevision,
            project.UpdatedUtc,
            parsed.RootElement.Clone());
    }

    private static ProjectDocumentMetadata ReadMetadata(JsonElement document)
    {
        if (document.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("Document must be a JSON object.");
        }

        if (!document.TryGetProperty("schemaVersion", out var schemaVersionElement) ||
            !schemaVersionElement.TryGetInt32(out var schemaVersion) ||
            schemaVersion is < 1 or > 2)
        {
            throw new ArgumentException("Project schemaVersion must be 1 or 2.");
        }

        if (!document.TryGetProperty("id", out var idElement) ||
            idElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(idElement.GetString()))
        {
            throw new ArgumentException("Document id is required.");
        }

        if (!document.TryGetProperty("name", out var nameElement) ||
            nameElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(nameElement.GetString()))
        {
            throw new ArgumentException("Document name is required.");
        }

        var id = idElement.GetString()!;
        var name = nameElement.GetString()!;
        if (id.Length > 128) throw new ArgumentException("Document id is too long.");
        if (name.Length > 256) throw new ArgumentException("Document name is too long.");

        return new ProjectDocumentMetadata(id, name);
    }

    private static bool TryReadExpectedRevision(HttpRequest request, out long revision)
    {
        revision = 0;
        if (!request.Headers.TryGetValue("If-Match", out var values)) return false;
        var raw = values.ToString().Trim();
        if (raw.StartsWith("W/", StringComparison.OrdinalIgnoreCase)) raw = raw[2..].Trim();
        raw = raw.Trim('"');
        return long.TryParse(raw, out revision) && revision > 0;
    }

    private sealed record ProjectDocumentMetadata(string Id, string Name);
}

public sealed record ProjectDocumentRequest(JsonElement Document);

public sealed record ProjectResponse(
    string Id,
    string Name,
    long Revision,
    DateTimeOffset UpdatedUtc,
    JsonElement Document);
