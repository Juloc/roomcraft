using RoomCraft.Modules.Assets;
using RoomCraft.Modules.Catalog;
using RoomCraft.Modules.Projects;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProjectsModule(builder.Configuration);
builder.Services.AddAssetsModule(builder.Configuration);
builder.Services.AddCatalogModule(builder.Configuration);

var app = builder.Build();

if (app.Configuration.GetValue("Database:ApplyMigrationsOnStartup", true))
{
    await app.Services.ApplyProjectsMigrationsAsync();
    await app.Services.ApplyAssetsMigrationsAsync();
    await app.Services.ApplyCatalogMigrationsAsync();
}

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    service = "roomcraft",
    utc = DateTimeOffset.UtcNow,
}));

app.MapProjectsEndpoints();
app.MapAssetsEndpoints();
app.MapCatalogEndpoints();

app.MapGet("/", () => Results.Ok(new
{
    name = "RoomCraft API",
    frontend = "Run the Vite app from apps/web during development.",
}));

app.Run();
