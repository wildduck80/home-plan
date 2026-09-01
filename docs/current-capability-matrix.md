# Current Capability Matrix

**Ticket:** HP-003
**Baseline:** upstream `abb5267` (`package.json` 0.9.0) — see `docs/baseline.md`
**Recorded:** 2026-08-31

What openPlan3D actually does at the pinned baseline, and how confidently we know it.

Statuses are the four HP-003 requires. The **Evidence** column is what makes each status
trustworthy, and it matters as much as the status:

| Evidence | Meaning |
|---|---|
| `test` | Asserted by an automated test in this repo — cited by file |
| `e2e` | Asserted by a Playwright spec driving a real browser, and re-run in CI |
| **real browser** | Exercised once by hand against the dev server, with the method and results recorded. Superseded by `e2e` where a spec now covers it |
| `code` | Verified by reading the implementation; runtime/visual behaviour not exercised |
| `none` | **Not verified.** Listed because it exists, with no claim about whether it works |

Nothing below is marked Working on the strength of the upstream README alone.

> **Interactive and visual behaviour is largely `none`.** Playwright now covers the storage
> flow (§1.4), but anything whose correctness is visual — rendering fidelity, drag feel,
> walkthrough, export appearance — remains honestly unverified. Extending the E2E suite to
> those flows is the remaining part of PRD §26.3.

---

## 1. Project, schema and persistence

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Schema version on every project | Working | `test` — `tests/persistence/*` | Added by HP-101; absent at baseline |
| v1 → v2 migration of legacy projects | Working | `test` — `migrations.test.ts` | Deterministic, idempotent, non-mutating |
| Complete floor collections after load | Working | `test` — `factories.test.ts` | HP-103; four divergent constructors unified |
| Central date revival | Working | `test` — `migrations.test.ts` | Was duplicated in 3 places at baseline |
| Future-schema rejection | Working | `test` — `migrations.test.ts` | Actionable message; file left untouched |
| Save/load round-trip fidelity | Working | `test` — `roundTrip.test.ts`, `goldenFixtures.test.ts` | Byte-identical across all 10 fixtures |
| JSON export / import | Working | `test` (load path), `none` (file dialog) | Import now shares the load pipeline |
| IndexedDB persistence (primary) | Working | `test` + `e2e` | Added by HP-105; 12 MB payload stored where localStorage threw — see §1.3 |
| localStorage persistence (fallback) | Working | `test` — `datastore.test.ts` | Used only when IndexedDB is unavailable; quota handling no longer destructive — see §1.1 |
| Backend selection + fallback | Working | `test` — `storeResolution.test.ts` | `projectStore` facade; degrades to localStorage if IndexedDB is absent or fails to open |
| localStorage → IndexedDB migration | Working | `test` + `e2e` | Runs once, non-destructive, never overwrites newer records — see §1.3 |
| Autosave | Not verified | `none` | `stores/saveStatus.ts`; interval logic unexercised |
| Version history snapshots | Partially working | `code` | Max 10 snapshots, 5-min interval; restore now migrates |
| Thumbnails | Working | `test` | Own IndexedDB store; treated as derived data, never fatal on failure |

### 1.1 localStorage quota handling — fixed

**Baseline behaviour (removed):** `save()`, on `QuotaExceededError`, **deleted every other
project** to make room for the current one, telling the user only afterwards, with no export
offered and no undo:

```ts
const minimal: Record<string, string> = {};
minimal[project.id] = all[project.id];          // every other project discarded
localStorage.setItem(KEY, JSON.stringify(minimal));
alert('Storage quota exceeded. Other projects were removed to save this one.');
```

**Current behaviour:** on quota exhaustion `save()` prunes only *regenerable* data — cached
thumbnails, re-captured from the canvas on the next save — retries once, and otherwise throws
`StorageQuotaError` leaving every stored project untouched. The store no longer calls
`alert()`; it reports and the UI decides. `saveStatus` surfaces an `error` state and
`saveError`, and `TopBar` shows a persistent red banner with an **Export backup** action,
since the in-memory project is still fully recoverable at that point.

This satisfies HP-105's "no automatic deletion of unrelated projects on quota pressure".
Locked in by `tests/persistence/datastore.test.ts`, which asserts a pre-existing project
survives a failed save and that the project map is left byte-identical.

### 1.2 IndexedDB is now the primary backend (HP-105)

localStorage caps the whole origin at roughly 5 MB. Background reference images persist as
inline data URLs, so one traced architect plan could exhaust it — and the quota path above,
however safe, still means *the save fails*. Fixing the failure mode was necessary but not
sufficient; the capacity limit had to go.

`src/lib/services/idbStore.ts` implements the same `DataStore` interface over IndexedDB, whose
budget is a share of free disk rather than a few megabytes. Three object stores: `projects`
(keyed by id, with an `updatedAt` index for listing), `thumbnails`, and `meta` for migration
bookkeeping.

`resolveDataStore()` picks the backend once per session and `projectStore` is the facade every
caller uses, so no call site knows which won. IndexedDB is preferred; localStorage remains the
fallback for environments without it (SSR, some private-browsing modes) and for the case where
opening the database throws, so editing never hard-fails on storage availability.

Thumbnail methods became async as a consequence — IndexedDB has no synchronous read. The
project list fetches them in parallel rather than sequentially.

On first IndexedDB resolution, projects saved by the localStorage build are copied across.
The migration is **non-destructive** — nothing is removed from localStorage, because that copy
is the user's safety net if IndexedDB misbehaves on their browser and the space it occupies is
no longer the binding constraint. Existing IndexedDB records always win, so re-running can
never clobber newer work.

