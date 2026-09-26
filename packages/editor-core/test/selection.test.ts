import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  isSelected,
  selectOnly,
  selectionIds,
  toggleSelection,
} from "../src/selection";

describe("editor selection", () => {
  it("selects one semantic target", () => {
    const selection = selectOnly({ kind: "wall", id: "wall_1" });
    expect(selection.primary).toEqual({ kind: "wall", id: "wall_1" });
    expect(selection.items).toEqual([{ kind: "wall", id: "wall_1" }]);
    expect(isSelected(selection, "wall", "wall_1")).toBe(true);
  });

  it("adds and removes targets while keeping a stable primary", () => {
    let selection = selectOnly({ kind: "wall", id: "wall_1" });
    selection = toggleSelection(selection, { kind: "object", id: "object_1" });

    expect(selection.items).toEqual([
      { kind: "wall", id: "wall_1" },
      { kind: "object", id: "object_1" },
    ]);
    expect(selection.primary).toEqual({ kind: "object", id: "object_1" });

    selection = toggleSelection(selection, { kind: "wall", id: "wall_1" });
    expect(selection.items).toEqual([{ kind: "object", id: "object_1" }]);
    expect(selection.primary).toEqual({ kind: "object", id: "object_1" });

    selection = toggleSelection(selection, { kind: "object", id: "object_1" });
    expect(selection).toBe(EMPTY_SELECTION);
  });

  it("returns ids filtered by semantic kind", () => {
    let selection = selectOnly({ kind: "wall", id: "wall_1" });
    selection = toggleSelection(selection, { kind: "wall", id: "wall_2" });
    selection = toggleSelection(selection, { kind: "object", id: "object_1" });

    expect(selectionIds(selection, "wall")).toEqual(["wall_1", "wall_2"]);
    expect(selectionIds(selection)).toEqual(["wall_1", "wall_2", "object_1"]);
  });
});
