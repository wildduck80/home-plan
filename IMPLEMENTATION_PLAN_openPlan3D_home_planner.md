# Implementation Plan
## openPlan3D -> Private Home Planner

**Document version:** 0.1  
**Date:** 2026-08-31  
**Companion document:** `PRD_openPlan3D_home_planner.md`  
**Base repository:** https://github.com/laanlabs/openPlan3D  
**Observed base version:** 0.9.0

---

## 1. Purpose

This document converts the product requirements into an execution plan suitable for a developer or coding agent such as Claude Code or Codex.

The plan intentionally avoids a large rewrite. Work is organized so that:

1. current behavior is verified before changing it;
2. data safety is established before new schema-heavy features;
3. geometry reliability comes before visual polish;
4. each major behavior has tests and explicit acceptance criteria;
5. the fork remains reasonably easy to rebase/cherry-pick from upstream.

---

## 2. Execution Rules for Coding Agents

Every agent working on this repository should follow these rules.

### Rule 1 - Inspect before editing

For each ticket:

1. locate current implementation;
2. identify related types/stores/renderers/tests;
3. describe proposed minimal change;
4. implement;
5. add/update tests;
6. run checks/build/tests;
7. summarize changed behavior and files.

### Rule 2 - Reproduce suspected bugs first

Historical `BUG_REPORT.md` findings may already be fixed in the current code. Do not rewrite a subsystem only because an old QA report mentions it.

Create/reproduce the failing fixture against the fork's pinned commit first.

### Rule 3 - No framework migration

Do not migrate Svelte/SvelteKit to React/Next.js during this roadmap.

### Rule 4 - Preserve upstream compatibility

Avoid moving hundreds of files merely for architectural aesthetics. Refactor incrementally when a feature requires it.

### Rule 5 - Project data is production data

Any change to persisted `Project`, `Floor`, furniture, materials, variants or assets requires:

- schema version impact assessment;
- migration if needed;
- round-trip save/load test.

### Rule 6 - Add tests with geometry fixes

A geometry bug is not fixed until a regression test exists.

### Rule 7 - Keep PRs focused

Preferred PR size:

- one ticket or tightly coupled ticket pair;
- no opportunistic unrelated refactors;
- screenshots for UI changes;
- before/after fixture for geometry changes.

---

## 3. Branch and Repository Strategy

Recommended remotes:

```bash
git remote -v
# origin   -> our fork
# upstream -> https://github.com/laanlabs/openPlan3D.git
```

Recommended branches:

```text
main
feature/HP-xxx-short-description
fix/HP-xxx-short-description
```

A permanent `develop` branch is not required unless deployment workflow specifically needs it.

### Upstream sync policy

Before major epics:

1. fetch upstream;
2. review upstream changes;
3. merge/rebase into a temporary integration branch;
4. run full tests;
5. merge into `main` only when green.

Document fork-specific changes that make upstream merges difficult.

---

## 4. Definition of Done

A ticket is done only when all relevant conditions are true:

- implementation complete;
- TypeScript/Svelte checks pass;
- production build passes;
- unit/integration tests pass;
- no new console errors in tested flow;
- persistence round-trip tested if data model changed;
- migration added if persisted schema changed;
- acceptance criteria verified;
- screenshots supplied for UI work;
- documentation updated when architecture or project format changed.

---

## 5. Milestone Overview

| Milestone | Goal | Result |
|---|---|---|
| M0 | Controlled fork | Reproducible baseline and CI |
| M1 | Safe project model | Schema versions, migrations, safer persistence |
| M2 | Reliable geometry | Real-house room detection and physical dimensions |
| M3 | Architect-plan workflow | PDF import, calibration, trace mode |
| M4 | Complete house | Improved floors, ghosting, stacked 3D |
| M5 | Real furniture | Product catalog, custom objects/models |
| M6 | Fit validation | Collision and clearance system |
| M7 | Decision workflow | Variants, comparison, saved cameras |
| M8 | Visual quality | Materials and rendering improvements |
| M9 | Household sync | Optional two-user cloud sharing |
| M10 | Advanced | Sun/AI/parametric/photorealistic features |

---

# EPIC 0 - Fork Baseline and Engineering Safety

**Goal:** Pin a known-good fork and understand current openPlan3D behavior before product changes.

**Priority:** P0  
**Dependencies:** none

---

## HP-001 - Create controlled fork and pin baseline

### Tasks

- fork/clone openPlan3D;
- preserve `LICENSE`;
- add `upstream` remote;
- record upstream commit SHA in `docs/baseline.md`;
- record package version;
- document local setup;
- confirm `npm install`, `npm run check`, `npm run build`.

