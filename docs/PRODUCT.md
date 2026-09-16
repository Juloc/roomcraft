# RoomCraft Product

## Product promise

Plan a real apartment or house accurately without CAD knowledge.

RoomCraft combines a simple room-planner workflow with exact dimensions, real purchasable furniture, custom furniture, interoperable 3D export and later Home Assistant integration.

## Interaction model

The primary workflow follows proven room-planner conventions:

1. Create a project.
2. Add a level.
3. Draw walls directly or trace a scaled blueprint.
4. Enter exact dimensions.
5. Add doors/windows/openings.
6. Let RoomCraft detect rooms.
7. Apply floor, wall and ceiling finishes.
8. Drag furniture/products into the plan.
9. Resize configurable objects exactly.
10. Switch between 2D and 3D without changing project state.
11. Save variants and compare layouts.
12. Export/share the result.

The application must remain usable for a person who has never used Blender or CAD.

## Baseline capabilities learned from established planners

RoomCraft should cover the useful common denominator of HomeByMe, Floorplanner, Roomtodo, Planner 5D and Sweet Home 3D while keeping its own UI and implementation.

### Building editor

- 2D wall drawing
- exact numeric lengths
- wall thickness and height
- angled walls
- connected-wall snapping
- grid and alignment snapping
- automatic and custom dimensions
- blueprint/image import with scale calibration from a known distance
- doors, windows and passages anchored into walls
- door swing/orientation
- room detection from closed wall topology
- floor/ceiling/wall materials
- multiple levels with elevation, storey height and floor thickness
- stairs later
- columns/beams/free structural shapes later

### Navigation/editing

- pan and zoom
- select/multi-select
- move/rotate/resize where semantically valid
- keyboard nudging
- undo/redo
- copy/paste/duplicate
- lock objects/structural elements
- visibility controls
- snapping modifier to temporarily disable snapping
- contextual property inspector
- desktop mouse/keyboard first, touch-capable interaction from the start

### 3D

- instant 2D/3D switch using the same project model
- orbit/top view
- walk/first-person view
- shadows and configurable quality
- materials and lighting
- optional ceiling visibility/cutaway for editing
- selected object synchronized with 2D selection

### Furniture/catalog

- generic furniture categories
- manufacturer/product catalog
- exact manufacturer dimensions
- product URL, SKU and optional price metadata
- search/filter/favorites
- drag/drop placement
- configurable dimensions when allowed by the asset
- material/color variants
- user-uploaded GLB/glTF assets
- private custom catalog
- thumbnails generated from normalized model assets

### Parametric DIY furniture

Users should be able to build practical furniture without 3D modeling.

Initial builder:

- cabinet/carcass
- side panels
- top/bottom
- shelves
- doors
- drawer fronts
- legs/plinth
- worktop
- configurable material/thickness/dimensions

Later derived outputs:

- cut list
- material quantities
- hardware list
- estimated cost

### Design variants

A project may have multiple layout variants based on the same building shell.

Example:

- `Current`
- `Dining room option A`
- `Dining room option B`

Building geometry may be copied into a variant, while later architecture may allow explicit shared shell layers if that solves a real use case cleanly.

Do not implement hidden cross-variant mutation as a shortcut.

### Import/export

First-class:

- RoomCraft native project format
- GLB export
- SVG 2D export
- PNG/JPEG views

Later:

- PDF floorplan
- DXF
- additional 3D adapters
- Home Assistant package/export

The native RoomCraft format must remain documented/versioned enough to avoid vendor lock-in.

## Home Assistant direction

A RoomCraft object can optionally be linked to Home Assistant metadata later.

Examples:

- light fixture -> `light.*`
- window -> `binary_sensor.*`
- door -> `binary_sensor.*`
- thermostat/radiator -> climate entity
- temperature/humidity sensor

This mapping must not affect basic editing. It is an integration layer over stable RoomCraft object IDs.

Potential export:

```text
roomcraft-home-assistant/
├─ apartment.glb
└─ entities.json
```

## Purchase planning

Catalog objects can carry commercial metadata without making RoomCraft dependent on a retailer.

Potential project outputs:

- products currently placed
- quantity
- retailer/manufacturer
- SKU
- product link
- planned price
- total planned furniture cost

Price is time-sensitive metadata and should be clearly separated from stable model geometry/dimensions.

## V1 / first usable release

V1 is intentionally narrower than the final product.

Required:

- projects
- one or more levels
- wall drawing
- exact dimensions
- snapping
- doors/windows
- automatic room detection
- materials/basic colors
- furniture catalog with generic primitives
- furniture transform and exact size
- 2D editor
- live 3D view
- save/load/autosave
- undo/redo
- blueprint image import and calibration
- GLB import for user furniture
- GLB project export
- responsive application shell
- light/dark theme

Not required for initial V1:

- photorealistic cloud rendering
- AI room generation
- collaboration
- marketplace
- billing
- retailer scraping
- DXF
- Home Assistant live control
- Unreal-specific exporter
- full cabinet manufacturing CAD

## V1 acceptance scenario

A user can take measurements of an apartment and reproduce it accurately:

1. Upload or skip a blueprint.
2. Draw all walls.
3. Correct each important dimension numerically.
4. Place doors/windows at measured offsets.
5. Verify generated room areas.
6. Place furniture with real dimensions.
7. create a custom cabinet using numeric dimensions.
8. walk through the result in 3D.
9. close and reopen the browser and get the same project.
10. export the project to GLB.

If this workflow feels simple and reliable, V1 succeeds.

## UX principles

- The canvas is the main product; chrome stays compact.
- Common actions are direct manipulation, not modal wizards.
- Exact values remain available in the property inspector.
- Show dimensions near the object being edited.
- Never make users understand scene graphs, meshes, UVs, normals or Blender concepts.
- Invalid geometry must be explained at the location of the problem.
- Autosave status must be visible but unobtrusive.
- 2D editing remains fully capable even on devices where high-quality 3D is slow.
- Advanced settings stay progressive; beginners see sensible defaults.

## Non-goals

RoomCraft is not intended to become:

- a Blender replacement
- a professional BIM authoring suite
- a structural engineering calculator
- a full mechanical CAD program
- an electrical-code verification product

It can interoperate with professional tools without exposing their complexity to ordinary planning workflows.
