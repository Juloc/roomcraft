using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace RoomCraft.Modules.Projects.Migrations;

[DbContext(typeof(ProjectsDbContext))]
[Migration("202609220002_ProjectOwnership")]
public sealed class ProjectOwnership : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "OwnerId",
            table: "projects",
            type: "character varying(64)",
            maxLength: 64,
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_projects_OwnerId_UpdatedUtc",
            table: "projects",
            columns: new[] { "OwnerId", "UpdatedUtc" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_projects_OwnerId_UpdatedUtc",
            table: "projects");

        migrationBuilder.DropColumn(
            name: "OwnerId",
            table: "projects");
    }
}
