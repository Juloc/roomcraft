using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace RoomCraft.Modules.Catalog.Migrations;

[DbContext(typeof(CatalogDbContext))]
[Migration("202609220001_InitialCatalog")]
public sealed class InitialCatalog : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "catalog_items",
            columns: table => new
            {
                Id = table.Column<string>(
                    type: "character varying(128)",
                    maxLength: 128,
                    nullable: false),
                Name = table.Column<string>(
                    type: "character varying(256)",
                    maxLength: 256,
                    nullable: false),
                Category = table.Column<string>(
                    type: "character varying(128)",
                    maxLength: 128,
                    nullable: false),
                Manufacturer = table.Column<string>(
                    type: "character varying(256)",
                    maxLength: 256,
                    nullable: true),
                Sku = table.Column<string>(
                    type: "character varying(128)",
                    maxLength: 128,
                    nullable: true),
                ProductUrl = table.Column<string>(
                    type: "character varying(2048)",
                    maxLength: 2048,
                    nullable: true),
                CurrentVersion = table.Column<int>(
                    type: "integer",
                    nullable: false),
                CreatedUtc = table.Column<DateTimeOffset>(
                    type: "timestamp with time zone",
                    nullable: false),
                UpdatedUtc = table.Column<DateTimeOffset>(
                    type: "timestamp with time zone",
                    nullable: false),
            },
            constraints: table =>
                table.PrimaryKey("PK_catalog_items", item => item.Id));

        migrationBuilder.CreateTable(
            name: "catalog_item_versions",
            columns: table => new
            {
                CatalogItemId = table.Column<string>(
                    type: "character varying(128)",
                    maxLength: 128,
                    nullable: false),
                Version = table.Column<int>(
                    type: "integer",
                    nullable: false),
                AssetId = table.Column<string>(
                    type: "character varying(128)",
                    maxLength: 128,
                    nullable: true),
                ThumbnailAssetId = table.Column<string>(
                    type: "character varying(128)",
                    maxLength: 128,
                    nullable: true),
                WidthMm = table.Column<int>(
                    type: "integer",
                    nullable: false),
                DepthMm = table.Column<int>(
                    type: "integer",
                    nullable: false),
                HeightMm = table.Column<int>(
                    type: "integer",
                    nullable: false),
                MetadataJson = table.Column<string>(
                    type: "jsonb",
                    nullable: false),
                CreatedUtc = table.Column<DateTimeOffset>(
                    type: "timestamp with time zone",
                    nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey(
                    "PK_catalog_item_versions",
                    item => new { item.CatalogItemId, item.Version });
                table.ForeignKey(
                    name: "FK_catalog_item_versions_catalog_items_CatalogItemId",
                    column: item => item.CatalogItemId,
                    principalTable: "catalog_items",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_catalog_items_Category",
            table: "catalog_items",
            column: "Category");

        migrationBuilder.CreateIndex(
            name: "IX_catalog_items_Manufacturer",
            table: "catalog_items",
            column: "Manufacturer");

        migrationBuilder.CreateIndex(
            name: "IX_catalog_items_Manufacturer_Sku",
            table: "catalog_items",
            columns: new[] { "Manufacturer", "Sku" });

        migrationBuilder.CreateIndex(
            name: "IX_catalog_items_UpdatedUtc",
            table: "catalog_items",
            column: "UpdatedUtc");

        migrationBuilder.CreateIndex(
            name: "IX_catalog_item_versions_AssetId",
            table: "catalog_item_versions",
            column: "AssetId");

        migrationBuilder.CreateIndex(
            name: "IX_catalog_item_versions_CreatedUtc",
            table: "catalog_item_versions",
            column: "CreatedUtc");

        migrationBuilder.CreateIndex(
            name: "IX_catalog_item_versions_ThumbnailAssetId",
            table: "catalog_item_versions",
            column: "ThumbnailAssetId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "catalog_item_versions");
        migrationBuilder.DropTable(name: "catalog_items");
    }
}
