using Microsoft.EntityFrameworkCore;

namespace RoomCraft.Modules.Assets;

internal sealed class AssetsDbContext(DbContextOptions<AssetsDbContext> options) : DbContext(options)
{
    public DbSet<AssetRecord> Assets => Set<AssetRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var asset = modelBuilder.Entity<AssetRecord>();
        asset.ToTable("assets");
        asset.HasKey(item => item.Id);
        asset.Property(item => item.Id).HasMaxLength(128);
        asset.Property(item => item.Kind).HasMaxLength(64).IsRequired();
        asset.Property(item => item.ContentType).HasMaxLength(128).IsRequired();
        asset.Property(item => item.OriginalFileName).HasMaxLength(512).IsRequired();
        asset.Property(item => item.Sha256).HasMaxLength(64).IsFixedLength().IsRequired();
        asset.Property(item => item.StorageKey).HasMaxLength(256).IsRequired();
        asset.HasIndex(item => new { item.Kind, item.Sha256 }).IsUnique();
        asset.HasIndex(item => item.CreatedUtc);
    }
}
