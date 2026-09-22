# RoomCraft Roadmap

This roadmap is the execution order for RoomCraft. It complements `docs/PRODUCT.md` and `docs/ARCHITECTURE.md`.

The rule is simple: later phases may extend earlier abstractions, but they must not bypass or duplicate them.

## Status legend

- ✅ done and merged
- 🚧 in progress
- ⬜ planned
- ◻ later / post-V1

## V1 milestone

A V1 is reached when a user can reproduce a measured apartment, place furniture, reopen the project unchanged, inspect it in 3D and export it without needing CAD knowledge.

---

## Phase 0 — Foundation ✅

Goal: establish architectural invariants before product features accumulate.

Done:
- modular monolith repository structure
- canonical versioned `ProjectDocument`
- integer millimetres as canonical units
- shared `geometry`, `editor-core`, `render-2d`, `render-3d`, `ui` packages
- command-based document mutation
- undo/redo
- central design tokens and shared UI controls
- React/Vite application shell
- ASP.NET Core 10 host
- content-hashed production frontend assets
- CI with typecheck, unit tests, production build and .NET build

Definition of done:
- no renderer owns project state
- no UI feature mutates the document directly
- CI guards all merged work

---

## Phase 1 — Structural editor 🚧

Goal: accurately create the apartment shell.

### 1.1 Wall drawing ✅
- connected wall-chain drawing
- grid snapping
- existing-vertex snapping
- preview state
- Escape cancellation
- undo/redo

### 1.2 Doors and windows ✅
- semantic wall-anchored openings
- nearest-wall placement
- width/height/sill semantics
- overlap/fit validation
- 2D projection
- real 3D wall holes

### 1.3 Automatic room detection ✅
- derive closed planar faces from wall topology
- ignore the unbounded outside face
- deterministic room IDs/keys derived from geometry, not random runtime state
- room area calculation
- 2D room fill/label projection
- no duplicated persisted room polygon

Definition of done:
- drawing a closed wall loop immediately produces one room
- adjacent closed loops produce distinct rooms
- open wall chains do not produce rooms
- deleting/breaking a boundary removes the derived room
- room calculation is unit-tested independently of React/Three.js

### 1.4 Exact wall editing 🚧
- wall/segment selection
- visible dimension label
- edit exact length via shared `LengthField`
- `MoveVertex` command
- sensible behavior for connected walls
- angle display/edit where useful

### 1.5 Selection model 🚧
- stable selected RoomCraft IDs
- wall/opening/room/object selection
- shared 2D/3D selection
- hover separate from selection
- delete/duplicate via commands

### 1.6 Pan / zoom / viewport 🚧
- infinite-feeling 2D canvas
- wheel/trackpad zoom around pointer
- pan
- fit-to-plan
- persistent viewport preference separate from project document

Phase 1 exit criteria:
- a measured empty apartment shell can be recreated precisely, including openings and room areas

---

## Phase 2 — Project persistence ✅

Goal: project data survives browser/app restarts safely.

Done:
- PostgreSQL 18
- EF Core / Npgsql
- project metadata + immutable revisions
- JSONB canonical document revisions
- optimistic concurrency with revision token / `If-Match`
- debounced autosave
- Saved / Unsaved / Saving / Conflict / Error state
- real PostgreSQL CI smoke test
- create/load/save/conflict path verified

Next:
- ⬜ project list/start screen
- ⬜ create/rename/delete project
- ⬜ revision history restore UI
- ⬜ explicit duplicate-project action

---

## Phase 3 — Blueprint workflow ✅

Goal: let users trace an existing plan without CAD knowledge.

- image import through asset abstraction ✅
- PDF-page import ◻
- blueprint opacity ✅
- rotate ✅
- crop ✅
- calibration by drawing a line over a known distance ✅
- lock 🚧 blueprint layer ✅
- blueprint position / drag ✅
- hide/show ✅
- per-level blueprint ✅
- preserve source asset separately from editor geometry ✅
- schema v3 crop migration ✅
- layer ordering / deletion ✅

Definition of done:
- user can import a photographed/scanned plan, calibrate one known wall and trace accurate walls over it

---

## Phase 4 — Levels and building shell ✅

Goal: support real multi-storey homes/apartments.

- level create/rename/delete ✅
- level elevation ✅
- default storey height ✅
- floor thickness ✅
- duplicate shell to new level ✅
- show lower/upper level as optional ghost ✅
- 3D all-level view ✅
- stairs ◻ after basic multi-level behavior is stable

---