### Acceptance Criteria

- clean clone of our fork can be installed and built from README instructions;
- upstream remote is documented;
- exact starting SHA is recorded;
- MIT attribution remains intact.

---

## HP-002 - Add CI baseline

### Tasks

Add CI jobs for:

```text
npm ci
npm run check
npm run build
```

Add test command when test runner is established.

### Acceptance Criteria

- pull requests cannot accidentally merge with failing build/check;
- CI runs on fork PRs;
- status is documented in README.

---

## HP-003 - Create current capability matrix

### Tasks

Manually verify and document:

- wall editing;
- room detection;
- openings;
- furniture dimensions;
- 3D rendering;
- walkthrough;
- background image import;
- calibration;
- measurements;
- multi-floor;
- copy floor;
- save/reload;
- JSON import/export;
- stairs/columns;
- materials;
- version history.

### Acceptance Criteria

Create:

```text
docs/current-capability-matrix.md
```

Every feature is marked:

```text
Working
Partially working
Broken
Not verified
```

with reproduction notes.

---

## HP-004 - Build golden fixture suite

### Tasks

Create deterministic project fixtures:

```text
simple-room
adjacent-two-room
l-shaped-house
hallway-apartment
ten-room-grid
two-floor-house
stairs-columns
openings-heavy
furniture-heavy
```

### Acceptance Criteria

- fixtures load without manual editing;
- expected room counts/areas are documented;
- fixtures can be reused by automated tests.

---

## HP-005 - Audit Three.js scene lifecycle

### Tasks

Inspect scene rebuild code for:

- disposed geometries;
- disposed materials;
- disposed textures when no longer referenced;
- event listener cleanup;
- duplicate subscriptions;
- repeated floor/view switches.

### Acceptance Criteria

- create a repeatable memory/lifecycle test procedure;
- fix any reproduced unbounded resource leak;
- no duplicate scene nodes after repeated rebuilds;
- document disposal helper/pattern.

---

# EPIC 1 - Project Schema V2 and Persistence

**Goal:** Make saved projects safe to evolve before adding major new domain fields.

**Priority:** P0  
**Dependencies:** EPIC 0

---

## HP-101 - Add `schemaVersion`

### Proposed change

Extend `Project`:

```ts
interface Project {
  schemaVersion: number;
  // existing fields...
}
```

Define:

```ts
export const CURRENT_PROJECT_SCHEMA_VERSION = 2;
```

### Acceptance Criteria

- newly created projects contain schema version;
- JSON exports contain schema version;
- current old projects without the field still load through migration;
- no UI component needs to inspect schema version.

---

## HP-102 - Create project normalization and migration pipeline

### Proposed structure

```text
src/lib/persistence/migrations/
  index.ts
  v1-to-v2.ts
  normalize.ts
```

### Requirements

`load()` flow:

```text
parse -> detect version -> migrate sequentially -> normalize -> validate -> return
```

### Acceptance Criteria

- legacy project missing arrays loads correctly;
- dates are revived centrally;
- future unsupported schema shows a useful error rather than corrupting data;
- migration tests are deterministic.

---

## HP-103 - Centralize default floor/project constructors

### Problem

Multiple code paths that manually construct `Floor` objects can drift from the canonical shape.

### Tasks

- ensure all new floor creation uses one constructor/factory;
- ensure imported/migrated floors normalize through the same default shape;
- remove repeated defensive array initialization where safe.

### Acceptance Criteria

Every runtime `Floor` always has valid collections required by its interface.

---

## HP-104 - Persistence round-trip test suite

### Test cases

- new empty project;
- complex project;
- multi-floor project;
- background reference;
- stairs/columns;
- custom dimensions;
- legacy project fixture;
- export -> import.

### Acceptance Criteria

`serialize(load(save(project)))` preserves all meaningful fields.

---

## HP-105 - Introduce IndexedDB storage adapter

### Goal

Avoid localStorage limits once PDFs, images, custom models and textures are stored.

### Strategy

Keep existing `DataStore` abstraction. Add an IndexedDB implementation without changing editor callers.

### Suggested data split

```text
projects       -> normalized JSON records
assets         -> Blob records
thumbnails     -> Blob/data records
customCatalog  -> metadata + asset references
```

### Acceptance Criteria

- project API remains compatible with `DataStore`;
- existing localStorage projects can be migrated/imported;
- no automatic deletion of unrelated projects on quota pressure;
- asset blobs do not need to be embedded in core project JSON.

---

## HP-106 - Add automatic backup/export safeguard

### Requirements