**Still outstanding:** assets remain inline inside the project record. Extracting background
images and custom entourage PNGs into a dedicated blob store needs a schema version bump and
asset resolution at render time. With IndexedDB's capacity that is now a load-performance
optimisation rather than a data-loss fix, so it is deliberately deferred.

### 1.3 Real-browser verification (Chrome, 2026-08-31)

The automated suites run against `fake-indexeddb`. The following was additionally verified by
driving a real Chrome instance against the dev server, because this code holds the user's
houses and a spec emulator cannot prove structured clone or actual quota behaviour.

**Method:** wiped IndexedDB, seeded `localStorage` exactly as the pre-HP-105 build would have
(a project whose floor omitted 10 of its 12 collections, plus a thumbnail), then loaded the app
cold so the migration ran for real.

| Check | Result |
|---|---|
| Database created with expected layout | `openplan3d` v1; stores `projects`, `thumbnails`, `meta`; `updatedAt` index present |
| Legacy project migrated and listed | "Legacy Bungalow" in the project list with the correct `updatedAt` (02/02/2026) |
| v1 → v2 schema migration applied | Stored record carries `schemaVersion: 2` |
| Floor collections backfilled (HP-102) | All 12 present as arrays; the legacy floor supplied only `walls` and `doors` |
| Element ids and references preserved | Wall ids `w-n/w-e/w-s/w-w` intact; door still `wallId: 'w-s'` |
| Thumbnail migrated | Present in the `thumbnails` store |
| Migration flag written | `meta` holds `localStorageMigrated` |
| **localStorage left intact** | Both the project map and the thumbnail key still present after migration |
| Project opens and renders | 4 walls, door with swing arc, `Room 1 (12.0 m²)` — matches the golden-fixture expectation for 400×300 cm |
| Edit → save → reload persists | Wall length 300→400 cm, save, full reload: geometry and metadata all intact |
| Console | Clean across three page loads; no errors, no `DataCloneError` |

**Capacity — the premise of HP-105, measured rather than assumed.** With a 12 MB payload:

| Backend | Result |
|---|---|
| `localStorage.setItem` | **rejected — `QuotaExceededError`** |
| IndexedDB | stored, read back byte-identical (12,582,934 chars), `locked` flag survived structured clone |

`navigator.storage.estimate()` reported a **10,241 MB** quota against 0.6 MB in use — roughly
2000x the localStorage origin cap. The old build would have failed this write outright.

**HP-202 confirmed in the real app.** Set three authored fields on the migrated room (name,
colour, floor texture), then changed the east wall's length from 300 to 400 cm. The persisted
room afterwards:

```json
{ "id": "room-p94vmu", "name": "MasterBedroom", "color": "#f4c2c2",
  "floorTexture": "walnut", "area": 12, "walls": ["w-n","w-e","w-s","w-w"] }
```

Geometry changed (`w-e.end.y` 300 → 400) while all three authored fields survived under a
stable derived id. The area correctly stayed 12 m²: the south wall's endpoint now lands on the
east wall's interior, so T-junction splitting still closes the original loop — the X/T-junction
work behaving as specified on geometry it was not written against.

Remaining unverified in a real browser: the localStorage **fallback** path, since IndexedDB
cannot easily be disabled at runtime. Unit-tested only (`storeResolution.test.ts`).

### 1.4 The storage flow is now an E2E suite

The manual pass above proved the storage layer worked *once*. `e2e/storage.spec.ts` is what
stops it breaking silently: 15 Playwright specs covering database layout, the capacity
comparison against localStorage, all seven migration properties, the migrated project opening
and detecting its room, HP-202 metadata survival across a geometry edit, and save/reload.

Run with `npm run test:e2e`. CI runs it as a separate job so the browser download never delays
feedback from `check`/`test`/`build`.

Two deliberate design choices:

- **Assertions read IndexedDB directly**, not the UI. A read that silently returned nothing
  would leave the UI looking plausibly empty, so only the stored records prove persistence.
- **No storage-reset helper.** Playwright gives each test a fresh context with empty storage.
  Clearing by hand is actively harmful here: `deleteDatabase` can be blocked by the page's own
  open connection, which leaves the `localStorageMigrated` flag behind and silently skips the
  very migration under test.

#### Two traps this suite hit, both recorded in the helpers

Worth knowing before extending the suite, because both fail *silently* rather than erroring:

1. **`page.waitForFunction` does not await an async predicate.** It tests the truthiness of the
   returned value, and a Promise is always truthy, so an `async` condition passes on the first
   poll regardless. That let assertions run against a database the app had not created yet.
   Use `expect.poll` instead.
2. **A versionless `indexedDB.open()` creates the database if absent** — a probe that fabricates
   the thing it is measuring, then reports zero object stores. Helpers now check
   `indexedDB.databases()` before opening.

#### Correction: the "dead header button" was a test race, not an app bug

While building this suite the header "New Project" button appeared broken with zero projects:
the click landed, no handler ran, no error. Native events reached the button and nothing
overlaid it, so it looked like a Svelte hydration defect.

It was not. Running the case five times showed it passing 4/5 — it only failed on a cold Vite
compile. **SvelteKit server-renders the markup, so a button is present, visible and
"actionable" to Playwright before any JavaScript has attached behaviour.** Clicking in that
window is swallowed with no error. The `waitForHydration` helper closes it by waiting for a
dynamic import of an app module to resolve.

Recorded because the failure mode is invisible on warm runs, so it will recur for anyone adding
UI-driven specs — and because the first diagnosis was confidently wrong.

---

