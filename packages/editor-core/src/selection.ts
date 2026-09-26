import type { EntityId } from "@roomcraft/document";

export type SelectionKind = "wall" | "opening" | "room" | "object" | "blueprint";

export interface SelectionTarget {
  kind: SelectionKind;
  id: EntityId;
}

export interface EditorSelection {
  primary: SelectionTarget | null;
  items: readonly SelectionTarget[];
}

export const EMPTY_SELECTION: EditorSelection = Object.freeze({
  primary: null,
  items: Object.freeze([]) as readonly SelectionTarget[],
});

export function selectionTargetKey(target: SelectionTarget): string {
  return `${target.kind}:${target.id}`;
}

export function selectOnly(target: SelectionTarget | null): EditorSelection {
  return target ? { primary: target, items: [target] } : EMPTY_SELECTION;
}

export function toggleSelection(
  selection: EditorSelection,
  target: SelectionTarget,
): EditorSelection {
  const key = selectionTargetKey(target);
  const exists = selection.items.some(
    (candidate) => selectionTargetKey(candidate) === key,
  );

  if (!exists) {
    return {
      primary: target,
      items: [...selection.items, target],
    };
  }

  const items = selection.items.filter(
    (candidate) => selectionTargetKey(candidate) !== key,
  );
  const primary =
    selection.primary && selectionTargetKey(selection.primary) !== key
      ? selection.primary
      : items.at(-1) ?? null;

  return items.length === 0 ? EMPTY_SELECTION : { primary, items };
}

export function isSelected(
  selection: EditorSelection,
  kind: SelectionKind,
  id: EntityId,
): boolean {
  return selection.items.some(
    (target) => target.kind === kind && target.id === id,
  );
}

export function selectionIds(
  selection: EditorSelection,
  kind?: SelectionKind,
): readonly EntityId[] {
  return selection.items
    .filter((target) => kind === undefined || target.kind === kind)
    .map((target) => target.id);
}
