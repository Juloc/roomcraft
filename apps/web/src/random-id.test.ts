import { describe, expect, it } from "vitest";
import { createEntityId, createRandomUuid } from "./random-id";

describe("browser-safe random ids", () => {
  it("creates an RFC 4122 version 4 UUID using getRandomValues only", () => {
    const uuid = createRandomUuid((target) => {
      target.set(Array.from({ length: 16 }, (_, index) => index));
    });

    expect(uuid).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("creates prefixed entity ids", () => {
    expect(createEntityId("project")).toMatch(
      /^project_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