## 2. Geometry

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Room detection — rectangle | Working | `test` — `roomDetection.test.ts` | |
| Room detection — L-shape / concave | Working | `test` | |
| Room detection — T-junction, shared wall | Working | `test` | Both rooms correctly claim the divider |
| Room detection — corridor topology | Working | `test` | 4 rooms in `hallway-apartment` |
| Room detection — endpoint gaps ≤ 5 cm | Working | `test` | `EPSILON = 5` |
| Room detection — outer face suppressed | Working | `test` | Negative signed area skipped |
| Room detection — crossing walls (X-junctions) | Working | `test` | Fixed (HP-202); was **0 rooms** for a 400×400 four-quadrant plan |
| Room detection — 10-room grid | Working | `test` | Fixed (HP-202); was 4 rooms instead of 10 |
| Room ids stable across recalculation | Working | `test` + `e2e` | Fixed (HP-202); derived from the boundary wall set, was clock-based |
| Authored room metadata survives geometry edits | Working | `test` + `e2e` | Fixed (HP-202); all five authored fields, was three — see §2.1 |
| Legacy room ids adopted from disk | Working | `test` — `roomIdentity.test.ts` | Pre-HP-202 clock ids matched by wall set and kept |
| Room polygon extraction | Working | `test` | ≥3 vertices on all ten fixtures; shares the fixed splitting step |
| Wall curves (quadratic bezier) | Not verified | `code` | `curvePoint` persists; detection treats walls as straight |
| Geometry tolerance utilities | Broken | `code` | Do not exist; `EPSILON` is module-local — HP-204 |
| Degenerate-geometry guards | Not verified | `none` | No NaN/zero-length validation found — HP-205 |

Full analysis and root causes: **`docs/room-detection-matrix.md`**.

### 2.1 Correction to the first audit

The first version of this document said room metadata "cannot survive a geometry edit". That
was **overstated**. `FloorPlanCanvas.svelte` did reattach identity after detection, so a plain
wall drag already kept a room's name — the clock-based ids in `detectRooms` were reconciled
away at the app layer before the user ever saw them.

The real defects were narrower: the merge required *exact* wall-set equality (so replacing any
boundary wall lost everything), and it carried only `id`, `name` and `floorTexture` — silently
dropping `color`, `roomType` and `labelOffset` on every recalculation. Both are now fixed in
`src/lib/domain/rooms.ts`.

Recorded because the original claim came from reading `detectRooms` in isolation without
tracing its consumers, which is exactly the failure mode the evidence column exists to
prevent.

---

## 3. Furniture

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Catalog placement | Not verified | `none` | `utils/furnitureCatalog.ts` |
| Per-item dimension overrides persist | Working | `test` — `roundTrip.test.ts` | `width`/`depth`/`height` survive verbatim |
| Per-item dimensions — one shared resolver | Working | `test` — `furniture.test.ts` | `domain/furniture.ts`; see §3.1 |
| Per-item dimensions — 2D footprint | Working | `code` | Uses `resolveFurnitureDimensions` |
| Per-item dimensions — 3D scaling | Working | `code` | Uses `resolveBaseDimensions` (scale applied to the Object3D) |
| Per-item dimensions — alignment tools | Working | `code` | Uses `resolveFurnitureDimensions` |
| Per-item dimensions — distance overlay | Working | `code` | Uses `resolveFurnitureDimensions` |
| Per-item dimensions — hit testing / selection | Working | `code` | Fixed (HP-203) — see §3.1 |
| Per-item dimensions — zoom-to-fit bounds | Working | `code` | Fixed; previously ignored item scale |
| Collision detection | Working | `test` + `e2e` | HP-601/602/603/604 — oriented, rotation-aware; see §3.3 |
| Clearance zones | Working | `test` + `e2e` | HP-605/606 — PRD presets, drawn for the selection; see §3.4 |
| Nearest-distance overlay | Working | `test` + `e2e` | HP-403 — true polygon distance, rotation-aware; see §3.4 |
| Custom furniture (dimension-only) | Working | `test` + `e2e` | HP-504/505 — kept outside projects; see §3.5 |
| GLB/GLTF user import | Broken | `code` | Loader exists for built-ins; no user import — HP-506 |
| Favorites / recently used | Working | `code` | HP-503 — already existed in localStorage before this fork |

### 3.1 Hit testing ignored per-item dimensions — fixed (HP-203)

**Baseline behaviour (removed):** `utils/hitTesting.ts` sized the furniture footprint from the
**catalog** only:

```ts
const hw = cat.width * Math.abs(fi.scale?.x ?? 1) / 2;   // ignores fi.width
const hd = cat.depth * Math.abs(fi.scale?.y ?? 1) / 2;
```

Every other consumer resolved `item.width ?? cat.width`, so for any item with a dimension
override — exactly the items that matter for real house planning — **the clickable area did
not match the drawn footprint**. A 240 cm wardrobe resized from a 100 cm catalog default
stayed selectable only across 100 cm.

**Current behaviour:** `src/lib/domain/furniture.ts` is the single resolver all consumers
share, in two variants:

- `resolveFurnitureDimensions` — overrides **and** item scale applied, for anything reasoning
  in world coordinates (2D renderer, hit testing, alignment, distance overlay, bounds).
- `resolveBaseDimensions` — overrides only, for the 3D viewer, which scales the `Object3D`
  itself and would otherwise apply scale twice.

Both clamp to positive finite values, so a corrupt or zero dimension can no longer produce
degenerate bounds that make an item unselectable (a slice of HP-205).

Folding six `FloorPlanCanvas` sites into the helper also fixed a latent bug: two
bounds calculations used for zoom-to-fit were omitting item scale entirely.

19 tests in `tests/domain/furniture.test.ts` cover override precedence, per-axis
independence, scale composition, negative-scale mirroring, missing catalog entries, and
rejection of zero/negative/NaN/Infinity dimensions.

