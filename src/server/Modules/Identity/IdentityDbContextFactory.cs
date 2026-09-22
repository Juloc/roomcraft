using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace RoomCraft.Modules.Identity;

internal sealed class IdentityDbContextFactory : IDesignTimeDbContextFactory<IdentityDbContext>
{
    public IdentityDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ROOMCRAFT_DB")
            ?? "Host=localhost;Port=5432;Database=roomcraft;Username=roomcraft;Password=roomcraft";

        var options = new DbContextOptionsBuilder<IdentityDbContext>()
            .UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable("__identity_migrations_history"))
            .Options;

        return new IdentityDbContext(options);
    }
}