- easy `Download Project Backup` action;
- include schema version;
- optional `Export with assets` ZIP later;
- warn clearly if persistence fails.

### Acceptance Criteria

A user can recover the house from exported data in a fresh browser profile.

---

# EPIC 2 - Geometry Reliability and Physical Dimensions

**Goal:** Establish trustworthy geometry before building dependent features.

**Priority:** P0  
**Dependencies:** EPIC 0, HP-104

---

## HP-201 - Verify room detection against golden fixtures

### Tasks

For each fixture, assert:

- room count;
- expected approximate/exact area;
- closed polygon;
- expected wall membership.

### Important cases

- T-junction;
- shared wall;
- L-shape;
- corridor;
- 10-room grid.

### Acceptance Criteria

A written test matrix identifies exactly which current cases fail.

Do not rewrite the algorithm if all required real-house cases pass.

---

## HP-202 - Harden room detection if failures reproduce

### Strategy

Prefer minimal correction to existing planar face traversal first.

If the algorithm remains unreliable, evaluate a more explicit half-edge/DCEL representation.

### Acceptance Criteria

All golden room fixtures pass consistently.

No duplicate outer-boundary room is emitted.

Room IDs/persisted room metadata survive geometry recalculation where the boundary is materially unchanged.

---

## HP-203 - Centralize physical furniture bounds

### Problem

A placed furniture item can override catalog width/depth/height. Every subsystem must resolve the same final physical dimensions.

### Add helper

```ts
resolveFurnitureDimensions(item, catalog): {
  width: number;
  depth: number;
  height: number;
}
```

### Update consumers

- drawing footprint;
- hit test;
- selection handles;
- snapping;
- 3D scaling;
- collision;
- export.

### Acceptance Criteria

One resized item has the exact same effective dimensions in every subsystem.

Add regression coverage for upstream issue class where snapping ignored per-item dimensions.

---

## HP-204 - Introduce geometry epsilon/tolerance utilities

### Goal

Remove ad-hoc tolerance behavior from unrelated algorithms.

### Add helpers

- point equality;
- point-to-segment distance;
- near-zero length;
- angle normalization;
- snap tolerance.

### Acceptance Criteria

Geometry tolerances are documented and reused rather than duplicated magic constants.

---

## HP-205 - Prevent degenerate geometry propagation

### Cases

- zero-length walls;
- near-zero wall length;
- split at exact 0/1 endpoint;
- NaN/Infinity coordinates;
- invalid furniture dimensions.

### Acceptance Criteria

Invalid operations are either rejected or normalized before they can produce `NaN`/`Infinity` in project state.

---

# EPIC 3 - Architect Plan Import and Trace Workflow

**Goal:** Make importing a real PDF plan the fastest way to start a house.

**Priority:** P1  
**Dependencies:** EPIC 1, stable background calibration baseline

---

## HP-301 - Add PDF import

### Requirements

- file picker accepts PDF;
- display page thumbnails;
- select page;
- render selected page at configurable/high-enough resolution;
- insert into existing background/reference mechanism.

### Technical note

Keep PDF rendering isolated behind an import service so the editor still consumes an image/reference asset.

### Acceptance Criteria

A multi-page architect PDF can be used to create a reference layer for a selected floor.

---

## HP-302 - Upgrade background image to Reference Plan model

### Add optional fields

- visible;
- brightness;
- contrast;
- sourceName;
- calibratedDistance;
- calibration metadata;
- asset ID instead of giant inline data URL where IndexedDB is enabled.

### Acceptance Criteria

Old background images migrate and continue to render.

---

## HP-303 - Improve calibration UX

### Flow

```text
Start calibration
 -> click point A
 -> click point B
 -> type known dimension
 -> preview computed scale
 -> Apply
```

### UX requirements

- zoom remains available during point selection;
- clear markers for A/B;
- Esc cancels;
- recalibration supported;
- calibration result persists.

### Acceptance Criteria

Given a plan line known to be 400 cm, a second known dimension should match within the resolution/selection tolerance of the source plan.

---

## HP-304 - Add Trace Mode

### Trace mode state

- reference locked by default;
- adjustable opacity hot control;
- wall tool immediately available;
- stronger orthogonal/angle snapping;
- high-contrast wall preview;
- reference remains visible under geometry;
- quick hide/show reference shortcut.

### Acceptance Criteria

Tracing a simple architect-plan room requires materially fewer clicks than using generic edit mode.

---

## HP-305 - Add trace magnifier

### Requirements

When tracing at moderate zoom, show a small magnified region around the pointer while placing wall endpoints.

### Acceptance Criteria

Magnifier can be toggled and does not interfere with clicks/pointer capture.

