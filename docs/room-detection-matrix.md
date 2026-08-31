# Room Detection Matrix

**Ticket:** HP-201 (verification) — feeds HP-202 (hardening)
**Baseline:** upstream `abb5267`, `src/lib/utils/roomDetection.ts`
**Evidence:** `tests/geometry/roomDetection.test.ts`, fixtures in `tests/fixtures/golden/`
**Recorded:** 2026-08-31

Per HP-201, this matrix identifies *exactly* which topologies the current detector handles.
The implementation plan says not to rewrite the algorithm if all required real-house cases
pass. Two cases do not pass, and they share one root cause.

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
| `crossing-walls` | 400×400, two dividers crossing at centre | 4 rooms, 4 × 4 m² | **0 rooms** | **Broken** |
| `ten-room-grid` | 1000×400 as a 5×2 grid of 200×200 cells | 10 rooms, 10 × 4 m² | **4 rooms, 8 + 8 + 8 + 16 m²** | **Broken** |

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

## 2. Defect: X-junctions (crossing walls) are never split

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

### Suggested fix (HP-202)

Prefer the minimal correction the plan asks for first: extend the splitting step to also
split at true **segment–segment intersections**, not just endpoint-on-interior hits. Both
divider walls gain a vertex at the crossing and the existing face traversal should then find
the quadrants unchanged.

Only if that proves unreliable should the half-edge/DCEL rewrite be considered.

The regression tests are already written and currently asserted with `it.fails`. Fixing the
detector will turn them red, which is the signal to flip them to real assertions and update
this document.

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

## 4. Notes for HP-202

- `EPSILON = 5` (cm) is a module-local constant serving as both point-equality and snap
  tolerance. HP-204 should move it into shared geometry utilities rather than leaving
  detection to define tolerance for the whole app.
- The area filter `area < 1000 || area > 10000000` (cm²) silently discards rooms smaller than
  0.1 m² or larger than 1000 m². Worth revisiting: a large open-plan ground floor could
  plausibly approach the upper bound.
- `getRoomPolygon` re-runs `splitWallsAtTJunctions` independently, so it inherits the same
  X-junction blind spot. Any fix must cover both, and the shared splitting step is the
  natural single place to make it.
