import { describe, it, expect } from 'vitest';
import { detectRooms, getRoomPolygon } from '$lib/utils/roomDetection';
import { goldenFixtures, getGoldenFixture, type GoldenFixture } from '../fixtures/golden';

/**
 * HP-201 (verification) and HP-202 (hardening) — room detection against the golden suite.
 *
 * Every fixture now passes. Two did not when this suite was first written: `crossing-walls`
 * returned zero rooms and `ten-room-grid` returned 4 rooms of [8, 8, 8, 16] m² instead of 10
 * of 4 m². Both stemmed from wall splitting only happening at *endpoints* landing on a wall
 * interior, never at true mid-span crossings — so X-junctions produced no graph vertex and
 * the faces either side were never separated. Fixed by the second pass in
 * `splitWallsAtJunctions`; see docs/room-detection-matrix.md.
 *
 * There are deliberately no exemptions in this suite: a fixture either meets its declared
 * expectation or the build is red.
 */

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
	describe.each(goldenFixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
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

	it('splits X-junctions so crossing walls separate all four quadrants', () => {
		const fixture = getGoldenFixture('crossing-walls');
		const rooms = detectRooms(fixture.project.floors[0].walls);

		expect(rooms).toHaveLength(4);
		expect(rooms.map((r) => r.area)).toEqual([4, 4, 4, 4]);
		// Both crossing dividers must be shared by more than one quadrant.
		for (const dividerId of ['v-mid', 'h-mid']) {
			const claimants = rooms.filter((r) => r.walls.includes(dividerId));
			expect(claimants.length, `${dividerId} claimants`).toBeGreaterThan(1);
		}
	});

	it('scales X-junction handling to a 5x2 grid', () => {
		const fixture = getGoldenFixture('ten-room-grid');
		const rooms = detectRooms(fixture.project.floors[0].walls);

		expect(rooms).toHaveLength(10);
		expect(rooms.every((r) => r.area === 4)).toBe(true);
	});

	it('does not split parallel or collinear walls', () => {
		// Two rooms side by side with a shared *collinear* run of walls, no crossings.
		const fixture = getGoldenFixture('adjacent-two-room');
		const rooms = detectRooms(fixture.project.floors[0].walls);

		// Spurious splitting of the parallel north/south walls would fragment these faces.
		expect(rooms).toHaveLength(2);
	});

	it('treats a crossing that lands on an endpoint as a T-junction, not a double split', () => {
		// A cross whose horizontal arm terminates exactly at the vertical wall: the meeting
		// point is an endpoint, so only the T-junction pass should act on it.
		const walls = [
			...getGoldenFixture('simple-room').project.floors[0].walls,
			{ id: 'v', start: { x: 200, y: 0 }, end: { x: 200, y: 300 }, thickness: 15, height: 280, color: '#444' }
		];

		const rooms = detectRooms(walls);

		expect(rooms).toHaveLength(2);
		expect(rooms.map((r) => r.area).sort()).toEqual([6, 6]);
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