### 3.2 Nearest-distance overlay is axis-aligned only

`FloorPlanCanvas.svelte` (~line 1230 onward) already draws furniture-to-wall and
furniture-to-furniture distances, correctly using per-item dimensions. It reasons purely in
axis-aligned bounds (`vOverlap`/`hOverlap`, left/right/top/bottom), so a **rotated** item's
distances are measured from its unrotated bounding box.

HP-403 is therefore an upgrade of working code, not a new feature — and HP-601's oriented
bounds utility is its prerequisite.

---

### 3.3 Fit warnings (HP-601 / 602 / 603 / 604)

The PRD calls collision the highest-value differentiator, because the app exists to answer "does
this fit". `src/lib/domain/collision.ts` provides oriented footprints and overlap tests;
`collisionCheck.ts` scans a floor.

**Warnings, never constraints.** PRD 16 requires that deliberate placement is not blocked, which
sets the bar for reporting: a human has to agree it is a problem. A wardrobe pushed flush against
a wall stays silent — otherwise the warnings become noise and get ignored, at which point a real
clash goes unnoticed too. An E2E spec asserts the offending placement survives the warning.

Detected: furniture against furniture, furniture crossing a wall, and furniture standing in a
door swing. Each reports the overlap area so severity can be judged rather than every clash
looking equally urgent.

#### Decisions

- **Separating axis theorem, generalised to convex polygons.** Exact, no sampling or tolerance
  fudging. Generalising past rectangles matters because a door swing is a circular *sector* —
  convex for a quarter turn, so it uses the same test. Approximating a swing as a square would
  over-report at the far corner, and the fastest way to get a warning system ignored is to have it
  cry wolf.
- **Touching is not overlapping.** Flush placement is a normal arrangement, so edges and corners
  in contact are excluded, with an epsilon absorbing rotation round-off.
- **Doors without a swinging leaf are skipped** — sliding, pocket and plain openings cannot foul
  anything.
- **Detection is cached against a geometry signature**, not recomputed per frame. It is O(n²) in
  furniture and the draw loop runs on every pointer move, so per-frame recomputation would make
  dragging progressively slower on a busy floor.
- **Unknown catalog ids are skipped, not thrown on** — a project can reference an entry a later
  build renamed.

#### An observation worth acting on later

Which side a door opens to depends on the **direction its host wall was drawn**, because the
swing normal is derived from the wall vector. So `flipSide` is the only control, and nothing
indicates which way is "into the room". Two of my own tests got this wrong before I traced the
arithmetic. A user will hit the same confusion; the fix is probably to label the control by
result ("opens into room") rather than by flip state.

### 3.4 Distances and clearance (HP-403 / 605 / 606)

"These do not overlap" is a weak answer. What decides whether a room works is whether you can
walk past the bed and open the wardrobe. `src/lib/domain/clearance.ts` answers that.

**True polygon distance (HP-403).** `closestPairBetween` returns the closest *pair of points*
between two rotated footprints, not just a number, so the overlay draws the measurement exactly
where it was taken — which is what lets it agree with the manual measure tool rather than
approximately match it. This replaces the axis-aligned arithmetic noted in §3.2, where a rotated
item's distances were measured from a box it does not occupy.

**Clearance zones (HP-605).** The PRD's presets: kitchen aisle 100 cm, wardrobe opening 90 cm,
dining chair pull-out 75 cm, bed side circulation 60 cm.

Deliberately **not applied to everything**. A universal circulation rule would flag every side
table in the house, and a warning that fires constantly is one the user stops reading — at which
point the real ones go unnoticed too. Only furniture that genuinely needs space in front of it
gets a rule.

**Only the front zone is tested**, which is what keeps this correct: a wardrobe backed against the
wall behind it is exactly how wardrobes are placed, and flagging that would be wrong. "Front" is
the item's local +depth face — furniture carries no explicit facing, so a convention was
unavoidable, and +depth matches how the catalog defines depth.

**Overlay (HP-606).** The zone is drawn for the selected item only — every zone at once would bury
the plan — amber when satisfied, red when blocked, labelled with the rule and its distance so it
is not a mystery rectangle. Nearest wall and neighbour distances are drawn alongside. Clearance
shares the collision cache, so it is recomputed on geometry change rather than per frame.

Warnings only: an E2E spec asserts the furniture does not move when a clearance warning fires.

#### An incidental DRY fix

Adding a settings field broke the build in two places, because `FloorPlanCanvas` and
`SettingsDialog` each held their own copy of the defaults literal. The compiler caught it, but
only after the fact. `DEFAULT_PROJECT_SETTINGS` is now exported and both spread from it.

### 3.5 Custom furniture (HP-504 / HP-505)

The built-in catalog holds generic approximations — "Wardrobe, 120×60". Planning a real house
means the wardrobe you actually own, which needs a name and three numbers. HP-504 explicitly
allows a plain box, so there is no model import here.

**Definitions live outside any project**, in their own IndexedDB object store (DB v2). HP-505
requires that deleting one project cannot destroy definitions used in another, and storing them
per-project would also mean re-creating the same wardrobe for every plan. localStorage mirrors
them, matching the project store's fallback.

#### Two decisions

- **A catalog registry, not a second lookup.** `getCatalogItem` is called from hit testing,
  collision, clearance, both renderers and the exporters. Adding a parallel async lookup would
  mean changing every one of those and getting one wrong; `registerCustomFurniture` feeds the
  existing sync lookup instead, so all of them resolve custom furniture without knowing it exists.
- **Placements snapshot their dimensions.** The plan asks for "a stable definition ID **or
  snapshot** strategy"; snapshotting is the safer half. `FurnitureItem` already carries per-item
  width/depth/height, so writing them at placement time means a project opened on another device —
  or after the definition was deleted — still shows furniture at the right size rather than a
  fallback box. An E2E spec deletes a definition and asserts the placement keeps its size.

