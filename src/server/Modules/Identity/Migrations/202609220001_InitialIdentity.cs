using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace RoomCraft.Modules.Identity.Migrations;

[DbContext(typeof(IdentityDbContext))]
[Migration("202609220001_InitialIdentity")]
public sealed class InitialIdentity : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "identity_users",
            columns: table => new
            {
                Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                Username = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                NormalizedUsername = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                PasswordHash = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                IsAdmin = table.Column<bool>(type: "boolean", nullable: false),
                CreatedUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_identity_users", item => item.Id));

        migrationBuilder.CreateIndex(
            name: "IX_identity_users_NormalizedUsername",
            table: "identity_users",
            column: "NormalizedUsername",
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "identity_users");
    }
}
