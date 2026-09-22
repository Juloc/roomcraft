using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace RoomCraft.Modules.Assets.Migrations;

[DbContext(typeof(AssetsDbContext))]
[Migration("202609220002_AddAssetMetadata")]
public sealed class AddAssetMetadata : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "MetadataJson",
            table: "assets",
            type: "jsonb",
            nullable: false,
            defaultValue: "{}");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "MetadataJson",
            table: "assets");
    }
}
