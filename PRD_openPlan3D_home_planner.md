# Product Requirements Document
## Evolving openPlan3D into a Private Home Planning System

**Document version:** 0.2  
**Date:** 2026-08-31  
**Status:** Ready for implementation planning  
**Base project:** [laanlabs/openPlan3D](https://github.com/laanlabs/openPlan3D)  
**Base project version observed:** 0.9.0  
**Primary users:** Two-person household  
**Primary use case:** Accurately plan a real house, furniture, materials, and layout alternatives before purchasing or construction decisions.

---

## 1. Executive Summary

The goal is to evolve the open-source **openPlan3D** project into a practical home-planning application inspired by the useful parts of Planner 5D and Homestyler, without attempting to reproduce their entire SaaS platforms.

The product will remain focused on a small private user group. It should prioritize:

1. real architectural dimensions;
2. reliable 2D/3D synchronization;
3. importing and tracing existing architectural plans;
4. planning a complete multi-floor house;
5. placing furniture with real product dimensions;
6. checking clearances and physical fit;
7. comparing layout alternatives;
8. improving material and lighting realism;
9. optionally sharing the same project between two users/devices;
10. preserving local-first operation and simple deployment.

The guiding strategy is:

> **Fork openPlan3D, stabilize its core, extend its data model carefully, and build the missing household-planning workflows on top of the existing editor. Do not rewrite the application from scratch.**

---

## 2. Why openPlan3D Is the Starting Point

The current openPlan3D repository already contains much of the expensive editor and rendering foundation:

- SvelteKit application shell;
- TypeScript;
- Three.js 3D rendering;
- 2D floor-plan editing;
- wall creation and snapping;
- automatic room detection;
- doors and windows;
- stairs and columns;
- furniture placement and resizing;
- per-item furniture dimension overrides;
- 2D/3D view switching;
- walkthrough mode;
- wall/floor material editing;
- measurements and annotations;
- layers and guides;
- multi-floor project support;
- background/reference-image support;
- background calibration workflow;
- local persistence;
- undo/redo and version-history features;
- JSON import/export;
- SVG/DXF/PDF/PNG export;
- Apple RoomPlan import;
- optional Firebase-related functionality.

This means the project should focus on **quality, accuracy, workflow, and domain-specific improvements**, rather than rebuilding an editor engine from zero.

### Verified base stack

```text
SvelteKit 2
Svelte 5
TypeScript 5
Three.js
Tailwind CSS 4
Vite
jsPDF
dxf-writer
JSZip
Firebase (optional)
```

---

## 3. Product Vision

The desired product sits between consumer interior-design tools and professional CAD software.

```text
Professional CAD/BIM
        |
        | powerful, but too complex for everyday home planning
        |
        v
+-----------------------------------------------+
| OUR HOME PLANNER                              |
| Accurate dimensions + simple interaction      |
| Real furniture + 2D/3D + decision support     |
+-----------------------------------------------+
        ^
        |
        | consumer-friendly, but more exact
        |
Planner 5D / Homestyler-style tools
```

The application should answer practical questions such as:

- Does this wardrobe physically fit on this wall?
- Is there enough clearance to open the wardrobe doors?
- Which bed orientation gives better circulation?
- Can two desks fit under the window?
- How much space remains between the sofa and TV unit?
- Does a 160 cm or 180 cm bed work better?
- Does the selected floor color work with the furniture?
- Which of two room arrangements is better?
- How does the house feel at eye level?
- How do the ground and upper floors align?

---

## 4. Product Principles

### 4.1 Accuracy before decoration

All important geometry must be editable numerically. A pretty render with inaccurate dimensions is less useful than a simple model that exactly represents the house.

### 4.2 One domain model drives both views

2D and 3D must be projections of the same project model.

```text
                  PROJECT MODEL
                       |
              +--------+--------+
              |                 |
              v                 v
          2D EDITOR          3D VIEWER
```

No independent 2D and 3D copies of walls, openings, rooms, or furniture should be persisted.

### 4.3 Local-first

Core editing must work without a backend or account.

Cloud synchronization is an enhancement, not a dependency for opening or editing a house.

### 4.4 Extend before rewriting

Before replacing an openPlan3D subsystem:

1. reproduce the limitation;
2. determine whether the existing implementation can be extended;
3. create a regression test;
4. replace the subsystem only if extension is unsafe or substantially more complex.

### 4.5 Backward-compatible project files

Once this fork starts producing real house projects, saved files become valuable user data. Project schema changes must therefore be versioned and migrated.

### 4.6 Metric-first, unit-safe internally

The primary UI should work extremely well in centimeters and meters. The architecture must still keep unit conversion centralized so imperial mode is not broken by new features.

---

## 5. Scope

### In scope

- private web application;
- desktop-first browser experience;
- installable PWA later;
- house/floor architecture planning;
- floor-plan import and tracing;
- accurate furniture planning;
- real product catalog;
- custom furniture;
- layout comparison;
- improved 3D visualization;
- two-user sharing/sync later;
- deterministic geometry and measurements.

### Explicitly out of scope for initial releases

- public marketplace;
- subscription billing;
- public social profiles;
- design community;
- enterprise roles/permissions;
- native Android application;
- structural engineering calculations;
- BIM authoring;
- plumbing engineering;
- electrical engineering;
- full AutoCAD replacement;
- photorealistic render farm in MVP;
- AI-generated floor plans in MVP;
- Google-Docs-style real-time multi-cursor collaboration.

---

## 6. Current Baseline vs Desired Product

| Capability | openPlan3D baseline | Desired state |
|---|---|---|
| 2D wall editor | Exists | Preserve and improve precision |
| 3D preview | Exists | Improve full-house mode, rendering, materials |
| Doors/windows | Exists | Improve clearances and exact placement |
| Room detection | Exists | Verify on complex real-house topology and harden |
| Multi-floor | Exists | Add floor metadata, ghosting, stacked 3D house |
| Background image | Exists | Add first-class PDF import and tracing workflow |
| Scale calibration | Exists | Make it obvious, precise and reusable |
| Furniture | Exists | Real product dimensions, brands, favorites, custom catalog |
| Per-item dimensions | Exists | Make physical dimensions first-class in snapping/collision |
| Collision detection | Limited/absent | Add overlap and clearance engine |
| Materials | Exists | Add richer PBR/product-oriented material library |
| Local persistence | Exists | Move toward safer IndexedDB/blob storage and schema migrations |
| JSON backup | Exists | Preserve and formalize schema compatibility |
| Layout variants | Not a core workflow | Add room/design variants and comparison |
| Couple collaboration | Limited | Shared project sync, notes and decisions later |
| AI recognition | Not required | Optional later phase |

---

## 7. Primary User Journeys

### Journey A - Build the house from an architect plan

```text
Create project
    -> Add floor
    -> Import PDF/JPG/PNG reference
    -> Select PDF page if needed
    -> Calibrate using a known dimension
    -> Lock the reference layer
    -> Trace exterior walls
    -> Trace interior walls
    -> Place doors/windows
    -> Verify dimensions
    -> Auto-detect rooms
    -> Hide/fade the reference drawing
    -> Inspect in 3D
```

### Journey B - Furnish a room accurately

```text
Select room
    -> Search furniture catalog
    -> Add real/custom item
    -> Set exact dimensions
    -> Position numerically or by dragging
    -> See live distances to walls/objects
    -> Detect overlap or clearance problems
    -> Inspect in 3D/walkthrough
```

### Journey C - Compare two layouts

```text
Room design A
    -> Save as variant A
    -> Duplicate to variant B
    -> Re-arrange furniture/materials
    -> Compare A and B side-by-side
    -> Mark preferred option
```

### Journey D - Continue on another device

```text
Edit locally
    -> Autosave
    -> Optional sync
    -> Open shared project on second device
    -> Pull latest valid project version
    -> Edit
    -> Save new version
```

---

## 8. Phase 0 - Fork, Audit and Stabilize

Before adding major features, establish a reliable fork.

### Requirements

- create private or controlled fork;
- preserve MIT license and attribution;
- add `upstream` remote for the original repository;
- document upstream synchronization process;
- establish CI for build/check/test;
- create golden test projects;
- audit current persistence and geometry behavior;
- confirm which historical QA bugs still reproduce on the chosen baseline;
- fix current regressions before schema expansion.

### Important baseline risks to verify

Historical/current repository QA has identified or discussed issues around:

- complex room detection;
- T-junctions and shared walls;
- floor copying and referenced element IDs;
- old-project normalization/migration;
- furniture dimensions being ignored by some snapping/hit-testing logic;
- missing collision detection;
- Three.js resource disposal during scene rebuilds;
- floor/stair/column persistence in older revisions.

These must be **reproduced against the fork's exact commit** before implementation. Some older problems have already been partially or fully fixed upstream.

### Deliverables

```text
docs/
  architecture.md
  current-capability-matrix.md
  project-schema.md
  persistence.md
  geometry-engine.md
  rendering.md
  upstream-sync.md
  test-strategy.md
```

---

## 9. Project Schema and Persistence V2

This is the most important architectural change before adding significant new domain data.

### 9.1 Add schema version

Every persisted/exported project must include:

```json
{
  "schemaVersion": 2,
  "id": "...",
  "name": "My House"
}
```

### 9.2 Add migration pipeline

```text
raw saved project
      |
      v
parse
      |
      v
schema validation
      |
      v
v1 -> v2 -> v3 migrations
      |
      v
normalized Project
```

Migration functions must be deterministic and testable.

### 9.3 Normalize all floor collections

No feature should need scattered checks such as `if (!floor.columns)` throughout domain code.

The loader/migrator should always return a complete normalized `Floor` object.

### 9.4 Storage evolution

Current localStorage persistence is acceptable for small JSON projects, but embedded images and custom 3D models can exceed browser localStorage limits.

Target:

```text
Project metadata / JSON -> IndexedDB
Binary assets           -> IndexedDB blobs/cache
Optional cloud          -> later sync adapter
```

The persistence layer must stay behind a `DataStore` abstraction.

### 9.5 Backup guarantees

- JSON export remains supported;
- import rejects unsupported future schemas gracefully;
- migrations never silently discard unknown important fields;
- before a destructive migration, preserve/export the original representation where practical.

---

## 10. Floor Plan Import and Trace Workflow

openPlan3D already has background image support. We should evolve it into a first-class architectural tracing workflow rather than create a second reference-layer system.

### 10.1 Import formats

**P0**

- PNG
- JPG/JPEG
- PDF

**P1**

- SVG as reference
- DXF import investigation

**P2**

- DWG via conversion/service if needed

### 10.2 PDF workflow

```text
PDF upload
   -> render page thumbnails
   -> choose page
   -> rasterize selected page at high resolution
   -> insert as floor background/reference
```

For a multi-page architect PDF, the user can repeat the workflow for each floor.

### 10.3 Reference controls

Extend `BackgroundImage`/reference properties to support:

- visible;
- locked;
- opacity;
- position;
- scale;
- rotation;
- brightness;
- contrast;
- reset transform;
- replace source;
- delete.

### 10.4 Scale calibration

Calibration must be a prominent flow:

```text
A *----------------------------* B

Known distance: [ 400.0 ] cm
```

Requirements:

- click two reference points;
- enter known real-world distance;
- calculate reference transform/scale;
- show resulting scale;
- allow recalibration;
- store calibration with the floor;
- calibration must survive save/load/export/import.

### 10.5 Trace mode

Add a dedicated mode optimized for tracing:

- dim/fade reference quickly;
- lock reference;
- wall snapping;
- horizontal/vertical constraint;
- angle snapping;
- temporary magnifier near pointer;
- keyboard nudging;
- direct length editing after placement;
- show difference between traced wall length and nearby reference dimension where possible.

---

## 11. Precision Editing

### 11.1 Walls

A wall should support exact editing of:

- start point;
- end point;
- length;
- angle;
- thickness;
- height;
- interior/exterior material.

Editing wall length should have an explicit anchor behavior:

- keep start fixed;
- keep center fixed;
- keep end fixed.

### 11.2 Openings

Door/window placement must support:

- exact width/height;
- exact sill height for windows;
- distance from wall start;
- distance from wall end;
- hinge side;
- inward/outward swing;
- collision/overlap warning.

### 11.3 Measurements

Measurements must work between:

- arbitrary points;
- wall endpoints;
- wall-to-wall;
- object-to-wall;
- object-to-object;
- opening-to-corner.

### 11.4 Smart distance display

When selecting/moving furniture, show nearest useful distances without requiring a separate measure operation.

Example:

```text
wall
----------------------
       68 cm
         |
    +---------+
    |   BED   |
    +---------+
         |
       91 cm
----------------------
wall
```

---

## 12. Multi-Floor House V2

Multi-floor support already exists and must be improved rather than rebuilt.

### 12.1 Floor metadata

Extend floor model with:

```text
elevation
defaultCeilingHeight
slabThickness
visible
locked
```

### 12.2 Floor management UX

- clear Add Floor action;
- rename floor;
- reorder floors/levels;
- safe delete confirmation;
- duplicate floor;
- copy architecture only;
- copy architecture + openings;
- optional full-floor duplicate;
- remap IDs correctly when copying referenced elements.

### 12.3 Ghost adjacent floor

In 2D:

```text
[x] Show floor below
[x] Show floor above
Opacity [20%]
```

Useful for aligning walls, stair openings, columns and shafts.

### 12.4 Whole-house 3D

Current per-floor 3D viewing should evolve to support:

- active floor only;
- active floor + ghost adjacent floor;
- entire stacked house;
- hide/show floors individually;
- correct vertical elevation based on floor metadata.

---

## 13. Room Detection and Geometry Reliability

Room detection is foundational. It must be treated as engine code, not UI code.

### Requirements

The algorithm must correctly handle:

- rectangles;
- L-shaped exterior boundaries;
- T-junction interior walls;
- two adjacent rooms sharing one wall;
- hallways;
- 10+ room grids;
- small endpoint gaps within snap tolerance;
- walls split by openings;
- repeated editing without stale room IDs;
- curved walls where supported.

### Test-first rule

Every room-detection bug must become a deterministic fixture and regression test before the fix is merged.

### Acceptance target

All golden floor plans must return the expected:

- room count;
- room boundary polygon;
- area;
- wall membership.

---

## 14. Furniture Catalog V2

### 14.1 Product-oriented schema

A furniture definition should evolve toward:

```json
{
  "id": "ikea-malm-bed-160-gray",
  "manufacturer": "IKEA",
  "collection": "MALM",
  "name": "MALM bed frame",
  "category": "bed",
  "dimensionsMm": {
    "width": 1760,
    "depth": 2090,
    "height": 1000
  },
  "variant": {
    "mattressSize": "160x200",
    "color": "gray"
  },
  "modelUrl": "/models/ikea/malm-160-gray.glb",
  "sourceUrl": "optional-product-reference"
}
```

Existing catalog items remain valid through migration/adapters.

### 14.2 Catalog navigation

```text
Search
Favorites
Recently used

Rooms
  Bedroom
  Kids room
  Living room
  Kitchen
  Dining
  Bathroom
  Office
  Outdoor

Brands
  IKEA
  JYSK
  Custom
  Generic
```

### 14.3 Search/filter

Examples:

```text
malm
160 bed
wardrobe <= 100 cm
sofa width < 250 cm
```

Filters:

- category;
- brand;
- width;
- depth;
- height;
- favorite;
- custom/built-in.

### 14.4 Per-item dimensions are authoritative

If a placed item has custom width/depth/height, all of these systems must use them:

- 2D footprint;
- hit testing;
- snapping;
- collision detection;
- clearance measurement;
- 3D scaling;
- selection bounds;
- exports.

---

## 15. Custom Furniture

### 15.1 Dimension-only custom object - P0

Users must be able to create a useful object without a 3D model.

```text
Name:   Custom wardrobe
Width:  240 cm
Depth:   60 cm
Height: 260 cm
Type:   Wardrobe
```

2D and 3D can initially represent it as a configurable box.

### 15.2 Custom model import - P1

Preferred formats:

- GLB;
- GLTF.

Import wizard:

```text
Upload
  -> Preview
  -> Set orientation
  -> Set physical dimensions
  -> Set pivot/origin
  -> Select category
  -> Add name/brand
  -> Generate thumbnail
  -> Save to My Furniture
```

### 15.3 Personal catalog persistence

Custom items must survive project changes and be reusable in different projects.

This is one reason browser storage must evolve beyond plain localStorage.

---

## 16. Collision and Clearance Engine

This is one of the highest-value differentiators for real house planning.

### P0 collision checks

- furniture vs furniture;
- furniture vs wall;
- furniture outside room/building envelope;
- door/window opening overlap;
- door swing vs furniture.

### P1 dynamic clearances

Support optional clearance zones such as:

```text
Bed side circulation        60 cm
Wardrobe opening            90 cm
Dining chair pull-out       75 cm
Kitchen working aisle       100 cm
```

These should initially be **warnings**, not hard constraints.

### UX

Warnings must be visible but not block deliberate placement.

```text
Warning: wardrobe intersects door swing by 14 cm.
```

---

## 17. Layout Variants and Decision Support

### 17.1 Room variants

A room can have multiple design variants while sharing the same architecture.

```text
Kids Room
  Option A - two beds opposite
  Option B - beds along same wall
  Option C - bunk bed
```

Variant-specific data should initially include:

- furniture placement;
- furniture visibility;
- room/furniture materials;
- lights later.

### 17.2 Comparison view

Support:

- 2D A/B comparison;
- 3D A/B comparison;
- synchronized camera optionally;
- quick switch between variants.

### 17.3 Decision states

Objects or variants can be:

- Favorite;
- Considering;
- Approved;
- Rejected.

### 17.4 Notes

Later, allow project/room/object notes such as:

> Check whether this wardrobe color matches the flooring.

---

## 18. Materials V2

### Material categories

- wall paint;
- wood flooring;
- tiles;
- carpet;
- concrete;
- stone;
- furniture wood;
- metal;
- glass;
- fabric;
- countertop.

### PBR properties where useful

```text
baseColor
baseColorMap
normalMap
roughness
metalness
textureScale
rotation
```

### Custom material workflow

```text
Create Material
  -> Name
  -> Category
  -> Upload texture
  -> Set real texture size/repeat
  -> Preview
  -> Save to My Materials
```

---

## 19. 3D Rendering V2

### Modes

**Editing/Fast**

- responsive interaction;
- simplified shadows;
- fast geometry rebuild.

**Quality**

- improved shadow quality;
- environment lighting;
- tone mapping;
- better texture filtering;
- better anti-aliasing;
- higher-quality screenshots.

**Photorealistic - future**

Investigate later:

- Three.js path tracing;
- WebGPU;
- optional server-side Blender renderer.

Do not block MVP on photorealistic rendering.

### Performance requirements

A normal home project should remain usable with approximately:

- 2-3 floors;
- 20 rooms;
- 300 placed objects;
- normal material usage.

Targets:

- editing interactions feel immediate;
- 3D editing >= 30 FPS on a modern laptop;
- 60 FPS preferred for normal scenes;
- no unbounded GPU memory growth after repeated scene rebuilds.

---

## 20. Camera and Walkthrough

Required camera modes:

- top/plan;
- orbit;
- walkthrough;
- eye-level fixed-height;
- saved camera positions.

Eye-height presets:

```text
Standing  165 cm
Seated    120 cm
Child     100 cm
Custom
```

Saved cameras are useful for comparing the same viewpoint across variants.

---

## 21. Lighting and Sun - Later Phase

### Artificial lights

- ceiling;
- pendant;
- wall;
- floor lamp;
- table lamp;
- spot;
- LED strip.

Properties:

- intensity;
- color temperature;
- color;
- direction;
- beam angle.

### Sun study - P3

Project location/date/time can drive sun position to preview natural light.

This is not an MVP requirement.

---

## 22. Two-User Sharing and Sync

Do not start with real-time collaborative editing.

### Stage 1

- JSON export/import;
- named versions;
- safe backup.

### Stage 2

- optional cloud project;
- two permitted users;
- version-based synchronization;
- detect conflicts;
- last saved revision metadata;
- manual conflict resolution if necessary.

### Stage 3 - optional

- comments/notes sync;
- presence;
- near-real-time synchronization.

The local project remains the primary working copy.

---

## 23. Offline/PWA

Later MVP+ requirement:

- installable PWA;
- cached application shell;
- local project access offline;
- cached commonly used models/materials;
- deferred cloud sync after reconnect.

---

## 24. Recommended Target Architecture

This is a direction, not a requirement for an immediate mass refactor.

```text
src/lib/
  domain/
    project/
    floor/
    geometry/
    furniture/
    materials/
    variants/

  engine/
    rooms/
    snapping/
    collision/
    measurements/
    transforms/

  renderer/
    canvas2d/
    three/

  import/
    reference/
    pdf/
    roomplan/
    models/

  export/

  persistence/
    migrations/
    local/
    indexeddb/
    cloud/

  stores/

  components/
```

Refactor toward these boundaries incrementally when touching related code.

---

## 25. Editing Command Direction

The existing store already centralizes many mutations and undo snapshots. Continue moving toward explicit domain commands rather than allowing UI components to mutate arbitrary model fields.

Examples:

```text
MoveFurniture
ResizeFurniture
MoveWallEndpoint
SetWallLength
AddOpening
DuplicateFloor
ApplyMaterial
SwitchVariant
```

Benefits:

- undo/redo;
- tests;
- history;
- future sync;
- future collaboration.

A full command-pattern rewrite is not required before feature development.

---

## 26. Testing Strategy

### 26.1 Unit tests

Required for:

- unit conversion;
- wall geometry;
- line intersections;
- T-junction processing;
- room detection;
- room polygons/area;
- snapping;
- collision detection;
- clearance distance calculations;
- project migrations;
- floor duplication ID remapping;
- furniture physical dimensions.

### 26.2 Integration tests

Examples:

```text
Draw 4 walls -> one room exists
Draw adjacent rooms -> two rooms exist
Add door -> opening belongs to wall
Move wall endpoint -> attached geometry remains valid
Duplicate floor -> referenced IDs remapped correctly
Resize furniture -> 2D/3D/collision bounds agree
Save/reload -> geometry is unchanged
```

### 26.3 E2E tests

Critical user flow:

```text
Create project
 -> import reference
 -> calibrate
 -> trace room
 -> add opening
 -> place furniture
 -> set dimensions
 -> switch to 3D
 -> save
 -> reload
 -> export
```

Canvas interactions may require coordinate-driven Playwright tests and visual regression screenshots.

### 26.4 Golden fixtures

Create permanent fixtures:

```text
tests/fixtures/
  simple-room/
  adjacent-two-room/
  l-shaped-house/
  hallway-apartment/
  ten-room-grid/
  two-floor-house/
  stairs-and-columns/
  furniture-heavy/
  openings-heavy/
```

---

## 27. Security and Privacy

For a private household tool:

- no public project URLs by default;
- no telemetry unless explicitly enabled;
- imported floor plans remain local unless sync is enabled;
- custom models/materials remain local unless sync is enabled;
- cloud sync must require authentication before private project storage is introduced;
- secrets/configuration must never be stored in project JSON.

---

## 28. MVP Definition

The first release considered genuinely useful for the real house should provide:

### Stable foundation

- controlled fork;
- build/check/test CI;
- project schema versioning;
- project migrations;
- backup/import reliability;
- validated room detection for the actual house topology.

### House creation

- existing wall/door/window/stair tools preserved;
- PDF/JPG/PNG reference import;
- excellent scale calibration;
- trace mode;
- exact measurements;
- existing multi-floor support improved;
- floor ghosting;
- whole-house 3D view.

### Furniture planning

- existing catalog preserved;
- exact per-item physical dimensions everywhere;
- custom box furniture;
- favorites;
- real-product metadata;
- GLB/GLTF custom model import;
- collision warnings;
- clearance measurements.

### Decision making

- named project snapshots;
- room/layout variants;
- A/B comparison.

### Visualization

- existing 3D/walkthrough preserved;
- improved materials;
- reliable high-resolution screenshots.

### Persistence

- autosave;
- IndexedDB-capable storage architecture;
- JSON backups.

Cloud synchronization is useful but does not block the first local MVP.

---

## 29. MVP Acceptance Scenario

The following scenario must work end-to-end without editing project JSON manually:

```text
1. Create "Our House".
2. Import an architect PDF.
3. Select the ground-floor page.
4. Calibrate a known 400 cm dimension.
5. Trace all ground-floor walls.
6. Enter exact wall thicknesses and heights.
7. Add doors/windows with exact sizes.
8. Verify rooms and areas.
9. Create/import the upper floor.
10. Align floors using ghost mode.
11. View the complete stacked house in 3D.
12. Open a bedroom.
13. Place exact-size bed, wardrobes and desks.
14. See nearest wall/object distances.
15. Receive warning for an invalid door/wardrobe overlap.
16. Create Layout A and Layout B.
17. Compare both layouts from the same camera.
18. Save a named version.
19. Close browser.
20. Reopen project with no geometry change or data loss.
21. Export a JSON backup and a high-resolution plan image.
```

If this workflow is excellent, the first product release has succeeded.

---

## 30. Priorities

### P0 - Foundation and data safety

- fork and CI;
- exact baseline audit;
- project schema version;
- migration framework;
- test fixtures;
- persistence hardening;
- room-detection verification/fixes;
- 3D resource lifecycle verification.

### P1 - Real-house workflow

- PDF import;
- enhanced reference layer;
- calibration UX;
- trace mode;
- precision measurements;
- floor metadata and ghosting;
- stacked 3D house.

### P1 - Furniture and fit

- catalog V2;
- physical dimensions everywhere;
- custom furniture blocks;
- favorites;
- collision/clearance engine;
- GLB/GLTF import.

### P1/P2 - Decisions

- variants;
- comparison;
- named versions;
- saved cameras.

### P2 - Visual polish

- materials V2;
- better shadows/lighting;
- quality rendering mode;
- custom materials.

### P2 - Shared household workflow

- authenticated optional cloud sync;
- shared project;
- conflict handling;
- notes/approval states.

### P3 - Advanced

- sun study;
- parametric cabinetry;
- AI floor-plan recognition;
- AI layout suggestions;
- photorealistic/path-traced rendering.

---

## 31. Success Metrics

Because this is initially a private tool, product success should be measured by usefulness rather than SaaS growth metrics.

### Accuracy

- manually entered dimensions persist exactly;
- save/load does not alter geometry;
- calibration reproduces known plan dimensions within practical drawing tolerance;
- 2D and 3D object footprints agree.

### Reliability

- zero data loss in standard save/reload flows;
- older supported project schemas migrate successfully;
- no fatal error when optional legacy fields are missing;
- repeated 2D/3D switching does not leak resources indefinitely.

### Usability

A non-CAD user can:

- import a plan;
- calibrate it;
- trace a room;
- place furniture;
- check dimensions;
- view the result in 3D;

without reading developer documentation.

### Decision value

The application makes it materially easier to decide whether a real furniture/layout choice will fit and work in the house.

---

## 32. Technical Guardrails

1. Do not rewrite openPlan3D wholesale.
2. Do not migrate from SvelteKit during MVP development.
3. Preserve the MIT license and required attribution.
4. New application code should be TypeScript.
5. Add schema versioning before large project-model changes.
6. All schema changes require migrations and tests.
7. Treat persisted house projects as valuable user data.
8. Keep Three.js runtime objects out of persisted domain data.
9. New geometry code must be testable without the renderer.
10. Every reproduced geometry bug gets a regression test.
11. Per-item physical dimensions must be authoritative across all systems.
12. Do not make Firebase/cloud mandatory for local editing.
13. Prefer GLB/GLTF for user 3D assets.
14. Do not add AI until deterministic tracing and geometry are reliable.
15. Prefer small upstream-compatible changes over broad speculative refactors.

---

## 33. Long-Term Direction

```text
                         HOUSE PROJECT
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
     Architecture          Interiors           Decisions
          |                   |                   |
       floors              furniture            variants
       walls               materials            compare
       openings            lighting             favorites
       stairs              products              notes
          |                   |                   |
          +-------------------+-------------------+
                              |
                              v
                          3D HOME
                              |
                    +---------+---------+
                    |                   |
                    v                   v
                Walkthrough          Rendering
```

The result should eventually be a **purpose-built household planning system**, with openPlan3D serving as the editor and rendering foundation rather than the permanent limit of the product.

---

## 34. Source Baseline

Baseline reviewed on 2026-08-31:

- Repository: https://github.com/laanlabs/openPlan3D
- README: https://github.com/laanlabs/openPlan3D/blob/main/README.md
- Package manifest: https://github.com/laanlabs/openPlan3D/blob/main/package.json
- Project types: https://github.com/laanlabs/openPlan3D/blob/main/src/lib/models/types.ts
- Project store: https://github.com/laanlabs/openPlan3D/blob/main/src/lib/stores/project.ts
- Local datastore: https://github.com/laanlabs/openPlan3D/blob/main/src/lib/services/datastore.ts
- Room detection: https://github.com/laanlabs/openPlan3D/blob/main/src/lib/utils/roomDetection.ts
- QA/bug history: https://github.com/laanlabs/openPlan3D/blob/main/BUG_REPORT.md

Historical QA findings are treated as verification targets, not automatically as current bugs, because the repository has evolved since those reports were written.