## Phase 5 — Materials and surfaces ⬜

Goal: make the shell visually useful without coupling materials to meshes.

- material definition/asset abstraction
- wall left/right surfaces
- room floor material
- ceiling material
- basic colors first
- texture scale/orientation
- synchronized 2D hints + 3D PBR rendering

Definition of done:
- changing a semantic surface material changes every relevant renderer/export without storing mesh-specific material state

---

## Phase 6 — Furniture and catalog 🚧

Goal: plan with real dimensions and reusable assets.

### 6.1 Generic primitives 🚧
- box/cabinet/table/sofa/bed primitives 🚧
- exact width/depth/height 🚧
- place/move/rotate 🚧
- object snapping
- duplicate
- lock

### 6.2 Catalog
- Catalog backend module
- categories/search
- manufacturer/SKU/product URL metadata
- immutable asset versions
- thumbnails
- favorites later if justified

### 6.3 GLB import
- Assets backend module
- upload validation
- bounds/unit/orientation/pivot normalization
- immutable processed model
- user private catalog item

Phase 6 exit criteria:
- a user can furnish a room with exact-size generic and imported furniture

---

## Phase 7 — Parametric DIY furniture ⬜

Goal: build practical custom furniture without Blender.

Initial semantic builder:
- carcass
- panels
- shelves
- doors
- drawer fronts
- plinth/legs
- worktop
- thickness/material parameters

Derived later:
- cut list
- material quantities
- hardware list
- estimated cost

Definition of done:
- a user can define a cabinet numerically and resize it later without editing meshes

---

## Phase 8 — Export ⬜

Goal: no vendor lock-in and useful external workflows.

V1:
- native RoomCraft document export/import
- SVG floorplan
- PNG/JPEG viewport
- GLB project export

Later:
- PDF vector floorplan
- DXF
- additional 3D adapters
- Unreal-specific workflow only if GLB is insufficient

Exporters consume the canonical document and shared geometry. They never scrape SVG/Three.js scene state.

---

## Phase 9 — 3D usability ⬜

Goal: make 3D useful for planning, not just a technical preview.

- synchronized selection
- top/orbit presets
- walk/first-person mode
- cutaway / hide ceiling
- quality tiers
- lights and shadows
- lazy asset loading
- partial geometry rebuilds

Photorealistic cloud rendering is not required for V1.

---

## Phase 10 — Home Assistant ◻

Goal: make the finished model useful as a smart-home visual layer.

- optional integration metadata on stable RoomCraft object IDs
- entity mapping UI
- GLB node `extras`
- sidecar `entities.json`
- export package first
- live Home Assistant control only later

Core geometry must remain fully usable with no Home Assistant connection.

---

## Cross-cutting work

These are continuous requirements, not separate cleanup phases.

### UI system
- all reusable controls in `packages/ui`
- `LengthField`, NumberField, IconButton, menus, inspector sections, dialogs
- one icon system
- light/dark tokens
- ~44 px coarse-pointer targets
- keyboard/focus accessibility

### Performance
- no permanent render loop unless animation requires it
- derived geometry caches only
- room/topology work moves to a Web Worker once measurements show main-thread pressure
- lazy-load 3D catalog assets
- spatial index when hit-testing scale requires it

### Quality
- geometry tests for every topology rule
- command undo/redo tests
- document migration fixtures
- PostgreSQL integration smoke tests
- Playwright central flow as soon as selection/exact dimensions are available

### Security and reliability
- validate uploaded assets
- size/type limits
- no arbitrary filesystem paths in documents
- no silent concurrency overwrite
- no secrets in repository configuration

---

## V1 critical path

```text
Foundation ✅
   ↓
Walls ✅
   ↓
Doors / Windows ✅
   ↓
Room Detection ✅
   ↓
Selection + Exact Dimensions
   ↓
Blueprint Calibration
   ↓
Levels
   ↓
Furniture + GLB Import
   ↓
Materials
   ↓
Parametric Cabinet
   ↓
GLB / SVG Export
   ↓
V1
```

Features outside this path should not delay the core planning workflow.

## V1 acceptance test

One automated end-to-end test should eventually protect this complete path:

```text
create project
→ import/calibrate blueprint
→ draw closed apartment shell
→ edit exact dimensions
→ place door + window
→ verify room area
→ place exact-size furniture
→ create custom cabinet
→ switch to 3D
→ autosave
→ reload
→ verify same geometry
→ export GLB
```

When this flow is simple, deterministic and reliable, RoomCraft V1 is ready.
