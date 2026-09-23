# Mobile UX and self-hosted identity

Status: implementation plan for [#32](https://github.com/Juloc/roomcraft/issues/32).

## Why this exists

The first RoomCraft editor shell was responsive only in the CSS sense: below 820 px it stacked the desktop toolbar, canvas and property inspector into a scrolling page. That is not a usable touch editor. The canvas itself also uses `touch-action: none`, so browser page scrolling and editor gestures compete.

This change treats phone layout as a first-class composition while preserving one editor model, one command path and one project document.

## Invariants

- The canvas remains the main product surface.
- Mobile and desktop share the same document, commands, selection, snapping, renderers and persistence.
- Mobile composition may differ, but domain/editor logic is never duplicated.
- The editor document never becomes a source of authentication or ownership data.
- Identity is a backend module. Projects consumes only authenticated claims, never Identity EF internals.
- Project ownership is relational metadata. Project revisions remain validated versioned JSONB.
- Existing anonymous projects are not silently reassigned. A signed-in user explicitly adopts a legacy local project.
- PostgreSQL migrations are append-only.

## Mobile composition

### Application shell

Desktop:

```
header
tool rail | canvas | inspector
```

Phone:

```
compact header
canvas
bottom tool bar
```

The phone editor occupies `100dvh`. `body` does not scroll while the editor is active. Safe-area insets are included in the header and bottom bar. The inspector becomes an overlay bottom sheet with its own scrolling content.

### Header

Phone header contains:

- back to projects
- project name
- compact save state
- undo / redo
- overflow menu

Import/export, view switching and less-frequent project actions live in overflow instead of wrapping across the viewport.

### Tools

The bottom bar contains touch-sized primary tools. Door/window are grouped as openings. Blueprint and secondary actions stay in the overflow/tool sheet. Touch targets remain at least 44 CSS px.

### Inspector

Selection and level properties use one inspector component. On desktop it is the right rail; on phone it is a bottom sheet. Selecting a wall, room, blueprint or object opens the sheet automatically. The user can close it without clearing selection.

## Touch interaction

2D keeps the existing camera model.

- mouse wheel: zoom
- middle mouse / select-drag on empty plan: pan
- one-finger select mode on empty plan: pan
- one-finger active drawing tool: tool action
- one-finger drag on movable selected object/blueprint: move
- two-finger gesture: pan + pinch zoom regardless of current drawing tool

Multi-touch is handled in the 2D viewport adapter; commands remain unchanged.

## Identity

RoomCraft uses ASP.NET Core cookie authentication.

- users live in the Identity module
- passwords use ASP.NET Core's password hasher
- auth cookie is HttpOnly, SameSite=Strict and follows the request's secure transport so LAN HTTP remains usable
- there is no open registration endpoint
- when no users exist, the setup screen can create the first administrator
- after setup, only login/logout/session endpoints remain available

The first-user setup operation is guarded by the empty-user condition and a unique normalized username index.

## Project ownership

`projects.owner_id` is nullable only to represent projects created by pre-auth RoomCraft releases.

Authenticated API rules:

- create: owner is current user
- list: only current user's projects
- get/update: only current user's projects
- adopt: may claim a legacy project only while `owner_id IS NULL`

There is intentionally no automatic fallback that treats null ownership as public access.

## Client flow

```
startup
 -> GET /api/auth/session
 -> setup required ? first-run setup
 -> anonymous ? login
 -> authenticated ? project home
 -> create/open/adopt project
 -> editor
```

The project home is the only place that chooses project identity. The editor receives a stable project id; it no longer invents a new hidden project as its navigation model.

## Validation

Required before merge:

- frontend typecheck and unit tests
- production Vite build
- backend build
- Projects migration/persistence smoke tests
- Identity setup/login/session/logout tests where practical
- container build remains green

The existing full-stack Playwright work in PR #27 owns `tests/e2e`; #32 does not edit that scope. A mobile browser scenario can be added after #27 merges.


## Desktop editor follow-up

The desktop shell uses the same interaction hierarchy as mobile instead of exposing every file/export action in the top bar.

- Header: project identity, undo/redo, 2D/3D switch, save state and one project-actions menu.
- Left rail: compact icon-first editing tools grouped by structural and content actions.
- Canvas: active drawing mode is surfaced in a compact status pill.
- Right inspector: persistent property surface without a nested card-on-card treatment.
- Right-click or Escape always exits an active drawing/placement tool and returns to Select.
- Topology diagnostics are warnings, not destructive actions. They are summarized by count and hidden by default; the user explicitly toggles diagnostic markers on the plan.
- A topology warning means geometry crosses or overlaps without a clean shared semantic endpoint. It is never rendered as a delete-style red X.
