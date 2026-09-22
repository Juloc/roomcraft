import type { EntityId } from "@roomcraft/document";

export type SelectionKind = "wall" | "opening" | "room" | "object" | "blueprint";

export interface SelectionTarget {
  kind: SelectionKind;
  id: EntityId;
}

export interface EditorSelection {
  primary: SelectionTarget | null;
}

export const EMPTY_SELECTION: EditorSelection = Object.freeze({
  primary: null,
});

export function selectOnly(target: SelectionTarget | null): EditorSelection {
  return { primary: target };
}

export function isSelected(
  selection: EditorSelection,
  kind: SelectionKind,
  id: EntityId,
): boolean {
  return selection.primary?.kind === kind && selection.primary.id === id;
}