Validation reports **every** invalid field at once, and rejects implausible dimensions: a typo of
24000 for 240 would otherwise create furniture the size of a street.

## 4. Architecture editing

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Wall drawing / snapping | Not verified | `none` | Interactive |
| Wall numeric properties | Not verified | `none` | `PropertiesPanel.svelte` |
| Wall length editing with anchors | Working | `test` + `e2e` | HP-401 — Start/Center/End; see §4.2 |
| Doors / windows | Not verified | `none` | Persist correctly (`test`), placement UX unverified |
| Opening offsets from wall start/end/centre | Working | `test` + `e2e` | HP-402 — edge-measured, clamped to the wall not to 5%; see §4.2 |
| Stairs | Partially working | `test` (persist), `none` (render) | 4 types in the model |
| Columns | Partially working | `test` (persist), `none` (render) | |
| Measurements / annotations | Not verified | `none` | Persist correctly |
| Guides and layers | Not verified | `none` | |
| Groups | Not verified | `none` | `elementIds`; no ID remapping on floor copy |
| Undo / redo | Partially working | `code` | 50 entries, coalescing + grouping; see §4.1 |
| Command palette | Not verified | `none` | |

### 4.1 Undo/redo notes

`stores/project.ts` snapshots the whole project as JSON per entry, capped at 50, with
coalescing (800 ms window) and nestable grouping. Functional-looking, but every entry is a
full deep copy of the project, so memory cost scales with project size × 50 — worth
measuring once real multi-floor houses with background images exist.

---

### 4.2 Exact dimensions after tracing (HP-401 / HP-402)

`src/lib/domain/wallEditing.ts` holds the arithmetic, pure and tested (35 tests). This is what
turns a traced approximation into the dimensions printed on the drawing.

**Wall length anchors.** Length editing previously always moved the far end. It now offers
Start / Center / End, and the choice matters: a traced wall usually has one corner already joined
to its neighbours, and correcting the length must not drag that corner away. Curve control points
scale with the wall so a curved wall does not straighten.

**Opening offsets, corrected.** Two real problems were fixed:

- Offsets now measure to the opening's **edges**, not its centre. That is how drawings dimension
  them — the clear gap between a corner and a door frame — so the number in the panel now matches
  the number on the plan.
- The old handlers clamped position to 5–95% of the wall, which **silently refused legitimate
  dimensions**. A door hard against a corner is ordinary, and a plan that says 0 cm should be
  obeyed. Clamping is now to the opening's own half-width, which is the real constraint: the
  edges must stay on the wall. An opening wider than its wall centres rather than producing an
  impossible position — reachable by shrinking a wall beneath an existing door.
- A **centre-from-start** field was added, the third way a drawing states a position, and the
  labels changed from "Distance from A/B" to "From wall start/end", which is readable while
  holding a drawing.

#### A test premise that was wrong

The first version of the exit-criterion spec resized two walls and expected the room area to
follow. It did not, and the code was right: walls are independent segments, so changing one
length breaks the loop rather than reshaping the room — the opposite wall does not move with it.
Dragging connected geometry is `moveWallEndpoint`, a different operation, and arguably a gap worth
its own ticket. The spec now asserts what these tickets actually promise: a stated dimension is
honoured exactly, and attached openings stay valid.

## 5. Multi-floor

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Multiple floors | Working | `test` — `two-floor-house` fixture | |
| Add / remove floor | Partially working | `code` | `removeFloor` refuses to drop the last floor |
| Floor metadata (elevation, ceiling, slab) | Broken | `code` | Not in the `Floor` type — HP-404 |
| Copy floor layout | Partially working | `code` | Copies walls with new ids; **no openings copied**, so no dangling refs today — but HP-406's remapping is still needed before openings are included |
| Adjacent-floor ghosting | Broken | `code` | Not found — HP-407 |
| Stacked whole-house 3D | Broken | `code` | Per-floor viewing only — HP-408 |
| Delete confirmation | Not verified | `none` | HP-405 |

---

## 6. Reference plans and import

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Background image (PNG/JPG) | Working | `e2e` | Inline data URL; a missing redraw-on-load was fixed — see §6.1 |
| Background transform (position/scale/rotation/opacity/lock) | Working | `test` | All five round-trip; calibration now sets scale and position together |
| Background visibility toggle | Working | `e2e` | `visible` flag, `B` shortcut — HP-302/304 |
| Background brightness / contrast | Working | `code` | HP-302 — canvas filter, sliders in the reference panel |
| Scale calibration | Working | `test` + `e2e` | HP-303 done — two-point flow with live preview, Esc cancel, persisted record; see §6.2 |
| **PDF import** | Working | `test` + `e2e` | HP-301 done — page picker, resolution presets, verified against the real architect PDF; see §6.1 |
| Trace mode — snap to PDF line work | Working | `test` + `e2e` | HP-304 core; reference locked on import — see §6.3 |
| Apple RoomPlan import | Not verified | `code` | Substantial implementation; ad-hoc scripts exist (§8) |
| DXF / SVG import | Broken | `code` | Export only |

---

### 6.1 PDF import (HP-301)

Built and verified against a real architect PDF — a single-page A4 CAD export with ~9,900
vector paths — plus a committed synthetic permit set that mirrors its shape (paperwork first,
drawings last, mixed A4/A3).

`src/lib/import/pdf/` holds it. All pdf.js contact is confined to `pdfDocument.ts`, so the
editor still consumes a plain data URL, per the ticket's technical note. `renderPlan.ts` holds
the rasterization arithmetic with no pdf.js dependency, which is why it can be unit-tested
without a browser.

