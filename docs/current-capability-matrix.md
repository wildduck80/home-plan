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
| **real browser** | Additionally exercised by driving Chrome against the dev server, with the method and results recorded. Not repeatable in CI until an E2E harness exists |
| `code` | Verified by reading the implementation; runtime/visual behaviour not exercised |
| `none` | **Not verified.** Listed because it exists, with no claim about whether it works |

Nothing below is marked Working on the strength of the upstream README alone.

> **Interactive and visual behaviour is largely `none`.** There is no browser-driven test
> harness yet, so anything whose correctness is visual (rendering fidelity, drag feel,
> walkthrough, export appearance) is honestly unverified. Closing that gap is the E2E work
> in PRD §26.3, not something this audit can assert.

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
| IndexedDB persistence (primary) | Working | `test` + **real browser** | Added by HP-105; 12 MB payload stored where localStorage threw — see §1.3 |
| localStorage persistence (fallback) | Working | `test` — `datastore.test.ts` | Used only when IndexedDB is unavailable; quota handling no longer destructive — see §1.1 |
| Backend selection + fallback | Working | `test` — `storeResolution.test.ts` | `projectStore` facade; degrades to localStorage if IndexedDB is absent or fails to open |
| localStorage → IndexedDB migration | Working | `test` + **real browser** | Runs once, non-destructive, never overwrites newer records — see §1.3 |
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
| Room ids stable across recalculation | Working | `test` — `roomIdentity.test.ts` | Fixed (HP-202); derived from the boundary wall set, was clock-based |
| Authored room metadata survives geometry edits | Working | `test` — `rooms.test.ts` | Fixed (HP-202); all five authored fields, was three — see §2.1 |
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
| Collision detection | Broken | `code` | **Does not exist** — HP-601…604 |
| Clearance zones | Broken | `code` | **Does not exist** — HP-605 |
| Nearest-distance overlay | Partially working | `code` | Exists, but axis-aligned only — see §3.2 |
| Custom furniture (dimension-only) | Broken | `code` | Not found — HP-504 |
| GLB/GLTF user import | Broken | `code` | Loader exists for built-ins; no user import — HP-506 |
| Favorites / recently used | Not verified | `none` | HP-503 |

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

## 4. Architecture editing

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Wall drawing / snapping | Not verified | `none` | Interactive |
| Wall numeric properties | Not verified | `none` | `PropertiesPanel.svelte` |
| Wall length editing with anchors | Broken | `code` | No anchor concept found — HP-401 |
| Doors / windows | Not verified | `none` | Persist correctly (`test`), placement UX unverified |
| Opening offsets from wall start/end | Broken | `code` | Only normalized `position` 0–1 — HP-402 |
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
| Background image (PNG/JPG) | Partially working | `code` | `BackgroundImage` stored as inline data URL — see §1.1 |
| Background transform (position/scale/rotation/opacity/lock) | Partially working | `code` | All five fields exist and round-trip (`test`) |
| Background brightness / contrast | Broken | `code` | Not in the type — HP-302 |
| Scale calibration | Partially working | `code` | `calibrationMode` + `calibrationPoints` exist; accuracy unverified — HP-303 |
| **PDF import** | Broken | `code` | **Does not exist.** `jspdf` is export-only — HP-301 |
| Trace mode | Broken | `code` | Not found — HP-304 |
| Apple RoomPlan import | Not verified | `code` | Substantial implementation; ad-hoc scripts exist (§8) |
| DXF / SVG import | Broken | `code` | Export only |

---

## 7. Rendering, view and export

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| 2D canvas rendering | Not verified | `none` | Visual |
| 3D preview | Not verified | `none` | Visual |
| Walkthrough mode | Not verified | `none` | Visual |
| Elevation view | Not verified | `none` | Visual |
| Materials / textures | Not verified | `none` | `utils/materials.ts` |
| Three.js resource disposal | Not verified | `none` | **HP-005 not yet done** — no leak claim either way |
| Rendering quality presets | Broken | `code` | Not found — HP-803 |
| Eye-height presets | Broken | `code` | Not found — HP-805 |
| PNG / SVG / PDF / DXF export | Not verified | `none` | Implemented in `export.ts`, `cadExport.ts`; output never inspected |
| High-resolution screenshot | Not verified | `none` | HP-804 |
| Print layout | Not verified | `none` | |

---

## 8. Tooling and known type debt

| Item | Status | Notes |
|---|---|---|
| Production build | Working | `npm run build` passes |
| `svelte-check` | Partially working | 6 errors, 25 warnings — all 6 from one cause, below |
| Unit test runner | Working | Vitest; 184 tests |
| CI | Working | GitHub Actions: check (no-regression), test, build |
| E2E tests | Broken | Do not exist — the reason so much above is `none` |
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
| X-junctions detected **0 rooms** on a four-quadrant plan (§2) | All ten fixtures pass |
| Hit testing ignored per-item dimensions (§3.1) | One shared resolver across all six consumers |
| Room reconciliation needed exact wall-set equality and dropped 3 of 5 authored fields (§2.1) | Similarity matching in a tested domain module; all authored fields carried |
| Storage capped at ~5 MB by localStorage, so one traced plan could exhaust it (§1.2) | IndexedDB primary, localStorage fallback, one-time non-destructive migration |

### Outstanding, ranked by risk to real house data

1. **No E2E harness** (§8) — the storage layer has now been verified in a real browser once,
   by hand (§1.3), but nothing re-checks it on future changes. Converting that manual pass into
   a Playwright suite is the single highest-value remaining item: it protects the work already
   done and unblocks every `none` row below.
2. **HP-005 Three.js lifecycle audit is still open** (§7) — no evidence either way on leaks,
   and repeated 2D/3D switching is a core workflow.
3. **Rendering, walkthrough and export behaviour is unverified** (§7) — all `none`, blocked on
   item 1.
4. **Assets remain inline in the project record** (§1.2) — a load-performance concern rather
   than a data-loss one, since capacity is no longer the constraint.
5. **`measure` / `annotate` tools diverge from the `Tool` type** (§8) — needs a runtime check
   to establish which side is wrong before editing.

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
