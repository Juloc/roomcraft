# RoomCraft Architecture

## 1. Goal

RoomCraft is a browser-first home planner. Users draw accurate floor plans, furnish them, build simple custom furniture parametrically, switch instantly between 2D and 3D, and export interoperable files.

The architecture is intentionally a modular monolith: one deployable application, strongly separated modules, one PostgreSQL database, and shared storage. This keeps deployment simple while preventing a single-project spaghetti codebase.

## 2. Technology baseline

### Backend

- .NET 10 / ASP.NET Core
- PostgreSQL
- EF Core + Npgsql
- OpenAPI for HTTP contracts
- Background-job abstraction for imports/exports; no external queue until workload requires one
- Blob-store abstraction with local filesystem implementation first and S3-compatible implementation later

### Frontend

- TypeScript
- React for application UI/composition
- Vite for development/build/code splitting
- Three.js for 3D
- Canvas/SVG-based 2D renderer behind a renderer boundary
- Web Workers for CPU-heavy operations that would otherwise block interaction
- Vitest for unit tests
- Playwright for critical editor flows

Raw Three.js is kept behind `render-3d`; React components must not become the 3D scene model. This keeps rendering replaceable and prevents UI state from becoming project state.

## 3. Repository layout

```text
roomcraft/
├─ AGENTS.md
├─ RoomCraft.slnx
├─ apps/
│  └─ web/
├─ packages/
│  ├─ document/
│  ├─ geometry/
│  ├─ editor-core/
│  ├─ render-2d/
│  ├─ render-3d/
│  ├─ export/
│  └─ ui/
├─ src/
│  └─ server/
│     ├─ RoomCraft.Host/
│     ├─ RoomCraft.SharedKernel/
│     └─ Modules/
│        ├─ Projects/
│        ├─ Catalog/
│        ├─ Assets/
│        ├─ Exports/
│        └─ Identity/
├─ tests/
│  ├─ frontend/
│  ├─ backend/
│  └─ e2e/
└─ docs/
```

Do not introduce extra projects/packages merely to create layers. A package or backend module must own a real stable responsibility.

## 4. Dependency direction

```text
React UI / feature screens
          │
          ▼
      editor-core
       │      │
       ▼      ▼
   document  geometry
       ▲      ▲
       │      │
 ┌─────┴──────┴─────┐
 │                  │
render-2d       render-3d
 │                  │
 └──────── export ──┘
```

Rules:

- `document` does not import renderers or React.
- `geometry` is pure and does not know about UI, HTTP, PostgreSQL or Three.js.
- `editor-core` may use `document` and `geometry`; it must not depend on React or Three.js.
- renderers read document/editor projections but do not mutate them.
- UI invokes editor commands; it does not mutate the document directly.
- exports consume the canonical document and shared geometry, never screenshots of the editor.

## 5. Canonical project document

A RoomCraft project is not a Three.js scene and not a set of SVG elements. It is a semantic building document.

Canonical lengths are signed integer millimetres.

```text
ProjectDocument
├─ schemaVersion
├─ settings
├─ levels[]
│  ├─ id
│  ├─ elevationMm
│  ├─ defaultWallHeightMm
│  ├─ vertices[]
│  ├─ walls[]
│  ├─ openings[]
│  ├─ objects[]
│  ├─ annotations[]
│  └─ surfaceOverrides[]
└─ integrations
```

### Vertices

Vertices own 2D plan coordinates. Walls reference vertex IDs instead of duplicating endpoint coordinates.

```text
Vertex
- id
- xMm
- yMm
```

### Walls

```text
Wall
- id
- startVertexId
- endVertexId
- thicknessMm
- heightMm | null (uses level default)
- leftSurface
- rightSurface
```

This makes connected walls share topology and avoids tiny cracks caused by two independently edited endpoints.

### Openings

Doors/windows are anchored to a wall, not free-floating fake meshes.

```text
Opening
- id
- wallId
- type: door | window | passage
- offsetMm
- widthMm
- heightMm
- sillHeightMm
- flip
- swing
- catalogAssetId?
```

A renderer derives the wall hole from this semantic opening.

### Rooms

