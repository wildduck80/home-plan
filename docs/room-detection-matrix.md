# Room Detection Matrix

**Tickets:** HP-201 (verification), HP-202 (hardening — X-junction fix landed)
**Baseline:** upstream `abb5267`, `src/lib/utils/roomDetection.ts`
**Evidence:** `tests/geometry/roomDetection.test.ts`, fixtures in `tests/fixtures/golden/`
**Recorded:** 2026-08-31 · **Updated:** 2026-08-31 (X-junction fix)

Per HP-201, this matrix identifies *exactly* which topologies the detector handles. Two
cases failed on first measurement, sharing one root cause; §2 records the defect and the fix.
All ten fixtures now pass.

---

## 1. Results

| Fixture | Topology | Expected | Actual | Status |
|---|---|---|---|---|
| `simple-room` | 400×300 rectangle | 1 room, 12 m² | 1 room, 12 m² | **Working** |
| `adjacent-two-room` | 600×300 with central divider | 2 rooms, 9 + 9 m² | 2 rooms, 9 + 9 m² | **Working** |
| `l-shaped-house` | Concave L envelope | 1 room, 24 m² | 1 room, 24 m² | **Working** |
| `hallway-apartment` | 800×500, central corridor, divided upper band | 4 rooms, 8 + 8 + 8 + 16 m² | 4 rooms, 8 + 8 + 8 + 16 m² | **Working** |
| `two-floor-house` | Two storeys, one room each | 1 room per floor, 12 m² | matches | **Working** |
| `stairs-columns` | Room with stair + 2 columns | 1 room, 12 m² | 1 room, 12 m² | **Working** |
| `openings-heavy` | Room with 3 doors + 4 windows | 1 room, 12 m² | 1 room, 12 m² | **Working** |
| `furniture-heavy` | Room with 6 furniture items | 1 room, 12 m² | 1 room, 12 m² | **Working** |
| `crossing-walls` | 400×400, two dividers crossing at centre | 4 rooms, 4 × 4 m² | 4 rooms, 4 × 4 m² | **Working** (was 0 rooms) |
| `ten-room-grid` | 1000×400 as a 5×2 grid of 200×200 cells | 10 rooms, 10 × 4 m² | 10 rooms, 10 × 4 m² | **Working** (was 4 rooms) |

Additional verified characteristics:

| Behaviour | Status |
|---|---|
| Returns `[]` for fewer than 3 walls | Working |
| Returns `[]` for an unclosed boundary | Working |
| Closes endpoint gaps within the 5 cm `EPSILON` tolerance | Working |
| Splits T-junctions so two rooms share one wall | Working |
| Ignores doors, windows, furniture, stairs, columns | Working (takes only `Wall[]`) |
| Suppresses the outer/unbounded face | Working (negative signed area is skipped) |
| Deterministic room count and areas across repeated calls | Working |
| Preserves room identity across recalculation | **Broken** — see §3 |

---

## 2. Fixed defect: X-junctions (crossing walls) were never split

**Status: fixed.** Recorded in full because the failure mode was severe and silent, and
because the fix is the kind of thing a future refactor could undo.

### Root cause

`splitWallsAtTJunctions` (`roomDetection.ts:19`) splits a wall only where **another wall's
endpoint** lands on its interior:

```ts
const endpoints: Point[] = [];
for (const w of walls) {
  endpoints.push(w.start, w.end);   // ← only endpoints are ever considered
}
```

Two walls that **cross mid-span** contribute no endpoint at their intersection, so
`findOrAddVertex` never creates a graph vertex there. The planar face traversal therefore
cannot turn at the crossing, and the faces on either side are never separated.

T-junctions work precisely because one wall's endpoint *does* land on the other's interior.

### Reproduction

`crossing-walls` is the minimal case — a 400×400 envelope with one vertical and one
horizontal divider crossing at (200,200):

```text
0                 200                400
0   +--------------+--------------+
    |              |              |
    |      NW      |      NE      |     expected: 4 rooms of 4 m²
200 +--------------+--------------+     actual:   0 rooms
    |              |              |
    |      SW      |      SE      |
400 +--------------+--------------+
```

