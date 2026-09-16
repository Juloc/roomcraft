namespace RoomCraft.SharedKernel;

public readonly record struct EntityId(string Value)
{
    public override string ToString() => Value;

    public static EntityId New(string prefix) => new($"{prefix}_{Guid.NewGuid():N}");
}