Room boundaries should normally be derived from closed wall topology. Persist only semantic room metadata that cannot be derived, such as name, type, floor material and user overrides. Never persist a second manually copied wall polygon as the authoritative room boundary.

### Object instances

```text
ObjectInstance
- id
- assetId
- xMm
- yMm
- zMm
- rotationDeg
- widthMm
- depthMm
- heightMm
- materialOverrides
- locked
- metadata
```

Catalog assets and instances are different concepts. Editing an instance must not mutate the catalog definition.

## 6. Document versioning

Every document has `schemaVersion`.

Migrations are deterministic functions:

```text
v1 -> v2 -> v3 -> ... -> current
```

Requirements:

- fixtures for every released version
- migration tests
- never mutate historical migration behavior after release
- export may include the original RoomCraft document version and application version
- opening an unsupported future document must fail clearly instead of guessing

## 7. Editor command model

All semantic changes go through commands.

Examples:

- `AddWall`
- `MoveVertex`
- `SplitWall`
- `DeleteWall`
- `AddOpening`
- `MoveOpening`
- `PlaceObject`
- `TransformObject`
- `SetSurfaceMaterial`

A command returns the next document state plus enough inverse information for undo.

Benefits:

- one mutation path for mouse, keyboard and touch
- predictable undo/redo
- simpler tests
- future collaboration can reuse semantic operations
- UI cannot accidentally create invalid partial state

Interactive dragging may maintain temporary preview state, but only commits a command when the operation completes.

## 8. Snapping

Snapping is a service in `editor-core` using primitives from `geometry`.

Candidate sources:

- grid
- existing vertices
- wall projections
- wall midpoint
- object edges/centres
- configurable angle increments
- alignment guides

Snap ranking and tolerance are centralized. Tools do not implement their own snapping.

Holding the configured modifier may temporarily disable snapping, similar to established floor-planner behavior.

## 9. Selection and transforms

Selection uses stable RoomCraft IDs.

One selection model powers both 2D and 3D. A selected wall/object must remain selected when switching views.

Transform rules are semantic:

- wall endpoint move -> `MoveVertex`
- object move -> `TransformObject`
- door drag -> `MoveOpening`

Do not write Three.js transform matrices back into the project model as the source of truth.

## 10. 2D renderer

Responsibilities:

- grid/rulers
- semantic plan shapes
- wall thickness
- openings and door swings
- dimensions
- selection/hover visuals
- snap guides
- labels
- print/vector projection

The renderer receives a viewport/camera transform and immutable projection data.

For large scenes, spatial indexing/hit testing belongs in renderer/editor infrastructure rather than scanning every object for every pointer event.

## 11. 3D renderer

Three.js converts canonical millimetres to metres at the adapter boundary.

Responsibilities:

- derived wall/floor/ceiling meshes
- opening geometry
- catalog GLB assets
- PBR materials
- camera/orbit/walk navigation
- lights/shadows by quality tier
- selection highlight
- resource lifecycle/disposal

Generated meshes are caches. If a wall changes, rebuild only affected geometry where practical.

Never persist generated BufferGeometry as project truth.

## 12. 3D asset pipeline

Canonical interchange: glTF 2.0 / GLB.

Upload pipeline:

```text
upload
  -> validate type/size
  -> parse safely
  -> inspect bounds/materials/textures
  -> normalize units/orientation/pivot
  -> generate preview metadata
  -> optional mesh/texture optimization
  -> store immutable processed asset
  -> create catalog asset version
```

Asset versions are immutable. Replacing a model creates a new version so existing projects do not silently change.

Future optimization may use meshopt/Draco and KTX2 where beneficial.

## 13. Parametric furniture

Custom furniture is semantic, not manually sculpted geometry.

Initial primitives:

- box/carcass
- shelf
- panel
- door
- drawer front
- worktop
- plinth/legs

A furniture definition contains dimensions, constraints and material slots. Geometry is generated from it.

This enables later features such as:

- exact resizing
- bill of materials
- cut list
- hardware list
- cost calculation

Do not bake parametric furniture permanently into a mesh until export.

## 14. Backend modular monolith

### Projects

Owns project metadata, revisions, sharing/permissions and save/load.

