using RoomCraft.Modules.Projects;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProjectsModule(builder.Configuration);

var app = builder.Build();

if (app.Configuration.GetValue("Database:ApplyMigrationsOnStartup", true))
{
    await app.Services.ApplyProjectsMigrationsAsync();
}

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    service = "roomcraft",
    utc = DateTimeOffset.UtcNow,
}));

app.MapProjectsEndpoints();

app.MapGet("/", () => Results.Ok(new
{
    name = "RoomCraft API",
    frontend = "Run the Vite app from apps/web during development.",
}));

app.Run();
