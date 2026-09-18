namespace RoomCraft.Modules.Projects;

internal sealed class ProjectRecord
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public long CurrentRevision { get; set; }
    public DateTimeOffset CreatedUtc { get; set; }
    public DateTimeOffset UpdatedUtc { get; set; }
    public List<ProjectRevisionRecord> Revisions { get; set; } = [];
}

internal sealed class ProjectRevisionRecord
{
    public required string ProjectId { get; set; }
    public long Revision { get; set; }
    public required string DocumentJson { get; set; }
    public DateTimeOffset CreatedUtc { get; set; }
    public ProjectRecord Project { get; set; } = null!;
}
