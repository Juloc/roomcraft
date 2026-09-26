# Shared selection and direct manipulation

Status: implementation for [#40](https://github.com/Juloc/roomcraft/issues/40).

## Invariants

Selection is editor state, not project data. It is never persisted in `ProjectDocument`.

Every selected item is identified by a semantic RoomCraft pair:

```
{ kind, id }
```

SVG nodes and Three.js objects are hit-test adapters only. They never become selection identity.

## Selection model

`EditorSelection` contains:

- an ordered set of selected semantic targets
- one primary target, always the most recently selected surviving item

Normal click replaces the selection. Shift/Ctrl/Cmd-click toggles one target in the set. The primary target drives the detailed inspector while every selected target receives selection styling.

Hover is a separate transient target. Hover never mutates selection.

## 2D

The 2D renderer consumes semantic selection state and emits semantic targets for walls, rooms, furniture and blueprints.

- selected entities use the accent treatment
- hover uses a lighter transient treatment
- dragging a wall body moves both wall endpoints together
- dragging an endpoint still edits the individual shared vertex
- Shift/Ctrl/Cmd-click changes selection without beginning a drag
- blank-canvas click clears selection unless an additive modifier is held

A whole-wall drag previews in React state, then commits one `MoveWallCommand` on pointer release.

## 3D

`RoomSceneRenderer` raycasts the generated scene, walks from the hit child to the nearest semantic ancestor and returns only:

```
{ kind: "wall" | "object" | "room", id }
```

The renderer receives selected IDs from editor-core state. Selection is therefore preserved across 2D/3D switching instead of being recreated from Three.js references.

3D uses:
- a primary selection bounds helper
- secondary selection bounds helpers
- a distinct hover bounds helper

Orbit dragging is not treated as selection; a click is only emitted when pointer displacement stays below the click threshold.

## Commands

`MoveWallCommand` translates both semantic endpoint vertices atomically. Connected walls continue to reference those same vertices, so topology stays connected.

`BatchCommand` composes independent editor commands into one undo entry. Multi-delete and multi-duplicate use this rather than mutating arrays from React.

Supported duplication in this slice:
- furniture objects
- blueprint layers

Duplicates receive new RoomCraft IDs, are offset by a deterministic grid-based amount and become the new multi-selection.

Supported multi-delete:
- walls
- furniture objects
- blueprints

Room selection is non-destructive.

## Keyboard

When focus is inside the editor canvas rather than a text field:

- `Delete` / `Backspace`: delete supported selected items
- `Ctrl+D` / `Cmd+D`: duplicate supported selected items

Text inputs, selects and content-editable controls are excluded from editor shortcuts.

## Validation

Coverage includes:
- ordered multi-selection semantics
- atomic batch undo/redo
- whole-wall translation and shared-junction behavior
- semantic 3D hit resolution
- browser multi-select + duplicate/delete
- browser whole-wall drag + undo
- browser 3D raycast selection preserved when returning to 2D
