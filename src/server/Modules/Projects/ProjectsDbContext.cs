using Microsoft.EntityFrameworkCore;

namespace RoomCraft.Modules.Projects;

internal sealed class ProjectsDbContext(DbContextOptions<ProjectsDbContext> options) : DbContext(options)
{
    public DbSet<ProjectRecord> Projects => Set<ProjectRecord>();
    public DbSet<ProjectRevisionRecord> ProjectRevisions => Set<ProjectRevisionRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var project = modelBuilder.Entity<ProjectRecord>();
        project.ToTable("projects");
        project.HasKey(item => item.Id);
        project.Property(item => item.Id).HasMaxLength(128);
        project.Property(item => item.Name).HasMaxLength(256).IsRequired();
        project.Property(item => item.OwnerId).HasMaxLength(64);
        project.Property(item => item.CurrentRevision).IsConcurrencyToken();
        project.HasIndex(item => item.UpdatedUtc);
        project.HasIndex(item => new { item.OwnerId, item.UpdatedUtc });

        var revision = modelBuilder.Entity<ProjectRevisionRecord>();
        revision.ToTable("project_revisions");
        revision.HasKey(item => new { item.ProjectId, item.Revision });
        revision.Property(item => item.ProjectId).HasMaxLength(128);
        revision.Property(item => item.DocumentJson).HasColumnType("jsonb").IsRequired();
        revision.HasOne(item => item.Project)
            .WithMany(item => item.Revisions)
            .HasForeignKey(item => item.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
