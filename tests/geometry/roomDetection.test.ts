import { describe, it, expect } from 'vitest';
import { detectRooms, getRoomPolygon } from '$lib/utils/roomDetection';
import { goldenFixtures, getGoldenFixture, type GoldenFixture } from '../fixtures/golden';

/**
 * HP-201 — verify room detection against the golden fixture suite.
 *
 * This is a *verification* suite, not a fix: its job is to state precisely which
 * topologies the current detector gets right and which it gets wrong, so HP-202 can be
 * scoped from evidence rather than from the historical bug report.
 *
 * Cases the detector currently fails are declared in `KNOWN_FAILURES` and asserted with
 * `it.fails`, which passes only while the case is genuinely broken. Fixing the detector
 * therefore turns those tests red, forcing the list — and
 * `docs/room-detection-matrix.md` — to be updated. No defect can be quietly fixed or
 * quietly regress.
 */

/**
 * Root cause (shared by both entries): `splitWallsAtTJunctions` splits a wall only where
 * *another wall's endpoint* lands on its interior. Two walls that cross mid-span create no
 * vertex at their intersection, so the faces on either side are never separated.
 * See docs/room-detection-matrix.md.
 */
const KNOWN_FAILURES: Readonly<Record<string, string>> = {
	'crossing-walls': 'X-junctions are not split — detects 0 rooms instead of 4 of 4 m²',
	'ten-room-grid':
		'X-junctions are not split — detects 4 rooms of [8, 8, 8, 16] m² instead of 10 of 4 m²'
};

function detectedAreas(fixture: GoldenFixture): number[] {
	const floor = fixture.project.floors[fixture.floorIndex];
	return detectRooms(floor.walls)
		.map((room) => room.area)
		.sort((a, b) => a - b);
}

function detectedCount(fixture: GoldenFixture): number {
	const floor = fixture.project.floors[fixture.floorIndex];
	return detectRooms(floor.walls).length;
}

describe('room detection — golden fixtures', () => {
	const passing = goldenFixtures.filter((f) => !(f.name in KNOWN_FAILURES));
	const failing = goldenFixtures.filter((f) => f.name in KNOWN_FAILURES);

	it('covers every fixture in exactly one of the two groups', () => {
		expect(passing.length + failing.length).toBe(goldenFixtures.length);
		// Guard against a typo in KNOWN_FAILURES silently exempting nothing.
		for (const name of Object.keys(KNOWN_FAILURES)) {
			expect(goldenFixtures.map((f) => f.name)).toContain(name);
		}
	});

	describe.each(passing.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
		it('detects the expected number of rooms', () => {
			expect(detectedCount(fixture)).toBe(fixture.expected.roomCount);
		});

		it('detects the expected room areas', () => {
			expect(detectedAreas(fixture)).toEqual(fixture.expected.roomAreas);
		});

		it('returns a closed polygon of at least 3 vertices for every room', () => {
			const floor = fixture.project.floors[fixture.floorIndex];
			const rooms = detectRooms(floor.walls);

			for (const room of rooms) {
				const polygon = getRoomPolygon(room, floor.walls);
				expect(polygon.length, `room ${room.id} polygon`).toBeGreaterThanOrEqual(3);
			}
		});

		it('attributes every room only to walls that exist on the floor', () => {
			const floor = fixture.project.floors[fixture.floorIndex];
			const wallIds = new Set(floor.walls.map((w) => w.id));

			for (const room of detectRooms(floor.walls)) {
				expect(room.walls.length).toBeGreaterThan(0);
				for (const id of room.walls) {
					expect(wallIds, `room ${room.id} references unknown wall ${id}`).toContain(id);
				}
			}
		});

		it('does not emit a duplicate outer-boundary room', () => {
			const floor = fixture.project.floors[fixture.floorIndex];
			const areas = detectedAreas(fixture);
			const envelopeArea = fixture.expected.roomAreas.reduce((a, b) => a + b, 0);

			// A spurious outer face would show up as a room covering the whole envelope
			// alongside the real subdivisions.
			if (fixture.expected.roomCount > 1) {
				expect(areas).not.toContain(envelopeArea);
			}
			expect(detectRooms(floor.walls).length).toBe(fixture.expected.roomCount);
		});

		it('is deterministic across repeated runs', () => {
			expect(detectedAreas(fixture)).toEqual(detectedAreas(fixture));
		});
	});

	describe.each(failing.map((f) => [f.name, f] as const))(
		'%s (known defect — HP-202)',
		(name, fixture) => {
			it(`is documented: ${KNOWN_FAILURES[name]}`, () => {
				expect(KNOWN_FAILURES[name]).toBeTruthy();
			});

			it.fails('detects the expected number of rooms', () => {
				expect(detectedCount(fixture)).toBe(fixture.expected.roomCount);
			});

			it.fails('detects the expected room areas', () => {
				expect(detectedAreas(fixture)).toEqual(fixture.expected.roomAreas);
			});

			// Pin the exact wrong answer so HP-202 progress is measurable and any *change*
			// in the defect (rather than a fix) is caught.
			it('produces the currently recorded wrong result', () => {
				const actual = { count: detectedCount(fixture), areas: detectedAreas(fixture) };

				if (name === 'crossing-walls') {
					expect(actual).toEqual({ count: 0, areas: [] });
				} else {
					expect(actual).toEqual({ count: 4, areas: [8, 8, 8, 16] });
				}
			});
		}
	);
});