### Catalog

Owns product/manufacturer/catalog metadata, categories, dimensions and catalog asset versions.

### Assets

Owns binary upload/storage/processing metadata.

### Exports

Owns export requests and generated artifacts.

### Identity

Owns users/authentication/authorization.

### Integrations (future)

Home Assistant and retailer connectors live outside core modules and consume stable contracts.

Modules may publish in-process domain/integration events. They may not access another module's EF DbSets directly.

## 15. PostgreSQL model

Relational tables are used for queryable business metadata:

- projects
- project_members
- project_revisions
- catalog_products
- catalog_asset_versions
- assets
- export_jobs

The editor document can be stored as validated JSONB per revision because it is naturally a versioned document and its internal geometry is primarily loaded/saved as a unit.

JSONB is not a license to store arbitrary unversioned structures. The schema remains fixed and migrated.

Indexes are added from real access patterns, for example owner/project listing, asset hash lookup, product/manufacturer identifiers, and revision lookup.

## 16. Saves and concurrency

Each project has a monotonic revision/concurrency token.

Client save:

```text
PUT project document
If-Match: revision 42
```

If revision 42 is no longer current, return a conflict. Never last-write-wins silently.

Autosave is debounced and status is explicit: Saved / Saving / Unsaved / Conflict.

Undo/redo remains local editor history and is not coupled to database revision numbers.

## 17. Static assets and deployment

Frontend production build uses Vite code splitting and content-hashed asset filenames.

ASP.NET Core serves application assets with the .NET 10 static-asset pipeline where applicable. `MapStaticAssets` provides build-time fingerprinting, ETags, compression and immutable caching for mapped assets.

Caching policy:

- HTML/application bootstrap: revalidate/no immutable cache
- hashed JS/CSS/fonts/images: long-lived immutable cache
- user/catalog assets: immutable by versioned asset URL
- mutable API JSON: explicit API caching rules, normally no shared cache

Never invent manual cache-busting query parameters.

## 18. Performance boundaries

Main thread is reserved for responsive interaction.

Candidates for Web Workers:

- complex room/topology recomputation
- heavy import validation/conversion
- export preparation
- expensive geometry analysis

Use transferable ArrayBuffers for large binary data when useful.

3D assets must be lazy-loaded. The catalog displays thumbnails/metadata, not hundreds of live 3D models.

Only visible/needed levels and objects should incur expensive render work.

## 19. Home Assistant export

Every exportable object has a stable RoomCraft ID. GLB nodes can carry RoomCraft IDs in `extras` while a sidecar mapping carries integration metadata.

Example conceptual mapping:

```json
{
  "roomcraftObjectId": "obj_...",
  "entityId": "light.living_room_ceiling"
}
```

Home Assistant entity IDs are optional integration metadata. Core geometry must never depend on them.

## 20. Unreal / external interoperability

GLB is the first portable 3D export. Additional formats are adapters over the same canonical document; they are not separate editors or models.

2D exports should be generated semantically:

- SVG first
- PDF from vector representation
- DXF later through a dedicated adapter

## 21. Design system

`packages/ui` owns:

- design tokens
- typography
- icon abstraction
- Button/IconButton
- TextField/NumberField/LengthField
- Select/Combobox
- Checkbox/Switch
- Toolbar
- Menu/ContextMenu
- Dialog/Sheet
- Tooltip
- Tabs/SegmentedControl
- PropertyPanel/PropertySection
- CatalogCard
- Empty/Error/Loading states

Feature packages compose these; they do not reimplement them.

Editor canvas visuals such as selection handles and snap guides are editor primitives, not generic UI components.

## 22. Quality and automated enforcement

CI must run:

1. frontend formatting/linting
2. TypeScript typecheck
3. frontend unit tests
4. .NET format/build/tests
5. architecture/dependency tests
6. production frontend build
7. integration tests as they are added
8. Playwright smoke flow

Recommended smoke flow:

```text
create project
-> draw connected walls
-> set an exact dimension
-> place a door
-> place furniture
-> switch to 3D
-> save
-> reload
-> verify same geometry
```

This single test protects the central product invariant: one canonical model across editing, rendering and persistence.