---

## HP-306 - Import floor from previous reference setup

### Use case

For separate ground/upper-floor pages, the user should be able to quickly create the next floor and attach another PDF page/reference.

### Acceptance Criteria

A new floor can be created directly from the PDF import flow without leaving the workflow.

---

# EPIC 4 - Precision Editing and Multi-Floor House V2

**Goal:** Make the model useful for real construction/furniture dimensions and complete-house viewing.

**Priority:** P1  
**Dependencies:** EPIC 1, EPIC 2

---

## HP-401 - Exact wall length editing with anchors

### UI

```text
Length: 412.0 cm
Anchor: [Start] [Center] [End]
```

### Acceptance Criteria

Changing the length moves only the expected endpoint(s) and preserves angle unless user changes it.

Attached openings remain valid.

---

## HP-402 - Exact opening offsets

### Requirements

Door/window property panel exposes:

- width;
- height;
- sill height (window);
- distance from wall start;
- distance from wall end;
- center position.

Editing one positional value updates the others.

### Acceptance Criteria

Opening can be placed exactly from architectural dimensions without dragging.

---

## HP-403 - Smart nearest-distance overlay

### Requirements

For selected furniture, compute nearest relevant distances to:

- surrounding walls;
- adjacent furniture;
- nearby opening edges.

### Acceptance Criteria

Distances update live while dragging and agree with manual measurement tool.

---

## HP-404 - Add floor metadata

### Extend `Floor`

```ts
elevation?: number;
defaultCeilingHeight?: number;
slabThickness?: number;
visible?: boolean;
locked?: boolean;
```

### Acceptance Criteria

- migration defaults existing projects correctly;
- floor property editor available;
- data round-trips through save/export/import.

---

## HP-405 - Safe floor management UI

### Requirements

- explicit Add Floor;
- rename;
- duplicate options;
- delete confirmation;
- overflow-safe floor selector;
- avoid destructive double-click-only behavior.

### Acceptance Criteria

Accidental floor deletion requires confirmation and many floors do not break the header.

---

## HP-406 - Correct floor duplication with ID remapping

### Copy modes

1. Empty floor.
2. Architecture only.
3. Architecture + openings.
4. Full duplicate.

### Requirements

When walls receive new IDs, door/window `wallId` references must point to the corresponding new walls.

Groups/other references must also be remapped.

### Acceptance Criteria

No duplicated element references IDs from the source floor unintentionally.

---

## HP-407 - Adjacent-floor ghosting in 2D

### Requirements

- show floor below;
- show floor above;
- opacity control;
- non-interactive ghost geometry;
- optional reference image ghost.

### Acceptance Criteria

Users can align stair openings/walls without switching floors repeatedly.

---

## HP-408 - Stacked whole-house 3D view

### Requirements

Viewer mode:

```text
Active floor
Whole house
```

Whole-house position uses `elevation`, wall heights and slab thickness.

### Acceptance Criteria

Ground and upper floors appear at correct relative heights and can be individually hidden.

---

# EPIC 5 - Furniture Catalog V2 and Custom Furniture

**Goal:** Plan using objects that correspond to products users may actually buy.

**Priority:** P1  
**Dependencies:** HP-203, EPIC 1

---

## HP-501 - Introduce FurnitureDefinition V2

### New metadata

- manufacturer;
- collection;
- product name;
- category;
- exact physical dimensions;
- model asset;
- thumbnail;
- variants;
- optional product/source URL;
- tags.

### Acceptance Criteria

Existing catalog items continue working through adapter/default fields.

---

## HP-502 - Catalog search and filters

### Requirements

- text search;
- room/category;
- brand;
- width range;
- depth range;
- height range;
- favorites;
- recently used.

### Acceptance Criteria

Search for `malm` or filter to wardrobes <= 100 cm width returns matching custom/catalog data efficiently.

---

## HP-503 - Favorites

### Requirements

Favorite furniture definitions independently of placement.

### Acceptance Criteria

Favorites persist across projects.

---

## HP-504 - Create custom dimension-only furniture

### Requirements

Form fields:

```text
Name
Category
Width
Depth
Height
Color/material
```

3D representation may be a simple box initially.

### Acceptance Criteria

Custom object is reusable in multiple projects and uses exact physical dimensions in 2D/3D.

---

## HP-505 - Add My Furniture persistent catalog

### Requirements

Store custom definitions outside an individual project, while project placements reference a stable definition ID/snapshot strategy.

### Acceptance Criteria

Deleting one project does not delete personal catalog definitions used elsewhere.

---

## HP-506 - GLB/GLTF import wizard

