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
| localStorage persistence | Partially working | `code` | See §1.1 — quota handling is destructive |
| Autosave | Not verified | `none` | `stores/saveStatus.ts`; interval logic unexercised |
| Version history snapshots | Partially working | `code` | Max 10 snapshots, 5-min interval; restore now migrates |
| IndexedDB storage | Broken | `code` | **Does not exist.** No `indexedDB` reference anywhere in `src/` — HP-105 |
| Thumbnails | Not verified | `none` | localStorage, one key per project; no quota guard |

### 1.1 localStorage quota handling is destructive

`services/datastore.ts` `save()`, on `QuotaExceededError`, **deletes every other project**
to make room for the current one:

```ts
const minimal: Record<string, string> = {};
minimal[project.id] = all[project.id];
localStorage.setItem(KEY, JSON.stringify(minimal));
alert('Storage quota exceeded. Other projects were removed to save this one.');
```

The user is told after the fact, with no export offered first and no undo. HP-105 explicitly
requires "no automatic deletion of unrelated projects on quota pressure", and background
images are stored as inline data URLs, so quota pressure is likely as soon as real plans are
imported. **Treat as a data-loss risk to fix early**, not merely a storage-tier upgrade.

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
| **Room detection — crossing walls (X-junctions)** | **Broken** | `test` | **0 rooms** for a 400×400 four-quadrant plan |
| **Room detection — 10-room grid** | **Broken** | `test` | 4 rooms instead of 10; same root cause |
| **Room identity across recalculation** | **Broken** | `test` | Ids are `room-N-${Date.now()}`; names reset to `Room N` |
| Room polygon extraction | Partially working | `test` | ≥3 vertices on all passing fixtures; shares the X-junction blind spot |
| Wall curves (quadratic bezier) | Not verified | `code` | `curvePoint` persists; detection treats walls as straight |
| Geometry tolerance utilities | Broken | `code` | Do not exist; `EPSILON` is module-local — HP-204 |
| Degenerate-geometry guards | Not verified | `none` | No NaN/zero-length validation found — HP-205 |

Full analysis, root cause and suggested fix: **`docs/room-detection-matrix.md`**.

---

## 3. Furniture

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Catalog placement | Not verified | `none` | `utils/furnitureCatalog.ts` |
| Per-item dimension overrides persist | Working | `test` — `roundTrip.test.ts` | `width`/`depth`/`height` survive verbatim |
| Per-item dimensions — 2D footprint | Working | `code` | `canvasRenderer.ts:913` uses `item.width ?? cat.width` |
| Per-item dimensions — 3D scaling | Working | `code` | `ThreeViewer.svelte:1522` uses `fi.width ?? cat.width` |
| Per-item dimensions — alignment tools | Working | `code` | `alignment.ts:26` |
| Per-item dimensions — distance overlay | Working | `code` | `FloorPlanCanvas.svelte:1268` |
| **Per-item dimensions — hit testing / selection** | **Broken** | `code` | See §3.1 — HP-203 |
| Collision detection | Broken | `code` | **Does not exist** — HP-601…604 |
| Clearance zones | Broken | `code` | **Does not exist** — HP-605 |
| Nearest-distance overlay | Partially working | `code` | Exists, but axis-aligned only — see §3.2 |
| Custom furniture (dimension-only) | Broken | `code` | Not found — HP-504 |
| GLB/GLTF user import | Broken | `code` | Loader exists for built-ins; no user import — HP-506 |
| Favorites / recently used | Not verified | `none` | HP-503 |

### 3.1 Hit testing ignores per-item dimensions (HP-203, confirmed)

`utils/hitTesting.ts` lines 81–82 and 111–112 size the furniture footprint from the
**catalog** only:

```ts
const hw = cat.width * Math.abs(fi.scale?.x ?? 1) / 2;
const hd = cat.depth * Math.abs(fi.scale?.y ?? 1) / 2;
```

Every other consumer resolves `item.width ?? cat.width`. So for any item with a dimension
override — exactly the items that matter for real house planning — **the clickable area does
not match the drawn footprint**. Resize a 240 cm wardrobe from a 100 cm catalog default and
its selectable region stays 100 cm wide.

This confirms the class of bug the PRD anticipated ("furniture dimensions being ignored by
some snapping/hit-testing logic") and is the concrete justification for HP-203's
`resolveFurnitureDimensions` helper: five call sites currently re-derive the same value and
one of them is wrong.

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

## 9. Summary — the five things to fix first

Ranked by risk to real house data, which is the PRD's stated priority:

1. **Destructive localStorage quota handling** (§1.1) — can silently destroy other projects,
   and inline data URLs make quota pressure likely. Data loss beats every feature. HP-105.
2. **X-junction room detection** (§2) — returns *zero* rooms for a plain four-quadrant plan.
   Blocks accurate modelling of a real house. HP-202.
3. **Unstable room identity** (§2) — room names and materials cannot survive a geometry edit.
   HP-202.
4. **Hit testing ignores per-item dimensions** (§3.1) — resized furniture is not selectable
   where it is drawn. HP-203.
5. **HP-005 Three.js lifecycle audit is still open** (§7) — no evidence either way on leaks,
   and repeated 2D/3D switching is a core workflow.

Items 2–4 now have failing-or-pinned regression tests, so progress on them is measurable.
