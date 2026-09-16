# RoomCraft Agent Rules

These rules are mandatory for all human and automated contributors.

## Product principles

RoomCraft is an easy, precise browser-based home and furniture planner. A user must not need CAD or 3D-modeling knowledge.

The project model is the source of truth. 2D, 3D, exports, measurements, shopping data and integrations are projections of the same model. Never maintain separate 2D and 3D state.

Use established interaction ideas from room-planning/CAD software, but do not copy proprietary source code, assets, branding, or pixel-identical UI.

## Engineering principles

- Prefer the correct design over a workaround. Do not add temporary duplicate paths, compatibility hacks, hidden fallbacks, or one-off special cases unless an issue explicitly documents why they are required and how they will be removed.
- Never duplicate domain logic. Shared geometry, snapping, units, transforms, selection rules and document mutations belong in shared packages.
- UI code must use the shared design system and components. Do not create page-local button/input/dialog implementations.
- Stable IDs are data identities. Display names, DOM IDs, glTF node names and database IDs must not be conflated.
- Persist canonical data, not render output. Meshes generated from walls/rooms are derived and rebuilt from the document.
- All document formats are versioned and migrated. Never silently reinterpret older project data.
- All dimensions are stored canonically in integer millimetres. Convert to metres only at renderer/export boundaries such as Three.js/glTF.
- Never use floating-point equality for geometric decisions. Geometry helpers define tolerances centrally.
- Commands are the only way editor tools mutate a project document. Direct state mutation from UI/renderers is forbidden.
- 2D and 3D renderers are read-only consumers of editor/document state.
- Feature modules may depend on shared contracts; they must not reach into another module's internals.
- Database migrations are append-only once merged. Fix forward; do not rewrite released migrations.
- APIs are contract-first. Generate clients/types where practical instead of manually duplicating request/response models.

## Architecture

The repository is a modular monolith, not microservices.

Frontend packages:

- `apps/web` — application shell and feature composition.
- `packages/document` — versioned RoomCraft document schema, migrations and serialization.
- `packages/geometry` — pure geometry/math, units and tolerances.
- `packages/editor-core` — commands, selection, undo/redo, snapping orchestration and tool state.
- `packages/render-2d` — 2D projection only.
- `packages/render-3d` — Three.js projection only.
- `packages/export` — GLB/SVG/PDF/export projections.
- `packages/ui` — design tokens and reusable UI components.

Backend modules are owned boundaries inside one deployable ASP.NET Core application. Initial modules are Projects, Catalog, Assets, Exports and Identity. Integrations such as Home Assistant must remain separate modules.

See `docs/ARCHITECTURE.md` for the full dependency rules.

## UI rules

- One design-token system for color, typography, spacing, radius, elevation, motion and z-index.
- Reusable components before feature-specific markup.
- Inputs that edit dimensions use the same `LengthField` component and unit parsing.
- All destructive actions use the same confirmation pattern.
- Keyboard, pointer and touch must be considered from the start.
- Minimum touch target: approximately 44 CSS px.
- No hover-only required actions.
- Dark/light themes must be token-based; never duplicate component CSS for themes.
- Icons come from the chosen shared icon system. Do not mix arbitrary icon sets.
- Accessibility labels and focus states are required for interactive controls.

## Static assets and caching

Production must never serve stale application JS/CSS after an update.

- The TypeScript client is built with Vite and content-hashed output filenames.
- ASP.NET Core serves static assets with `MapStaticAssets` where applicable for build-time fingerprinting, compression, ETags and immutable caching.
- HTML/application entry responses must not be immutable cached.
- Do not add manual `?v=123` query strings or hand-maintained cache versions.
- A future service worker must use an explicit versioned update strategy; do not add one just for installability.

## 3D asset rules

- glTF 2.0 / GLB is the canonical runtime interchange format.
- Imported assets are referenced by asset ID, never by arbitrary filesystem path.
- Imports must be normalized before catalog use: units, axis/orientation, pivot/bounds, material metadata and validation.
- Large geometry/texture optimization runs outside the main UI thread when possible.
- Dispose GPU resources when assets/scenes are removed.
- RoomCraft-specific metadata belongs in glTF `extras` or sidecar metadata using stable RoomCraft IDs.

## Persistence

Use PostgreSQL. Relational metadata stays relational. The versioned editor document may be stored as structured JSONB, but its schema must remain predictable and validated.

Project saves use optimistic concurrency with a revision token. Never silently overwrite a newer revision.

Binary models, textures, blueprint images and generated exports go through a blob-storage abstraction; PostgreSQL stores metadata and references, not large binaries.

## Quality gates

Every change must keep these green:

- formatting/linting
- TypeScript typecheck
- frontend unit tests
- .NET build and tests
- document migration tests
- geometry tests for changed geometry behavior
- production build

Editor interaction changes should have Playwright coverage when practical.

Tests are not optional for geometry, migrations, snapping, command undo/redo or serialization fixes.

## Change discipline

Before implementing a feature:

1. Identify the owning module/package.
2. Check whether an existing shared abstraction already owns the behavior.
3. Update the document schema only when persistent semantic data changes.
4. Add a migration whenever a persisted schema changes.
5. Keep derived rendering data out of persistence.
6. Add or update tests.
7. Update architecture/product documentation if a boundary or invariant changed.

If implementation would violate these rules, change the architecture deliberately and document the decision instead of bypassing it.