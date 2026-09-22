using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace RoomCraft.Modules.Identity.Migrations;

[DbContext(typeof(IdentityDbContext))]
internal sealed class IdentityDbContextModelSnapshot : ModelSnapshot
{
    protected override void BuildModel(ModelBuilder modelBuilder)
    {
        modelBuilder.HasAnnotation("ProductVersion", "10.0.12");
        modelBuilder.HasAnnotation("Relational:MaxIdentifierLength", 63);

        var user = modelBuilder.Entity<UserRecord>();
        user.ToTable("identity_users");
        user.HasKey(item => item.Id);
        user.Property(item => item.Id).HasMaxLength(64);
        user.Property(item => item.Username).HasMaxLength(64).IsRequired();
        user.Property(item => item.NormalizedUsername).HasMaxLength(64).IsRequired();
        user.Property(item => item.PasswordHash).HasMaxLength(1024).IsRequired();
        user.Property(item => item.IsAdmin);
        user.Property(item => item.CreatedUtc);
        user.HasIndex(item => item.NormalizedUsername).IsUnique();
    }
}