Decisions worth knowing:

- **pdf.js is dynamically imported.** It is a 408 KB chunk plus a 1.2 MB worker, and most
  sessions never open a PDF. Verified by build inspection: no static import of the chunk
  exists, so it stays out of the initial bundle.
- **The worker URL uses Vite's `?url` suffix**, so it is emitted and hashed as a real asset.
  A CDN URL would break offline use, which matters for a local-first app.
- **Pages are ranked, not just listed.** A permit set puts the drawings at the end — pages
  28-36 of 36 in the real set — so pages with substantial vector content are badged `PLAN` and
  the first one is preselected. Defaulting to page 1 would land on a cover sheet.
- **Resolution is expressed as pixels along the long edge**, not DPI, because these sets mix A4
  with A3 and DPI would mean something different per sheet. The default reaches ~150 DPI on A4,
  below which the small dimension text stops being legible.
- **Canvas area is clamped** to 16M pixels. Browsers cap canvas size and *silently return a
  blank canvas* rather than erroring, which would look like a broken import. An A3 sheet at
  300 DPI is ~17.4M pixels and would have crossed it.

#### Pre-existing bug found and fixed

The reference image was invisible until some unrelated interaction happened to repaint the
canvas. `FloorPlanCanvas` sets `bgImage` in `img.onload` but never called `markDirty()`, and the
2D canvas only repaints when marked dirty. This affected the **existing raster import path**
too, not just PDFs — it was simply easier to notice with a plan-sized image. Also added an
`onerror` path, so an undecodable reference now reports rather than leaving a stale image.

#### Still outstanding for the trace workflow

HP-301 covers import only. Calibration is §6.2. Still open from HP-302: reference **brightness
and contrast** controls, and moving the image out of the project record into an asset reference.
Neither was attempted here — a faint 0.4-opacity underlay would benefit from contrast, but it is
a separate change and bundling it in would have obscured both.

### 6.2 Scale calibration (HP-303)

`src/lib/import/reference/calibration.ts` holds the arithmetic, pure and free of any store or
canvas dependency — this is what determines whether a modelled house is dimensionally true, so
it is testable on its own (36 unit tests).

**The acceptance criterion is met and verified two ways.** The real plan carries dimension
chains of 1120 cm and 1000 cm. Calibrating on the first and measuring the second returns
1000 cm to within 4 decimal places, and stays inside 990–1010 cm under a two-pixel click error —
which is the selection tolerance of the source, not an arithmetic error. Asserted in both the
unit suite and E2E.

#### What the previous implementation did

A blocking `window.prompt()` on the second click. No preview of the resulting scale, no way to
fix a misplaced point, no cancel, and nothing recorded afterwards. The arithmetic underneath was
correct; everything around it was missing.

#### What it does now

A floating panel — deliberately **not** a modal, because panning and zooming must stay available
while placing points, which is an explicit HP-303 requirement:

- A/B markers that fill in as points land, with a Reset link.
- A third click re-places the span rather than forcing a cancel-and-restart.
- Live preview before committing: measured span, entered distance, and the resulting resize
  factor.
- Accepts `mm`/`cm`/`m` and a **comma decimal separator** — the source plans are European, where
  `10,00 m` is normal notation and rejecting it would be a needless papercut.
- Esc cancels, Enter applies.
- Refuses spans below a minimum length, because calibrating across a few pixels multiplies click
  error by the ratio of real to measured distance.

#### Position compensation

Applying a scale also adjusts `position` so the **midpoint of the measured span stays put**.
Scaling about the image centre would fling the feature the user just measured off screen, making
it awkward to verify the result — which is the entire point of calibrating.

#### The calibration is recorded, not just applied

`BackgroundImage.calibration` stores the known distance, both points and a timestamp, so the
panel can show what the scale was last set from and the user can judge whether to redo it. Being
an optional field it needs no schema bump; v2 normalization preserves it through save/load.

#### A note on "recalibration does not compound"

The obvious reading of that phrase is wrong, and it cost a test. Calibration is defined against
**image features**, not world coordinates. Once the reference is rescaled, a given world span
covers a different number of image pixels — so re-measuring the same *world* span and entering
the same distance legitimately produces a different scale. Idempotence holds when the same
*feature* is re-measured, which is what the unit suite asserts.

### 6.3 Snap-to-reference tracing (HP-304 core)

A CAD-exported plan contains no walls, only line work — and heavily fragmented line work.
Measured on the real architect PDF: **63,008 segments, median length 0.9 pt**, because every wall
is drawn as many short collinear pieces. 61% are axis-aligned, so the drawing is orthogonal.

`mergeCollinearRuns` collapses them at import:

```text
63,008 raw segments  ->  699 merged lines (>=25cm)  in 65ms
                         574 axis-aligned
                         163 at wall scale (>=100cm)
                         54 KB stored
```

#### The deliberate non-goal: no classification

Nothing here decides which lines are walls, which are dimension chains and which are furniture.
That is the hard, error-prone part, and being wrong fills a plan with confidently-wrong walls
that cost more to clean up than tracing from scratch — which is why the PRD parks automatic
extraction at P3 (HP-1103).

Offering the lines as **snap targets** instead means the user picks by clicking, so an irrelevant
candidate costs nothing. Most of the accuracy benefit, almost none of the risk.

#### Design decisions

- **Targets are stored in image-pixel space**, not world space (`referenceSpace.ts`). Calibration
  changes the reference's scale and position, so world coordinates would go stale the instant the
  user calibrated. Pixel coordinates stay attached to the drawing through every transform.
