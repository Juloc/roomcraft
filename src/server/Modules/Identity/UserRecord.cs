namespace RoomCraft.Modules.Identity;

internal sealed class UserRecord
{
    public required string Id { get; set; }
    public required string Username { get; set; }
    public required string NormalizedUsername { get; set; }
    public required string PasswordHash { get; set; }
    public bool IsAdmin { get; set; }
    public DateTimeOffset CreatedUtc { get; set; }
}
