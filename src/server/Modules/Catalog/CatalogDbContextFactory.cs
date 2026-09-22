using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace RoomCraft.Modules.Catalog;

internal sealed class CatalogDbContextFactory : IDesignTimeDbContextFactory<CatalogDbContext>
{
    public CatalogDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ROOMCRAFT_DB")
            ?? "Host=localhost;Port=5432;Database=roomcraft;Username=roomcraft;Password=roomcraft";

        var options = new DbContextOptionsBuilder<CatalogDbContext>()
            .UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable("__catalog_migrations_history"))
            .Options;

        return new CatalogDbContext(options);
    }
}
