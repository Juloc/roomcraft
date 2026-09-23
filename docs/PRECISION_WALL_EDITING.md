# Precision wall editing and automatic topology

Status: implementation for [#38](https://github.com/Juloc/roomcraft/issues/38).

## Problem

A wall editor is only useful when ordinary drawing produces valid shared topology. A visual crossing is not enough: if two semantic walls cross without sharing a vertex, room detection and downstream editing cannot reason about the junction safely.

RoomCraft therefore treats junction creation as an editor operation, not as renderer cleanup.

## Invariants

- Wall intersections are represented by shared semantic vertices.
- React never edits `vertices`, `walls` or `openings` arrays directly.
- One user insertion is one undoable editor command even if several existing walls are split.
- Rooms remain derived from the planar graph.
- Existing wall IDs survive on the first replacement segment where possible.
- Openings remain semantic wall children and are reassigned to the replacement segment that contains them.
- An insertion that would split through the physical span of an opening is rejected instead of corrupting the opening.
- Collinear overlap is rejected. The editor does not create duplicate wall geometry.
- Project coordinates remain integer millimetres.

## Topology-safe insertion

`InsertWallWithTopologyCommand` resolves the requested endpoints, calculates intersections against the current wall graph and produces one atomic replacement of level geometry.

For a proper crossing:

```
before              after

---- wall ----      ----+----
                        |
                        |
                        +
                        |
                        |
```

Both semantic walls are split at the same shared vertex.

For a T-junction, only the wall whose interior is hit is split. If the new endpoint already lands on an existing vertex, that vertex is reused.

The geometry package owns straight-segment intersection classification. It distinguishes:
- no intersection
- one point intersection
- collinear overlap

## Openings

When an existing wall is split, each opening is mapped by its distance from the original start vertex onto the correct replacement segment. The local offset is recomputed.

If a proposed junction falls inside an opening width, insertion fails with a useful editor error. Silently splitting a door/window across multiple walls is not allowed.

## Precision editing

Selected walls expose:
- fixed endpoint: start or end
- exact length
- exact angle
- thickness
- direct endpoint handles

Length and angle changes move only the non-fixed vertex. Any other walls connected to that vertex follow through the existing shared vertex model.

Direct endpoint dragging commits one `MoveVertexCommand` on pointer release so a drag remains one undoable edit instead of creating an undo entry for every pointer move.

## Deletion

Deleting a selected wall removes its anchored openings and any vertices that become orphaned. The command stores an inverse geometry snapshot so undo restores the exact prior semantic graph.

## Quality

Coverage includes:
- proper crossing split
- T-junction split
- opening reassignment
- rejection of junction-through-opening
- overlap rejection
- angle/thickness undo
- delete/undo
- browser-level crossing flow with `Topology = OK`

The critical browser suite also keeps right-click/Escape termination of wall drawing protected.
