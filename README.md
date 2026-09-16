# RoomCraft

RoomCraft is a browser-based 2D/3D home and furniture planner designed for accurate real-world planning without CAD or Blender knowledge.

## Direction

- Draw an apartment/house with exact dimensions.
- Switch instantly between synchronized 2D and 3D views.
- Place generic or real products with exact dimensions.
- Build simple custom furniture parametrically.
- Import/export interoperable GLB models.
- Keep the project format versioned and portable.
- Add Home Assistant integration later without coupling automation data to the core planner.

## Architecture

RoomCraft uses one canonical semantic project document. 2D, 3D, export and integrations are derived views of that same document.

The application is a modular monolith:

- ASP.NET Core 10 backend
- PostgreSQL
- React + TypeScript frontend
- Vite build pipeline
- Three.js 3D renderer
- shared document/geometry/editor packages

See:

- [`AGENTS.md`](AGENTS.md) — mandatory engineering rules
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — target architecture and data model
- [`docs/PRODUCT.md`](docs/PRODUCT.md) — product scope and V1 definition

## Core invariant

> Persist semantic planning data, never renderer state.

A wall is stored as connected vertices, thickness and height. A door/window is stored as an opening anchored to a wall. Furniture is stored as a catalog/custom asset reference plus semantic dimensions and transform. Three.js meshes, Canvas/SVG shapes and export files are derived outputs.

## Status

Initial architecture/design phase. Implementation has not started yet.
