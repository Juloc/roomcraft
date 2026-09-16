using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace RoomCraft.Modules.Projects.Migrations;

[DbContext(typeof(ProjectsDbContext))]
internal sealed class ProjectsDbContextModelSnapshot : ModelSnapshot
{
    protected override void BuildModel(ModelBuilder modelBuilder)
    {
        modelBuilder.HasAnnotation("ProductVersion", "10.0.12");
        modelBuilder.HasAnnotation("Relational:MaxIdentifierLength", 63);

        var project = modelBuilder.Entity<ProjectRecord>();
        project.ToTable("projects");
        project.HasKey(item => item.Id);
        project.Property(item => item.Id).HasMaxLength(128);
        project.Property(item => item.Name).HasMaxLength(256).IsRequired();
        project.Property(item => item.CurrentRevision).IsConcurrencyToken();
        project.Property(item => item.CreatedUtc);
        project.Property(item => item.UpdatedUtc);
        project.HasIndex(item => item.UpdatedUtc);

        var revision = modelBuilder.Entity<ProjectRevisionRecord>();
        revision.ToTable("project_revisions");
        revision.HasKey(item => new { item.ProjectId, item.Revision });
        revision.Property(item => item.ProjectId).HasMaxLength(128);
        revision.Property(item => item.Revision);
        revision.Property(item => item.DocumentJson).HasColumnType("jsonb").IsRequired();
        revision.Property(item => item.CreatedUtc);
        revision.HasOne(item => item.Project)
            .WithMany(item => item.Revisions)
            .HasForeignKey(item => item.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
