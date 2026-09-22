using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace RoomCraft.Modules.Assets;

internal sealed class AssetsDbContextFactory : IDesignTimeDbContextFactory<AssetsDbContext>
{
    public AssetsDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ROOMCRAFT_DB")
            ?? "Host=localhost;Port=5432;Database=roomcraft;Username=roomcraft;Password=roomcraft";

        var options = new DbContextOptionsBuilder<AssetsDbContext>()
            .UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable("__assets_migrations_history"))
            .Options;

        return new AssetsDbContext(options);
    }
}
