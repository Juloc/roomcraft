using Microsoft.EntityFrameworkCore;

namespace RoomCraft.Modules.Identity;

internal sealed class IdentityDbContext(DbContextOptions<IdentityDbContext> options) : DbContext(options)
{
    public DbSet<UserRecord> Users => Set<UserRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var user = modelBuilder.Entity<UserRecord>();
        user.ToTable("identity_users");
        user.HasKey(item => item.Id);
        user.Property(item => item.Id).HasMaxLength(64);
        user.Property(item => item.Username).HasMaxLength(64).IsRequired();
        user.Property(item => item.NormalizedUsername).HasMaxLength(64).IsRequired();
        user.Property(item => item.PasswordHash).HasMaxLength(1024).IsRequired();
        user.HasIndex(item => item.NormalizedUsername).IsUnique();
    }
}
