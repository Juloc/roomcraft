using Microsoft.EntityFrameworkCore;

namespace RoomCraft.Modules.Catalog;

internal sealed class CatalogDbContext(DbContextOptions<CatalogDbContext> options) : DbContext(options)
{
    public DbSet<CatalogItemRecord> Items => Set<CatalogItemRecord>();
    public DbSet<CatalogItemVersionRecord> Versions => Set<CatalogItemVersionRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var item = modelBuilder.Entity<CatalogItemRecord>();
        item.ToTable("catalog_items");
        item.HasKey(value => value.Id);
        item.Property(value => value.Id).HasMaxLength(128);
        item.Property(value => value.Name).HasMaxLength(256).IsRequired();
        item.Property(value => value.Category).HasMaxLength(128).IsRequired();
        item.Property(value => value.Manufacturer).HasMaxLength(256);
        item.Property(value => value.Sku).HasMaxLength(128);
        item.Property(value => value.ProductUrl).HasMaxLength(2048);
        item.Property(value => value.CurrentVersion).IsConcurrencyToken();
        item.HasIndex(value => value.Category);
        item.HasIndex(value => value.Manufacturer);
        item.HasIndex(value => new { value.Manufacturer, value.Sku });
        item.HasIndex(value => value.UpdatedUtc);

        var version = modelBuilder.Entity<CatalogItemVersionRecord>();
        version.ToTable("catalog_item_versions");
        version.HasKey(value => new { value.CatalogItemId, value.Version });
        version.Property(value => value.CatalogItemId).HasMaxLength(128);
        version.Property(value => value.AssetId).HasMaxLength(128);
        version.Property(value => value.ThumbnailAssetId).HasMaxLength(128);
        version.Property(value => value.MetadataJson).HasColumnType("jsonb").IsRequired();
        version.HasOne(value => value.CatalogItem)
            .WithMany(value => value.Versions)
            .HasForeignKey(value => value.CatalogItemId)
            .OnDelete(DeleteBehavior.Cascade);
        version.HasIndex(value => value.AssetId);
        version.HasIndex(value => value.ThumbnailAssetId);
        version.HasIndex(value => value.CreatedUtc);
    }
}
