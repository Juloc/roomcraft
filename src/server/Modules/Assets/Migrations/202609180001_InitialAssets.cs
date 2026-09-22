using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace RoomCraft.Modules.Assets.Migrations;

[DbContext(typeof(AssetsDbContext))]
[Migration("202609180001_InitialAssets")]
public sealed class InitialAssets : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "assets",
            columns: table => new
            {
                Id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                Kind = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                ContentType = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                OriginalFileName = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                Sha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                StorageKey = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                CreatedUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_assets", item => item.Id));

        migrationBuilder.CreateIndex(
            name: "IX_assets_CreatedUtc",
            table: "assets",
            column: "CreatedUtc");

        migrationBuilder.CreateIndex(
            name: "IX_assets_Kind_Sha256",
            table: "assets",
            columns: new[] { "Kind", "Sha256" },
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "assets");
    }
}
