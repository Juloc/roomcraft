using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace RoomCraft.Modules.Identity;

public static partial class IdentityModule
{
    public const string AuthenticationScheme = "RoomCraft";

    public static IServiceCollection AddIdentityModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("RoomCraft");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("ConnectionStrings:RoomCraft is required.");
        }

        services.AddDbContext<IdentityDbContext>(options =>
            options.UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable("__identity_migrations_history")));

        services.AddScoped<IPasswordHasher<UserRecord>, PasswordHasher<UserRecord>>();
        services
            .AddAuthentication(AuthenticationScheme)
            .AddCookie(AuthenticationScheme, options =>
            {
                options.Cookie.Name = "roomcraft.auth";
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Strict;
                options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                options.ExpireTimeSpan = TimeSpan.FromDays(30);
                options.SlidingExpiration = true;
                options.Events = new CookieAuthenticationEvents
                {
                    OnRedirectToLogin = context =>
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        return Task.CompletedTask;
                    },
                    OnRedirectToAccessDenied = context =>
                    {
                        context.Response.StatusCode = StatusCodes.Status403Forbidden;
                        return Task.CompletedTask;
                    },
                };
            });
        services.AddAuthorization();
        return services;
    }

    public static async Task ApplyIdentityMigrationsAsync(
        this IServiceProvider services,
        CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        await db.Database.MigrateAsync(cancellationToken);
    }

    public static IEndpointRouteBuilder MapIdentityEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/auth");

        group.MapGet("/session", GetSessionAsync);
        group.MapPost("/setup", SetupAsync);
        group.MapPost("/login", LoginAsync);
        group.MapPost("/logout", (Delegate)LogoutAsync);

        return endpoints;
    }

    private static async Task<IResult> GetSessionAsync(
        ClaimsPrincipal principal,
        IdentityDbContext db,
        CancellationToken cancellationToken)
    {
        var setupRequired = !await db.Users.AsNoTracking().AnyAsync(cancellationToken);
        return Results.Ok(new AuthSessionResponse(
            SetupRequired: setupRequired,
            Authenticated: principal.Identity?.IsAuthenticated == true,
            User: CurrentUser(principal)));
    }

    private static async Task<IResult> SetupAsync(
        CredentialRequest request,
        HttpContext context,
        IdentityDbContext db,
        IPasswordHasher<UserRecord> passwordHasher,
        CancellationToken cancellationToken)
    {
        if (await db.Users.AnyAsync(cancellationToken))
        {
            return Results.Conflict(new { error = "Initial setup has already been completed." });
        }

        if (!TryValidateCredentials(request, out var username, out var normalized, out var error))
        {
            return Results.BadRequest(new { error });
        }

        var user = new UserRecord
        {
            Id = Guid.NewGuid().ToString("N"),
            Username = username,
            NormalizedUsername = normalized,
            PasswordHash = string.Empty,
            IsAdmin = true,
            CreatedUtc = DateTimeOffset.UtcNow,
        };
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            return Results.Conflict(new { error = "Initial setup was completed by another request." });
        }

        await SignInAsync(context, user);
        return Results.Ok(new AuthSessionResponse(false, true, ToUser(user)));
    }

    private static async Task<IResult> LoginAsync(
        CredentialRequest request,
        HttpContext context,
        IdentityDbContext db,
        IPasswordHasher<UserRecord> passwordHasher,
        CancellationToken cancellationToken)
    {
        if (!TryNormalizeUsername(request.Username, out var normalized))
        {
            return Results.BadRequest(new { error = "Username is invalid." });
        }

        var user = await db.Users.SingleOrDefaultAsync(
            item => item.NormalizedUsername == normalized,
            cancellationToken);
        if (user is null)
        {
            return Results.Unauthorized();
        }

        var result = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (result == PasswordVerificationResult.Failed)
        {
            return Results.Unauthorized();
        }

        if (result == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
            await db.SaveChangesAsync(cancellationToken);
        }

        await SignInAsync(context, user);
        return Results.Ok(new AuthSessionResponse(false, true, ToUser(user)));
    }

    private static async Task<IResult> LogoutAsync(HttpContext context)
    {
        await context.SignOutAsync(AuthenticationScheme);
        return Results.NoContent();
    }

    private static async Task SignInAsync(HttpContext context, UserRecord user)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id),
            new(ClaimTypes.Name, user.Username),
        };
        if (user.IsAdmin) claims.Add(new Claim(ClaimTypes.Role, "Admin"));

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, AuthenticationScheme));
        await context.SignInAsync(
            AuthenticationScheme,
            principal,
            new AuthenticationProperties
            {
                IsPersistent = true,
                AllowRefresh = true,
                ExpiresUtc = DateTimeOffset.UtcNow.AddDays(30),
            });
    }

    private static AuthUserResponse? CurrentUser(ClaimsPrincipal principal)
    {
        if (principal.Identity?.IsAuthenticated != true) return null;
        var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var username = principal.Identity.Name;
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(username)) return null;
        return new AuthUserResponse(id, username, principal.IsInRole("Admin"));
    }

    private static AuthUserResponse ToUser(UserRecord user) =>
        new(user.Id, user.Username, user.IsAdmin);

    private static bool TryValidateCredentials(
        CredentialRequest request,
        out string username,
        out string normalized,
        out string error)
    {
        username = request.Username.Trim();
        normalized = string.Empty;
        error = string.Empty;

        if (!TryNormalizeUsername(username, out normalized))
        {
            error = "Username must be 3-64 characters and contain only letters, numbers, dot, dash or underscore.";
            return false;
        }

        if (request.Password.Length is < 10 or > 256)
        {
            error = "Password must be between 10 and 256 characters.";
            return false;
        }

        return true;
    }

    private static bool TryNormalizeUsername(string username, out string normalized)
    {
        var value = username.Trim();
        normalized = value.ToUpperInvariant();
        return value.Length is >= 3 and <= 64 && UsernamePattern().IsMatch(value);
    }

    [GeneratedRegex("^[A-Za-z0-9._-]+$", RegexOptions.CultureInvariant)]
    private static partial Regex UsernamePattern();
}

public sealed record CredentialRequest(string Username, string Password);
public sealed record AuthUserResponse(string Id, string Username, bool IsAdmin);
public sealed record AuthSessionResponse(bool SetupRequired, bool Authenticated, AuthUserResponse? User);
