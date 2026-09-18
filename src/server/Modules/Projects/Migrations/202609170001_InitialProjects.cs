using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace RoomCraft.Modules.Projects.Migrations;

[DbContext(typeof(ProjectsDbContext))]
[Migration("202609170001_InitialProjects")]
public sealed class InitialProjects : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "projects",
            columns: table => new
            {
                Id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                CurrentRevision = table.Column<long>(type: "bigint", nullable: false),
                CreatedUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_projects", item => item.Id));

        migrationBuilder.CreateTable(
            name: "project_revisions",
            columns: table => new
            {
                ProjectId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                Revision = table.Column<long>(type: "bigint", nullable: false),
                DocumentJson = table.Column<string>(type: "jsonb", nullable: false),
                CreatedUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_project_revisions", item => new { item.ProjectId, item.Revision });
                table.ForeignKey(
                    name: "FK_project_revisions_projects_ProjectId",
                    column: item => item.ProjectId,
                    principalTable: "projects",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_projects_UpdatedUtc",
            table: "projects",
            column: "UpdatedUtc");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "project_revisions");
        migrationBuilder.DropTable(name: "projects");
    }
}
