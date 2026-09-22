using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;

namespace RoomCraft.Modules.Assets.Migrations;

[DbContext(typeof(AssetsDbContext))]
public sealed class AssetsDbContextModelSnapshot : ModelSnapshot
{
    protected override void BuildModel(ModelBuilder modelBuilder)
    {
        modelBuilder.HasAnnotation("ProductVersion", "10.0.12");
        modelBuilder.HasAnnotation("Relational:MaxIdentifierLength", 63);

        modelBuilder.Entity("RoomCraft.Modules.Assets.AssetRecord", entity =>
        {
            entity.Property<string>("Id")
                .HasMaxLength(128)
                .HasColumnType("character varying(128)");

            entity.Property<string>("ContentType")
                .IsRequired()
                .HasMaxLength(128)
                .HasColumnType("character varying(128)");

            entity.Property<DateTimeOffset>("CreatedUtc")
                .HasColumnType("timestamp with time zone");

            entity.Property<string>("Kind")
                .IsRequired()
                .HasMaxLength(64)
                .HasColumnType("character varying(64)");

            entity.Property<string>("OriginalFileName")
                .IsRequired()
                .HasMaxLength(512)
                .HasColumnType("character varying(512)");

            entity.Property<string>("Sha256")
                .IsRequired()
                .IsFixedLength()
                .HasMaxLength(64)
                .HasColumnType("character(64)");

            entity.Property<long>("SizeBytes")
                .HasColumnType("bigint");

            entity.Property<string>("StorageKey")
                .IsRequired()
                .HasMaxLength(256)
                .HasColumnType("character varying(256)");

            entity.Property<string>("MetadataJson")
                .IsRequired()
                .HasColumnType("jsonb");

            entity.HasKey("Id");
            entity.HasIndex("CreatedUtc");
            entity.HasIndex("Kind", "Sha256").IsUnique();
            entity.ToTable("assets");
        });
    }
}
