import { describe, expect, it } from "vitest";
import { formatNumberInput, parseNumberInput } from "../src/number";

describe("number input", () => {
  it.each([
    ["12", 12],
    ["-250", -250],
    ["45.5", 45.5],
    ["45,5", 45.5],
  ])("parses %s", (input, expected) => {
    expect(parseNumberInput(input)).toBe(expected);
  });

  it("rejects invalid values", () => {
    expect(parseNumberInput("abc")).toBeNull();
    expect(parseNumberInput("")).toBeNull();
  });

  it("formats without grouping separators", () => {
    expect(formatNumberInput(1234.5678, 2)).toBe("1234.57");
  });
});
