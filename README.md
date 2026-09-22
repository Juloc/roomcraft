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

## Development

Requirements:

- .NET 10 SDK
- Node.js 22.12 or newer

Install and run the browser editor:

```bash
npm install
npm run dev
```

Run frontend quality gates:

```bash
npm run typecheck
npm test
npm run build
```

Build the backend:

```bash
dotnet build RoomCraft.slnx
```

## Container deployment

The release image is a single deployable container. It contains the ASP.NET Core host, the built web frontend and an internal PostgreSQL 18 server. PostgreSQL only listens on the container loopback interface.

Persist `/data`. It contains both the PostgreSQL data directory and uploaded RoomCraft assets.

```yaml
services:
  roomcraft:
    image: ghcr.io/juloc/roomcraft:0.1.0-alpha.1
    volumes:
      - roomcraft_data:/data
    ports:
      - "8102:8080"
    networks:
      - proxy

volumes:
  roomcraft_data:

networks:
  proxy:
    external: true
```

## Current implementation

The initial vertical slice contains:

- versioned V1 project document and validation
- shared geometry primitives and tolerances
- command-only document mutation with undo/redo
- 2D projection package
- shared UI design tokens/components
- responsive browser editor shell
- command-driven 4 × 3 m sample room
- ASP.NET Core host and CI quality gates

Interactive wall drawing, persistence, real 3D projection, catalog and exports follow as separate feature slices without bypassing these boundaries.
