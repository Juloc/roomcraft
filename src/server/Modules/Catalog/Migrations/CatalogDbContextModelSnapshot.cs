using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace RoomCraft.Modules.Catalog.Migrations;

[DbContext(typeof(CatalogDbContext))]
public sealed class CatalogDbContextModelSnapshot : ModelSnapshot
{
    protected override void BuildModel(ModelBuilder modelBuilder)
    {
        modelBuilder.HasAnnotation("ProductVersion", "10.0.12");
        modelBuilder.HasAnnotation("Relational:MaxIdentifierLength", 63);

        modelBuilder.Entity("RoomCraft.Modules.Catalog.CatalogItemRecord", entity =>
        {
            entity.Property<string>("Id")
                .HasMaxLength(128)
                .HasColumnType("character varying(128)");

            entity.Property<string>("Category")
                .IsRequired()
                .HasMaxLength(128)
                .HasColumnType("character varying(128)");

            entity.Property<DateTimeOffset>("CreatedUtc")
                .HasColumnType("timestamp with time zone");

            entity.Property<int>("CurrentVersion")
                .IsConcurrencyToken()
                .HasColumnType("integer");

            entity.Property<string>("Manufacturer")
                .HasMaxLength(256)
                .HasColumnType("character varying(256)");

            entity.Property<string>("Name")
                .IsRequired()
                .HasMaxLength(256)
                .HasColumnType("character varying(256)");

            entity.Property<string>("ProductUrl")
                .HasMaxLength(2048)
                .HasColumnType("character varying(2048)");

            entity.Property<string>("Sku")
                .HasMaxLength(128)
                .HasColumnType("character varying(128)");

            entity.Property<DateTimeOffset>("UpdatedUtc")
                .HasColumnType("timestamp with time zone");

            entity.HasKey("Id");
            entity.HasIndex("Category");
            entity.HasIndex("Manufacturer");
            entity.HasIndex("Manufacturer", "Sku");
            entity.HasIndex("UpdatedUtc");
            entity.ToTable("catalog_items");
        });

        modelBuilder.Entity("RoomCraft.Modules.Catalog.CatalogItemVersionRecord", entity =>
        {
            entity.Property<string>("CatalogItemId")
                .HasMaxLength(128)
                .HasColumnType("character varying(128)");

            entity.Property<int>("Version")
                .HasColumnType("integer");

            entity.Property<string>("AssetId")
                .HasMaxLength(128)
                .HasColumnType("character varying(128)");

            entity.Property<DateTimeOffset>("CreatedUtc")
                .HasColumnType("timestamp with time zone");

            entity.Property<int>("DepthMm")
                .HasColumnType("integer");

            entity.Property<int>("HeightMm")
                .HasColumnType("integer");

            entity.Property<string>("MetadataJson")
                .IsRequired()
                .HasColumnType("jsonb");

            entity.Property<string>("ThumbnailAssetId")
                .HasMaxLength(128)
                .HasColumnType("character varying(128)");

            entity.Property<int>("WidthMm")
                .HasColumnType("integer");

            entity.HasKey("CatalogItemId", "Version");
            entity.HasIndex("AssetId");
            entity.HasIndex("CreatedUtc");
            entity.HasIndex("ThumbnailAssetId");
            entity.ToTable("catalog_item_versions");
        });

        modelBuilder.Entity(
            "RoomCraft.Modules.Catalog.CatalogItemVersionRecord",
            entity =>
            {
                entity.HasOne("RoomCraft.Modules.Catalog.CatalogItemRecord", "CatalogItem")
                    .WithMany("Versions")
                    .HasForeignKey("CatalogItemId")
                    .OnDelete(DeleteBehavior.Cascade)
                    .IsRequired();

                entity.Navigation("CatalogItem");
            });

        modelBuilder.Entity(
            "RoomCraft.Modules.Catalog.CatalogItemRecord",
            entity => entity.Navigation("Versions"));
    }
}