- **Extraction is seeded with pdf.js's own render viewport matrix.** That guarantees the segments
  land exactly where the corresponding pixels were painted, y-flip included. Doing the arithmetic
  independently would risk snap points sitting a fraction off the line work — worse than no
  snapping.
- **Snap priority is: existing wall endpoints, then reference line work, then the grid.** Endpoints
  first because closing up against drawn geometry is what makes rooms detect; the reference beats
  the grid because a 25 cm grid cannot land on a real wall face.
- **Calibration clicks snap too.** Those two points set the scale for everything downstream, so
  precision matters more there than anywhere else.
- **The search radius is in screen pixels**, converted to world units per query, so it feels the
  same at every zoom rather than becoming unusable when zoomed in.
- **A spatial grid backs the queries.** A linear scan would be thousands of distance checks per
  cursor move; a timing test guards against regressing to one.
- **The reference is locked on import** — a backdrop to trace over gets dragged the moment the
  user reaches for a wall.
- An orange crosshair marks an active snap, because otherwise the user cannot tell whether an
  endpoint landed *on* the drawing or merely near it.

#### Trace ergonomics, and a deliberate deviation

HP-304 specifies a *trace mode*. Working through its list, most items turn out to be either
already true or better as unconditional behaviour:

| Ticket item | How it is delivered |
|---|---|
| Reference locked by default | Locked on import |
| Adjustable opacity hot control | `[` and `]` step opacity |
| Quick hide/show reference | `B` toggles, plus a panel button |
| Stronger orthogonal/angle snapping | Capture widens from 10° to 20° **when a reference with line work is present** |
| Wall tool immediately available | Already is |
| Reference remains visible under geometry | Already does |

So there is **no trace-mode toggle**, on purpose. A mode whose only real effect is the angle
threshold is a mode the user has to remember to turn on; making it conditional on "a reference
plan with extracted line work is visible" gets the same behaviour with nothing to forget. The
threshold stays at 10° otherwise, because a wide capture that is right for an orthogonal
architect plan would fight someone sketching freehand.

The visibility control appears as a button as well as a shortcut: a hidden reference with no
visible affordance would look like the import had vanished.

#### Still outstanding

The magnifier (HP-305) is not built. The click-count comparison HP-304 asks for has not been
measured — that needs someone tracing a real room, which is the next thing worth doing.

## 7. Rendering, view and export

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| 2D canvas rendering | Not verified | `none` | Visual |
| 3D preview | Not verified | `none` | Visual |
| Walkthrough mode | Not verified | `none` | Visual |
| Elevation view | Not verified | `none` | Visual |
| Materials / textures | Not verified | `none` | `utils/materials.ts` |
| Three.js resource disposal | Working | `e2e` | HP-005 done; two unbounded leaks found and fixed — see §7.1 |
| Rendering quality presets | Broken | `code` | Not found — HP-803 |
| Eye-height presets | Broken | `code` | Not found — HP-805 |
| PNG / SVG / PDF / DXF export | Not verified | `none` | Implemented in `export.ts`, `cadExport.ts`; output never inspected |
| High-resolution screenshot | Not verified | `none` | HP-804 |
| Print layout | Not verified | `none` | |

---

### 7.1 Three.js lifecycle audit (HP-005) — two unbounded leaks found and fixed

Measured, not inspected. `e2e/threeLifecycle.spec.ts` is the repeatable procedure the ticket
asked for; it uses Three's own `__THREE_DEVTOOLS__` hook to capture renderers, so no test-only
code ships in `src/`.

| Metric | Before | After |
|---|---|---|
| Textures over 24 scene rebuilds | 32 → 182 → **332** | 20 → 20 → **20** |
| Geometries over 24 rebuilds | flat at 18 | flat at 18 |
| WebGL contexts after 10 view toggles | 12 created, **12 live** | 12 created, **2 live** |
| Texture-load subscribers after 10 toggles | **11** | 1 |

#### Leak 1 — textures were never disposed

`material.dispose()` **does not dispose the textures a material references.** The old
`clearGroup` disposed geometry and material only, so every rebuild abandoned its textures on the
GPU: ~12.5 per rebuild, growing linearly and without bound. Geometry counts stayed flat, which
is why inspection alone would likely have missed it.

This compounded badly because `activeFloor.subscribe` triggers `rebuildScene()` on *every*
project mutation — so dragging a wall in 3D leaked textures continuously, not just on floor
switches. The baseline count also dropped 32 → 20, meaning textures leaked during initial setup
too.

Fixed by `src/lib/utils/threeDisposal.ts`, which disposes any texture-valued property by
iterating the material's own properties rather than naming `map`/`normalMap`/… — so it stays
correct for material types it has never heard of.

#### Leak 2 — WebGL contexts were never released

Switching to 2D **unmounts** the viewer (`{#if mode === '2d'}…{:else}`), so each toggle
constructs a new `WebGLRenderer`. Teardown called `renderer.dispose()`, which frees Three's
caches but **leaves the WebGL context alive**. All 12 contexts from 10 toggles stayed live.

Browsers cap live contexts at roughly 16, so this was on track to break the 3D view outright
after ~15 view switches in a session. `disposeRenderer` now calls `forceContextLoss()` and
detaches the canvas.

#### Leak 3 — texture-load subscribers accumulated

`textureLoadCallbacks` was a `Set` with **no unregister function at all**. Every viewer mount
added a closure that was never removed, so after 10 toggles a texture load would call
`rebuildScene()` on 10 destroyed components. Added `removeTextureLoadCallback`, called from
teardown, and `notifyTextureLoad` now iterates a copy and isolates subscriber errors.

`FloorPlanCanvas` also registered one per mount — with an **empty body**, since that canvas
already redraws via its own rAF loop. Removed rather than unregistered: it did nothing but leak.