### Requirements

- upload;
- preview;
- physical dimension calibration;
- rotation/orientation correction;
- pivot/origin handling where practical;
- category/name/brand;
- thumbnail generation;
- persist asset in IndexedDB.

### Acceptance Criteria

Imported GLB can be placed, resized, saved, reloaded and rendered after browser restart.

---

## HP-507 - Asset validation and limits

### Requirements

Warn for:

- very large model files;
- huge texture dimensions;
- unsupported external dependencies;
- missing textures;
- invalid GLTF.

### Acceptance Criteria

Bad custom model fails gracefully and never corrupts project state.

---

# EPIC 6 - Collision and Clearance Engine

**Goal:** Turn the app from visualization software into a real fit-planning tool.

**Priority:** P1  
**Dependencies:** HP-203, EPIC 2

---

## HP-601 - 2D oriented bounds utility

### Requirements

Produce authoritative 2D oriented rectangle/polygon for furniture based on:

- resolved width/depth;
- position;
- rotation.

### Acceptance Criteria

Bounds match rendered footprint at arbitrary rotation.

---

## HP-602 - Furniture/furniture collision detection

### Requirements

- detect overlapping oriented footprints;
- ignore vertical/elevation complexity initially;
- return overlap pair and approximate overlap information.

### Acceptance Criteria

Overlapping furniture receives warning state; touching edges are not incorrectly treated as deep overlap.

---

## HP-603 - Furniture/wall and room-boundary checks

### Requirements

Detect:

- crossing a wall;
- furniture substantially outside building/room boundary.

### Acceptance Criteria

User receives warning but can override placement.

---

## HP-604 - Door swing collision

### Requirements

Represent door swing area and test it against furniture bounds.

### Acceptance Criteria

A wardrobe inside the door swing produces a readable warning containing both object names/types.

---

## HP-605 - Configurable clearance zones

### Initial presets

```text
General circulation  60 cm
Wardrobe front       90 cm
Dining chair         75 cm
Kitchen aisle       100 cm
```

### Acceptance Criteria

Clearance checks can be enabled/disabled and do not block placement.

---

## HP-606 - Clearance overlay UX

### Acceptance Criteria

Selected object can display:

- nearest wall distance;
- nearest object distance;
- configured clearance envelope;
- warnings.

Overlay remains performant during dragging.

---

# EPIC 7 - Layout Variants and Comparison

**Goal:** Support actual household design decisions without duplicating the entire house.

**Priority:** P1/P2  
**Dependencies:** EPIC 1, stable furniture model

---

## HP-701 - Define variant data model

### Recommended first scope

Architecture remains shared. Variant overrides contain:

- furniture placements/properties;
- room material overrides;
- optional visibility.

### Acceptance Criteria

Creating a variant does not duplicate walls/openings unless explicitly required later.

---

## HP-702 - Create/switch/rename/duplicate variants

### UI example

```text
Kids Room
  A - Beds opposite
  B - Beds parallel
```

### Acceptance Criteria

Switching variants is instant and does not mutate other variants.

---

## HP-703 - Side-by-side 2D comparison

### Acceptance Criteria

Two variants of the same room/floor can be compared simultaneously with dimensions available.

---

## HP-704 - Side-by-side 3D comparison

### Requirements

- same room/variant selection;
- optional synchronized camera;
- independent camera mode also available.

### Acceptance Criteria

Both options render reliably without duplicating/polluting project state.

---

## HP-705 - Saved camera positions

### Requirements

Save:

- position;
- target/direction;
- eye height/mode;
- name.

### Acceptance Criteria

A saved camera can be used to compare the same viewpoint across variants.

---

## HP-706 - Decision states

### Add

- favorite;
- considering;
- approved;
- rejected.

Apply first to variants and optionally catalog items.

### Acceptance Criteria

Decision state persists and is visible in comparison UI.

---

# EPIC 8 - Materials and Rendering Quality

**Goal:** Improve realism after spatial planning is trustworthy.

**Priority:** P2  
**Dependencies:** stable 3D viewer and asset persistence

---

## HP-801 - MaterialDefinition V2

### Fields

- category;
- base color;
- texture asset;
- normal map;
- roughness;
- metalness;
- real-world texture dimensions/repeat;
- rotation.

### Acceptance Criteria

Existing material IDs migrate or map to V2 definitions.

---

## HP-802 - Custom material import

### Acceptance Criteria

User can create a reusable material from an image, define real-world texture size, and apply it to wall/floor/furniture surfaces where supported.

---

## HP-803 - Rendering quality presets

### Presets

```text
Fast
Quality
```

