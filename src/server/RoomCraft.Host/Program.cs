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

var webRoot = app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
var indexPath = Path.Combine(webRoot, "index.html");

if (File.Exists(indexPath))
{
    app.MapStaticAssets();
    app.MapFallback(async context =>
    {
        context.Response.Headers.CacheControl = "no-cache";
        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(indexPath);
    });
}
else
{
    app.MapGet("/", () => Results.Ok(new
    {
        name = "RoomCraft API",
        frontend = "Run the Vite app from apps/web during development.",
    }));
}

app.Run();
