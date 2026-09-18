import { describe, expect, it } from "vitest";
import { formatLengthInput, parseLengthInput } from "../src/length";

describe("length input", () => {
  it.each([
    ["4520", 4520],
    ["4520 mm", 4520],
    ["452 cm", 4520],
    ["4.52 m", 4520],
    ["4,52 m", 4520],
    ["0.9m", 900],
  ])("parses %s as %d mm", (input, expected) => {
    expect(parseLengthInput(input)).toBe(expected);
  });

  it("rejects invalid text", () => {
    expect(parseLengthInput("four metres")).toBeNull();
  });

  it("formats the canonical value as millimetres", () => {
    expect(formatLengthInput(4520)).toBe("4520 mm");
  });
});