### Fast

Optimize interaction.

### Quality

Improve:

- shadows;
- antialiasing;
- environment lighting;
- texture quality;
- tone mapping.

### Acceptance Criteria

Preset switching is explicit and does not change project geometry/data.

---

## HP-804 - High-resolution screenshot/export

### Requirements

- choose output size/aspect;
- temporarily render at target resolution;
- restore interactive viewport afterward.

### Acceptance Criteria

Can generate a presentation-quality room image without permanently resizing the UI.

---

## HP-805 - Eye-height camera presets

### Presets

- Standing 165 cm;
- Seated 120 cm;
- Child 100 cm;
- Custom.

### Acceptance Criteria

Walkthrough/camera can adopt exact user-selected eye height.

---

# EPIC 9 - Shared Household Projects

**Goal:** Allow two users/devices to safely work on the same house without making collaboration infrastructure the core product.

**Priority:** P2  
**Dependencies:** EPIC 1; local MVP already useful

---

## HP-901 - Define cloud sync interface

### Do not couple domain model directly to Firebase

Suggested abstraction:

```ts
interface SyncProvider {
  pushProject(...): Promise<...>;
  pullProject(...): Promise<...>;
  listRevisions(...): Promise<...>;
}
```

### Acceptance Criteria

Editor can run with `NoopSyncProvider`/local-only mode.

---

## HP-902 - Add authentication for private sync

Choose implementation only when this epic starts.

### Requirements

- only invited household users access private project;
- local editing still available before login where practical;
- no public-readable project bucket.

### Acceptance Criteria

Unauthorized account cannot retrieve project data/assets.

---

## HP-903 - Revision-based project sync

### Model

Each cloud save has:

```text
projectId
revision
baseRevision
updatedAt
updatedBy
```

### Acceptance Criteria

Client cannot silently overwrite a newer cloud revision without detecting conflict.

---

## HP-904 - Basic conflict UX

### Initial strategy

No field-level merge required.

Offer:

- keep local as new version;
- load remote;
- duplicate conflicting local project;
- compare timestamps/revision metadata.

### Acceptance Criteria

A conflict cannot silently destroy the other user's work.

---

## HP-905 - Shared notes

### Scope

- project notes;
- room notes;
- optional furniture/item notes.

### Acceptance Criteria

Notes sync with revisions and remain secondary to geometry.

---

# EPIC 10 - PWA and Offline Hardening

**Priority:** P2  
**Dependencies:** IndexedDB storage

---

## HP-1001 - Installable PWA

### Acceptance Criteria

- installable on desktop/mobile browser where supported;
- app shell available offline;
- local project list opens offline.

---

## HP-1002 - Asset caching strategy

### Requirements

Cache:

- commonly used built-in models;
- thumbnails;
- built-in materials.

Do not force caching the entire catalog on first load.

### Acceptance Criteria

Previously used room can be opened without network if its required assets are cached/local.

---

# EPIC 11 - Advanced/Future Work

Do not start these until the actual house can be accurately modeled and furnished.

---

## HP-1101 - Parametric furniture

Candidates:

- wardrobes;
- shelving;
- desks;
- kitchen cabinets;
- countertops;
- rugs;
- curtains.

---

## HP-1102 - Sun study

Inputs:

- latitude/longitude;
- north orientation;
- date;
- time.

Output:

- sun direction;
- shadow preview;
- time slider.

---

## HP-1103 - AI floor-plan recognition research spike

### Goal

Investigate detecting:

- walls;
- openings;
- dimension labels.

The AI output must always be editable and verified against calibration.

---

## HP-1104 - AI layout suggestions research spike

Input:

```text
room polygon
fixed openings
required furniture
preferred clearance
```

Output:

2-5 candidate furniture variants.

Deterministic validation must reject physically invalid layouts.

---

## HP-1105 - Photorealistic renderer spike

Compare:

- improved standard Three.js;
- browser path tracing;
- WebGPU;
- server-side Blender.

Do not implement until a real quality requirement exists.

---

# 6. Recommended Execution Order

The preferred sequence for the first usable product is:

```text
HP-001  Fork/pin
HP-002  CI
HP-003  Capability audit
HP-004  Golden fixtures
HP-005  3D lifecycle audit

HP-101  schemaVersion
HP-102  migrations
HP-103  canonical constructors
HP-104  persistence tests
HP-105  IndexedDB adapter
HP-106  backup safeguard

HP-201  room-detection verification
HP-202  room-detection fixes only if needed
HP-203  physical furniture dimensions
HP-204  geometry tolerances
HP-205  degenerate geometry guards

HP-301  PDF import
HP-302  reference model upgrade
HP-303  calibration UX
HP-304  trace mode
HP-305  trace magnifier
HP-306  multi-floor PDF workflow

HP-401  exact wall length
HP-402  exact opening offsets
HP-403  smart distances
HP-404  floor metadata
HP-405  floor management
HP-406  floor duplication/remapping
HP-407  floor ghosting
HP-408  stacked 3D

HP-501  catalog V2
HP-502  search/filter
HP-503  favorites
HP-504  custom box object
HP-505  My Furniture
HP-506  GLB/GLTF importer
HP-507  asset validation

HP-601 -> HP-606 collision/clearance

HP-701 -> HP-706 variants/comparison

HP-801 -> HP-805 visuals

Only then: EPIC 9+ cloud/advanced work
```

---

# 7. First Development Slice

The first slice should be intentionally small and should end with a deployable app.

## Slice A - Foundation

Tickets:

```text
HP-001
HP-002
HP-003
HP-004
HP-101
HP-102
HP-103
HP-104
```

### Exit criteria

- fork is reproducible;
- project format has a version;
- old baseline files still load;
- migration tests pass;
- fixtures exist;
- CI is green.

No major product UI change is needed yet.

---

# 8. Second Development Slice

## Slice B - Import the real house

Tickets:

```text
HP-201
HP-202 if required
HP-301
HP-302
HP-303
HP-304
HP-401
HP-402
```

### Exit criteria

A user can import the actual architect PDF, calibrate it, trace a real floor, enter exact dimensions and obtain correct rooms.

This is the first major product-value milestone.

---

# 9. Third Development Slice

## Slice C - Complete multi-floor house

Tickets:

```text
HP-404
HP-405
HP-406
HP-407
HP-408
```

### Exit criteria

The complete house can be modeled floor-by-floor and inspected as one stacked 3D model.

---

# 10. Fourth Development Slice

## Slice D - Furnish accurately

Tickets:

```text
HP-203
HP-501
HP-502
HP-503
HP-504
HP-505
HP-403
HP-601
HP-602
HP-603
HP-604
HP-606
```

### Exit criteria

Real/custom furniture can be placed with exact dimensions and the user can detect obvious fit/clearance problems.

---

# 11. Fifth Development Slice

## Slice E - Compare choices

Tickets:

```text
HP-701
HP-702
HP-703
HP-704
HP-705
HP-706
```

### Exit criteria

Two furniture layouts for a room can be created, saved and compared without duplicating the architecture.

---

# 12. Suggested Agent Prompt Template per Ticket

Use this structure when handing a ticket to Claude Code/Codex:

```text
You are implementing ticket HP-XXX in our fork of laanlabs/openPlan3D.

Read first:
- PRD_openPlan3D_home_planner.md
- IMPLEMENTATION_PLAN_openPlan3D_home_planner.md
- docs/baseline.md
- relevant existing source files/tests

Constraints:
- Do not migrate away from SvelteKit/Svelte/Three.js.
- Make the smallest safe change that satisfies the ticket.
- Preserve backward compatibility for saved projects.
- If project schema changes, add/update migrations and round-trip tests.
- If this is a geometry bug, add a failing regression test before fixing it.
- Do not perform unrelated refactors.

Before modifying code:
1. summarize the current implementation;
2. identify files you intend to change;
3. state whether persisted schema changes.

Then implement the ticket and run:
- npm run check
- npm run build
- relevant automated tests

Finish with:
- files changed;
- behavior changed;
- tests added/run;
- known limitations;
- screenshots for visible UI changes.
```

---

# 13. Suggested Labels

For GitHub/Linear:

```text
priority:p0
priority:p1
priority:p2
priority:p3

area:geometry
area:2d
area:3d
area:persistence
area:import
area:furniture
area:materials
area:collaboration
area:testing
area:ux

kind:feature
kind:bug
kind:tech-debt
kind:spike
```

---

# 14. Dependency Map

```text
EPIC 0 Baseline
   |
   +------> EPIC 1 Schema/Persistence
   |             |
   |             +------> EPIC 3 Import/Trace
   |             +------> EPIC 4 Floors V2
   |             +------> EPIC 5 Catalog
   |             +------> EPIC 7 Variants
   |             +------> EPIC 9 Sync
   |
   +------> EPIC 2 Geometry
                 |
                 +------> EPIC 4 Precision
                 +------> EPIC 6 Collision

EPIC 5 Catalog ----------------> EPIC 6 Collision
EPIC 5 Catalog ----------------> EPIC 7 Variants
EPIC 5/8 Assets ---------------> EPIC 10 Offline

EPIC 2-8 stable ---------------> EPIC 11 Advanced
```