Both dividers have their endpoints on the envelope, so those T-junctions split correctly.
Only the centre crossing is missed — and that alone is enough to return **nothing at all**.

`ten-room-grid` shows the same cause at realistic scale: the four vertical dividers span the
full height and the horizontal divider crosses all four of them. The detector ignores the
horizontal wall's contribution and traces full-height 200×400 columns instead of 200×200
cells, producing `[8, 8, 8, 16]` m² instead of ten 4 m² rooms.

### Why this matters

This is not an exotic topology. Any floor plan where an interior wall runs the full width or
depth of the building and other walls cross it — a spine wall, a corridor wall, a
back-to-back room row — hits this. It is exactly the risk the PRD names as *"Room detection
works for demos but fails for real house"*.

### The fix (HP-202)

The minimal correction the plan asks for was sufficient — no DCEL rewrite needed.
`splitWallsAtTJunctions` is now `splitWallsAtJunctions` and runs a second pass:

```ts
// For every pair of walls that properly cross, add the crossing point to *both* walls.
for (let i = 0; i < walls.length; i++) {
  for (let j = i + 1; j < walls.length; j++) {
    const crossing = properCrossing(walls[i], walls[j]);
    if (!crossing) continue;
    addSplitPoint(splitWalls[i], crossing.point, crossing.tA);
    addSplitPoint(splitWalls[j], crossing.point, crossing.tB);
  }
}
```

`properCrossing` returns the intersection only when it lies strictly inside **both**
segments, using the same `EPSILON` margin as the T-junction pass expressed as a fraction of
each wall's own length. Three properties matter:

- **Crossings at an endpoint are excluded**, because the T-junction pass already covers them.
  No wall is split twice at the same point.
- **Parallel and collinear walls are skipped** — a near-zero cross product means there is no
  isolated crossing point.
- **`addSplitPoint` de-duplicates**, so both passes can propose the same point safely.

The existing planar face traversal needed no change: once the vertex exists, it finds the
quadrants on its own.

Cost is O(n²) in walls per call. Fine at the scale the PRD targets (2–3 floors, ~20 rooms),
but worth revisiting if plans get much larger, since detection runs on every geometry edit.

### Regression coverage

Beyond both fixtures passing, `tests/geometry/roomDetection.test.ts` pins the properties the
fix depends on: four quadrants from crossing dividers with both dividers shared by more than
one room, the 5×2 grid, no spurious splitting of parallel/collinear walls, and a cross that
terminates on an endpoint still behaving as a T-junction rather than splitting twice.

---

## 3. Defect: room identity is not stable across recalculation

`detectRooms` mints ids from the loop counter and the clock (`roomDetection.ts:228`):

```ts
id: `room-${roomCount}-${Date.now()}`,
name: `Room ${roomCount}`,
```

Identity therefore depends on wall iteration order and the current time, never on the
geometry. Every recalculation produces new room ids and resets names to `Room N`, so any
user-assigned room name, floor texture, colour, room type or label offset attached to a room
cannot survive a geometry edit.

HP-202's acceptance criteria require that *"room IDs/persisted room metadata survive geometry
recalculation where the boundary is materially unchanged"*, so this needs a stable identity
scheme — for example deriving a key from the sorted boundary vertices, or matching newly
detected rooms to existing ones by centroid/area proximity before assigning ids.

Current behaviour is pinned by a test so the change is visible when it lands.

---

## 4. Remaining notes

- **Room identity is still unfixed** — see §3. That is the outstanding half of HP-202.
- `EPSILON = 5` (cm) is a module-local constant serving as both point-equality and snap
  tolerance. HP-204 should move it into shared geometry utilities rather than leaving
  detection to define tolerance for the whole app.
- The area filter `area < 1000 || area > 10000000` (cm²) silently discards rooms smaller than
  0.1 m² or larger than 1000 m². Worth revisiting: a large open-plan ground floor could
  plausibly approach the upper bound.
- `getRoomPolygon` shares `splitWallsAtJunctions`, so it picked up the X-junction fix for
  free — which is exactly why the splitting step was the right single place to change it.
- Detection is O(n²) in wall count per call (§2). Acceptable now; measure before scaling far
  past the PRD's target project size.
