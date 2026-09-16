using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace RoomCraft.Modules.Projects;

internal sealed class ProjectsDbContextFactory : IDesignTimeDbContextFactory<ProjectsDbContext>
{
    public ProjectsDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ROOMCRAFT_DB")
            ?? "Host=localhost;Port=5432;Database=roomcraft;Username=roomcraft;Password=roomcraft";

        var options = new DbContextOptionsBuilder<ProjectsDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new ProjectsDbContext(options);
    }
}