---

# 15. Release Plan

## Release 0.1 - Fork Stabilized

Contains:

- M0;
- schema/migrations;
- fixture suite;
- data round-trip reliability.

### Release acceptance

Existing openPlan3D behavior is preserved and data format is ready for extension.

---

## Release 0.2 - Our House Importer

Contains:

- PDF import;
- reference plan V2;
- calibration improvements;
- trace mode;
- exact wall/opening editing;
- verified room detection.

### Release acceptance

The actual architectural plan can be recreated accurately.

---

## Release 0.3 - Complete House

Contains:

- floor metadata;
- floor duplication improvements;
- adjacent-floor ghosting;
- full stacked 3D house.

### Release acceptance

All floors of the house can be modeled as one coherent project.

---

## Release 0.4 - Real Furniture Planner

Contains:

- catalog V2;
- favorites;
- custom dimension objects;
- My Furniture;
- core collision/clearance;
- smart distances.

### Release acceptance

The app can meaningfully answer whether intended furniture fits.

---

## Release 0.5 - Custom 3D and Comparison

Contains:

- GLB/GLTF import;
- variants;
- 2D/3D comparison;
- saved cameras;
- decision states.

### Release acceptance

Alternative designs can be compared visually using actual intended furniture.

---

## Release 0.6 - Visual Quality

Contains:

- material V2;
- custom materials;
- quality rendering preset;
- high-resolution screenshots;
- eye-height presets.

---

## Release 0.7 - Shared Household Project

Contains:

- optional auth;
- sync abstraction;
- revision-based cloud save;
- conflict handling;
- basic shared notes.

---

# 16. Risks and Mitigations

## Risk - Upstream changes rapidly

**Mitigation:** pin baseline, maintain upstream remote, keep changes modular and periodically integrate upstream.

## Risk - Project schema becomes fragile

**Mitigation:** schema version + migrations before adding major new fields.

## Risk - Browser storage limits

**Mitigation:** IndexedDB/blob asset storage before large custom models/PDF assets.

## Risk - Room detection works for demos but fails for real house

**Mitigation:** use the real house topology plus golden fixtures as acceptance tests.

## Risk - 3D assets make application slow

**Mitigation:** validate file sizes, prefer GLB, add asset optimization later, lazy-load catalog models.

## Risk - Collision engine becomes CAD-level complexity

**Mitigation:** start in 2D with oriented footprints and warnings; avoid full 3D physics.

## Risk - Collaboration creates disproportionate complexity

**Mitigation:** ship local MVP first; add revision-based sharing before real-time collaboration.

## Risk - Huge rewrite by coding agents

**Mitigation:** agent rules require current-code summary, minimal patches, tests and explicit schema impact.

---

# 17. MVP Stop Condition

Do not keep expanding scope indefinitely.

The MVP is complete when this exact real-world flow is reliable:

```text
architect PDF
 -> calibrated reference
 -> accurate ground/upper floor
 -> correct rooms/openings
 -> whole-house 3D
 -> exact furniture
 -> clearance/collision feedback
 -> two layout variants
 -> save/reload/backup with no data loss
```

At that point, use the application for actual house-planning sessions and let observed friction drive the next backlog instead of automatically implementing every future epic.

---

# 18. Immediate Next Actions

1. Fork and pin openPlan3D (`HP-001`).
2. Create CI (`HP-002`).
3. Run and document capability audit (`HP-003`).
4. Build golden fixtures using both synthetic plans and the real house layout (`HP-004`).
5. Add project schema version and migrations (`HP-101`/`HP-102`).
6. Only then begin the PDF/trace feature branch.

This sequence gives the coding agent enough guardrails to evolve openPlan3D without turning the fork into an unmaintainable rewrite.

---

## 19. Baseline References

Reviewed on 2026-08-31:

- https://github.com/laanlabs/openPlan3D
- https://github.com/laanlabs/openPlan3D/blob/main/README.md
- https://github.com/laanlabs/openPlan3D/blob/main/package.json
- https://github.com/laanlabs/openPlan3D/blob/main/src/lib/models/types.ts
- https://github.com/laanlabs/openPlan3D/blob/main/src/lib/stores/project.ts
- https://github.com/laanlabs/openPlan3D/blob/main/src/lib/services/datastore.ts
- https://github.com/laanlabs/openPlan3D/blob/main/src/lib/utils/roomDetection.ts
- https://github.com/laanlabs/openPlan3D/blob/main/BUG_REPORT.md

Historical QA items are verification inputs, not assumed-current defects.
