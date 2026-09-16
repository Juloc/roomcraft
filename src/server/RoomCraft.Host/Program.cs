var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    service = "roomcraft",
    utc = DateTimeOffset.UtcNow,
}));

app.MapGet("/", () => Results.Ok(new
{
    name = "RoomCraft API",
    frontend = "Run the Vite app from apps/web during development.",
}));

app.Run();