describe('room detection — regression characteristics', () => {
	it('returns no rooms for fewer than three walls', () => {
		const { walls } = getGoldenFixture('simple-room').project.floors[0];

		expect(detectRooms([])).toEqual([]);
		expect(detectRooms(walls.slice(0, 2))).toEqual([]);
	});

	it('returns no rooms for an unclosed boundary', () => {
		const { walls } = getGoldenFixture('simple-room').project.floors[0];

		// Three of four walls: an open U cannot enclose anything.
		expect(detectRooms(walls.slice(0, 3))).toEqual([]);
	});

	it('closes small endpoint gaps within the 5 cm snap tolerance', () => {
		const { walls } = getGoldenFixture('simple-room').project.floors[0];
		// Pull the west wall 3 cm short of the north-west corner — inside tolerance.
		const gapped = walls.map((w) =>
			w.id === 'outer-w' ? { ...w, end: { x: 0, y: 3 } } : w
		);

		expect(detectRooms(gapped)).toHaveLength(1);
	});

	it('splits T-junctions so two rooms can share one wall', () => {
		const fixture = getGoldenFixture('adjacent-two-room');
		const rooms = detectRooms(fixture.project.floors[0].walls);

		expect(rooms).toHaveLength(2);
		// Both rooms must claim the shared divider.
		expect(rooms.every((r) => r.walls.includes('divider'))).toBe(true);
	});

	it('ignores openings, furniture, stairs and columns entirely', () => {
		// Detection takes only walls, so these fixtures must all match plain simple-room.
		const baseline = detectedAreas(getGoldenFixture('simple-room'));

		for (const name of ['openings-heavy', 'furniture-heavy', 'stairs-columns']) {
			expect(detectedAreas(getGoldenFixture(name)), name).toEqual(baseline);
		}
	});

	/**
	 * Recorded current behaviour, not an endorsement: `detectRooms` mints
	 * `room-N-${Date.now()}` ids on every call, so recalculation cannot preserve
	 * room identity or the user's room names and materials. HP-202's acceptance
	 * criteria require fixing this; this test pins the status quo so the change is visible.
	 */
	it('currently generates fresh room ids on every recalculation', () => {
		const { walls } = getGoldenFixture('simple-room').project.floors[0];

		const first = detectRooms(walls)[0].id;
		const second = detectRooms(walls)[0].id;

		expect(first).toMatch(/^room-\d+-\d+$/);
		expect(second).toMatch(/^room-\d+-\d+$/);
		// Same index, so ids collide only because Date.now() has not ticked; the point is
		// that identity is derived from wall order and the clock, never from the geometry.
		expect(detectRooms(walls)[0].name).toBe('Room 1');
		expect(second.startsWith('room-1-')).toBe(true);
	});
});