#### Incidental finding, not a defect

The 3D render loop is deliberately **on-demand** — `renderer.render()` runs only when the scene
is marked dirty. An idle frame counter therefore stays put, which initially looked like a
stalled loop. Recorded because it will mislead the next person writing a rendering assertion;
the spec now provokes a change rather than expecting frames while idle.

## 8. Tooling and known type debt

| Item | Status | Notes |
|---|---|---|
| Production build | Working | `npm run build` passes |
| `svelte-check` | Partially working | 6 errors, 25 warnings — all 6 from one cause, below |
| Unit test runner | Working | Vitest; 184 tests |
| CI | Working | GitHub Actions: check (no-regression), test, build |
| E2E tests | Partially working | Playwright configured; 77 specs across storage, Three.js lifecycle, PDF import, calibration, snapping, exact dimensions, fit warnings, clearance and custom furniture. Rendering fidelity, walkthrough and export still uncovered |
| Ad-hoc root test scripts | Partially working | `test-room-polygons.ts`, `test-orthogonal.ts`, `test-furniture-rotation.ts` are `npx tsx` scripts that print to stdout — not runnable in CI. Worth porting into the Vitest suite alongside HP-201. |

### The 6 `svelte-check` errors

The `Tool` union in `stores/project.ts` omits `'measure'` and `'annotate'`, which
`BuildPanel.svelte` (lines 433–448) nonetheless compares against and assigns:

```ts
export type Tool = 'select' | 'wall' | 'door' | 'window' | 'furniture' | 'text';
```

So two toolbar buttons are typed as unreachable. Whether the measure/annotate tools actually
work at runtime is **unverified** — the type error means the intent and the type have
diverged, and which side is wrong needs a runtime check before touching it. Cheap to fix,
but it needs that check first, so it is not bundled into the foundation work.

---

## 9. Summary

### Fixed since the first audit

| Was | Now |
|---|---|
| Quota exhaustion deleted every other project (§1.1) | Prunes only regenerable thumbnails, then fails loudly with an export action; stored projects untouched |
| Scene rebuilds leaked ~12.5 GPU textures each, unbounded (§7.1) | Flat across 24 rebuilds; shared disposal helper disposes textures too |
| WebGL contexts never released — 3D view would break after ~15 view toggles (§7.1) | Contexts released on unmount; 2 live after 10 toggles |
| No PDF import at all (§6.1) | Page picker with drawing detection and resolution presets, verified on the real architect plan |
| Reference images stayed invisible until an unrelated repaint (§6.1) | Redraw triggered on image load; also fixes the pre-existing raster path |
| Calibration used a blocking prompt() with no preview, cancel or record (§6.2) | Floating panel with live preview, Esc cancel, unit parsing and a persisted calibration record |
| No way to trace accurately over a PDF (§6.3) | 63k line fragments merged to ~700 snap targets; wall and calibration points land on the drawing's real geometry |
| Opening offsets clamped to 5% of the wall, refusing real dimensions (§4.2) | Clamped to the opening's own edges; a door flush to a corner is now expressible |
| Wall length editing always moved the far end (§4.2) | Start/Center/End anchors |
| No collision detection at all (§3.3) | Rotation-aware furniture/furniture, furniture/wall and door-swing warnings, reported with overlap area |
| Distance overlay measured from axis-aligned boxes (§3.4) | True polygon distance between rotated footprints |
| No clearance concept (§3.4) | PRD presets, front-zone only, drawn and labelled for the selection |
| Only generic catalog furniture (§3.5) | Custom pieces from a name and three numbers, kept across all projects |
| X-junctions detected **0 rooms** on a four-quadrant plan (§2) | All ten fixtures pass |
| Hit testing ignored per-item dimensions (§3.1) | One shared resolver across all six consumers |
| Room reconciliation needed exact wall-set equality and dropped 3 of 5 authored fields (§2.1) | Similarity matching in a tested domain module; all authored fields carried |
| Storage capped at ~5 MB by localStorage, so one traced plan could exhaust it (§1.2) | IndexedDB primary, localStorage fallback, one-time non-destructive migration |

### Outstanding, ranked by risk to real house data

1. **Rendering, walkthrough and export behaviour is unverified** (§7) — all `none`. The harness
   exists, so these are extendable rather than blocked. Highest remaining verification gap.
2. **Assets remain inline in the project record** (§1.2) — a load-performance concern rather
   than a data-loss one, since capacity is no longer the constraint.
3. **`measure` / `annotate` tools diverge from the `Tool` type** (§8) — needs a runtime check
   to establish which side is wrong before editing. The E2E harness can now supply that check.
4. **The localStorage fallback path is unverified in a real browser** (§1.3) — IndexedDB cannot
   easily be disabled at runtime; unit-tested only.

With HP-005 closed, EPIC 0-2 foundation work is complete apart from HP-204/205 (shared geometry
tolerances and degenerate-geometry guards), which are best folded into HP-303/HP-401 when those
touch tolerance-sensitive geometry.

### Minor observations from the real-browser pass

Noted rather than fixed, since neither affects data and both need reproduction before a change:

- The canvas swallows the **spacebar** while the Room Name field in the properties panel has
  focus, so "Master Bedroom" was saved as "MasterBedroom". Likely a global shortcut handler
  not checking whether focus is in a text input.
- The inline room-name editor drawn on the canvas (opened by double-clicking a room label)
  **persisted after `Escape` and after clicking elsewhere**, leaving a stale overlay until the
  page reloaded.
- After reload, the room rendered with its colour but the `walnut` floor texture did not appear,
  despite being correct in storage. Possibly lazy texture loading rather than a defect — not
  investigated.
