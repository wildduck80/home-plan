import type { Project } from '$lib/models/types';
import {
	column,
	door,
	fixtureFloor,
	fixtureProject,
	furniture,
	horizontalWall,
	rectWalls,
	stair,
	verticalWall,
	wall,
	window as fixtureWindow
} from './builders';

/**
 * Golden fixture suite (HP-004).
 *
 * These are permanent regression baselines for geometry and persistence. Each fixture
 * declares the room count and areas its topology *should* produce, derived from the
 * geometry by hand — not captured from current output. Where the detector disagrees, the
 * fixture is the specification and the mismatch is a recorded defect, tracked in
 * `docs/room-detection-matrix.md` and asserted by `tests/geometry/roomDetection.test.ts`.
 *
 * Areas are wall-centreline areas in m², rounded to 2dp to match `detectRooms`.
 */

export interface GoldenExpectation {
	/** Number of enclosed rooms the topology contains. */
	roomCount: number;
	/** Expected room areas in m², sorted ascending. Order-independent by construction. */
	roomAreas: number[];
}

export interface GoldenFixture {
	name: string;
	/** What this fixture is meant to prove. */
	description: string;
	project: Project;
	/** Expectation for the floor under test. */
	expected: GoldenExpectation;
	/** Index of the floor the expectation applies to. */
	floorIndex: number;
}

/** 400 × 300 single rectangular room. The simplest closed topology. */
function simpleRoom(): GoldenFixture {
	return {
		name: 'simple-room',
		description: 'One 400×300 cm rectangle. Baseline sanity check for cycle detection.',
		floorIndex: 0,
		project: fixtureProject('fx-simple-room', 'Simple Room', [
			fixtureFloor('floor-ground', 0, { walls: rectWalls('outer', 0, 0, 400, 300) })
		]),
		expected: { roomCount: 1, roomAreas: [12] }
	};
}

/**
 * Two 300 × 300 rooms sharing one interior wall.
 * Exercises T-junction splitting: the divider's endpoints land mid-span on the north and
 * south walls, so those walls must be split for both faces to be found.
 */
function adjacentTwoRoom(): GoldenFixture {
	return {
		name: 'adjacent-two-room',
		description:
			'600×300 envelope split by one central divider. Two rooms sharing a wall, with ' +
			'T-junctions at both ends of the divider.',
		floorIndex: 0,
		project: fixtureProject('fx-adjacent-two-room', 'Adjacent Two Room', [
			fixtureFloor('floor-ground', 0, {
				walls: [...rectWalls('outer', 0, 0, 600, 300), verticalWall('divider', 300, 0, 300)]
			})
		]),
		expected: { roomCount: 2, roomAreas: [9, 9] }
	};
}

/**
 * L-shaped envelope: 600×300 with a 300×200 wing.
 * Exercises a concave boundary — a non-rectangular single face.
 */
function lShapedHouse(): GoldenFixture {
	const corners = [
		{ x: 0, y: 0 },
		{ x: 600, y: 0 },
		{ x: 600, y: 300 },
		{ x: 300, y: 300 },
		{ x: 300, y: 500 },
		{ x: 0, y: 500 }
	];
	const walls = corners.map((start, i) =>
		wall(`l-${i}`, start, corners[(i + 1) % corners.length])
	);

	return {
		name: 'l-shaped-house',
		description: 'Concave L-shaped envelope (600×300 plus a 300×200 wing). One room, 24 m².',
		floorIndex: 0,
		project: fixtureProject('fx-l-shaped-house', 'L-Shaped House', [
			fixtureFloor('floor-ground', 0, { walls })
		]),
		expected: { roomCount: 1, roomAreas: [24] }
	};
}

/**
 * Central corridor with rooms off it.
 * 800×500 envelope, horizontal walls at y=200 and y=300 forming an 800×100 hallway,
 * and a divider splitting the upper band in two.
 */
function hallwayApartment(): GoldenFixture {
	return {
		name: 'hallway-apartment',
		description:
			'800×500 envelope with an 800×100 central corridor and a divided upper band. ' +
			'Four rooms: two 400×200, one 800×100 corridor, one 800×200.',
		floorIndex: 0,
		project: fixtureProject('fx-hallway-apartment', 'Hallway Apartment', [
			fixtureFloor('floor-ground', 0, {
				walls: [
					...rectWalls('outer', 0, 0, 800, 500),
					horizontalWall('corridor-n', 200, 0, 800),
					horizontalWall('corridor-s', 300, 0, 800),
					verticalWall('upper-divider', 400, 0, 200)
				]
			})
		]),
		expected: { roomCount: 4, roomAreas: [8, 8, 8, 16] }
	};
}

/**
 * Minimal reproduction of the X-junction (crossing walls) defect.
 *
 * A 400×400 envelope with one vertical and one horizontal interior wall crossing at the
 * centre. Both dividers have their *endpoints* on the envelope (T-junctions, handled), but
 * they cross each other mid-span at (200,200) — a point that is no wall's endpoint, so
 * `splitWallsAtTJunctions` never creates a vertex there and the four quadrants are not
 * separated. Smallest topology that isolates the cause of the `ten-room-grid` failure.
 */
function crossingWalls(): GoldenFixture {
	return {
		name: 'crossing-walls',
		description:
			'400×400 envelope with a vertical and a horizontal divider crossing at the centre. ' +
			'Four 200×200 quadrants. Minimal X-junction reproduction.',
		floorIndex: 0,
		project: fixtureProject('fx-crossing-walls', 'Crossing Walls', [
			fixtureFloor('floor-ground', 0, {
				walls: [
					...rectWalls('outer', 0, 0, 400, 400),
					verticalWall('v-mid', 200, 0, 400),
					horizontalWall('h-mid', 200, 0, 400)
				]
			})
		]),
		expected: { roomCount: 4, roomAreas: [4, 4, 4, 4] }
	};
}

/**
 * 5 × 2 grid of 200 × 200 cells inside a 1000 × 400 envelope.
 * Stress case for the PRD's "10+ room grids" requirement.
 */
function tenRoomGrid(): GoldenFixture {
	const verticals = [200, 400, 600, 800].map((x) => verticalWall(`v-${x}`, x, 0, 400));

	return {
		name: 'ten-room-grid',
		description: '1000×400 envelope divided into a 5×2 grid of 200×200 cells. Ten 4 m² rooms.',
		floorIndex: 0,
		project: fixtureProject('fx-ten-room-grid', 'Ten Room Grid', [
			fixtureFloor('floor-ground', 0, {
				walls: [
					...rectWalls('outer', 0, 0, 1000, 400),
					...verticals,
					horizontalWall('h-mid', 200, 0, 1000)
				]
			})
		]),
		expected: { roomCount: 10, roomAreas: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4] }
	};
}

/** Two storeys, each one 400×300 room. Exercises multi-floor persistence and stacking. */
function twoFloorHouse(): GoldenFixture {
	return {
		name: 'two-floor-house',
		description: 'Two storeys, each a single 400×300 room. Ground floor is under test.',
		floorIndex: 0,
		project: fixtureProject('fx-two-floor-house', 'Two Floor House', [
			fixtureFloor('floor-ground', 0, { walls: rectWalls('ground', 0, 0, 400, 300) }),
			fixtureFloor('floor-upper', 1, { walls: rectWalls('upper', 0, 0, 400, 300) })
		]),
		expected: { roomCount: 1, roomAreas: [12] }
	};
}

/** One room containing a stair and two columns. Vertical elements must not affect detection. */
function stairsAndColumns(): GoldenFixture {
	return {
		name: 'stairs-columns',
		description:
			'400×300 room with one stair and two columns. Vertical circulation and structure ' +
			'must round-trip and must not change the detected room.',
		floorIndex: 0,
		project: fixtureProject('fx-stairs-columns', 'Stairs and Columns', [
			fixtureFloor('floor-ground', 0, {
				walls: rectWalls('outer', 0, 0, 400, 300),
				stairs: [stair('stair-main', { x: 320, y: 150 }, { stairType: 'l-shaped' })],
				columns: [
					column('col-round', { x: 120, y: 150 }, { shape: 'round' }),
					column('col-square', { x: 280, y: 150 })
				]
			})
		]),
		expected: { roomCount: 1, roomAreas: [12] }
	};
}

/** One room whose every wall carries openings. Openings must not break the wall graph. */
function openingsHeavy(): GoldenFixture {
	return {
		name: 'openings-heavy',
		description:
			'400×300 room with three doors and four windows spread across all four walls. ' +
			'Openings are wall attachments and must not affect room detection.',
		floorIndex: 0,
		project: fixtureProject('fx-openings-heavy', 'Openings Heavy', [
			fixtureFloor('floor-ground', 0, {
				walls: rectWalls('outer', 0, 0, 400, 300),
				doors: [
					door('door-entry', 'outer-s', 0.5, { type: 'double', width: 160 }),
					door('door-side', 'outer-w', 0.3),
					door('door-slide', 'outer-e', 0.7, { type: 'sliding', swingDirection: 'right' })
				],
				windows: [
					fixtureWindow('win-n1', 'outer-n', 0.25),
					fixtureWindow('win-n2', 'outer-n', 0.75),
					fixtureWindow('win-e', 'outer-e', 0.3, { type: 'casement' }),
					fixtureWindow('win-bay', 'outer-w', 0.7, { type: 'bay', width: 180 })
				]
			})
		]),
		expected: { roomCount: 1, roomAreas: [12] }
	};
}

/**
 * One room densely furnished, including items with per-item physical dimension overrides.
 * Baseline for HP-203 (dimensions authoritative everywhere) and HP-601/602 (collision).
 */
function furnitureHeavy(): GoldenFixture {
	return {
		name: 'furniture-heavy',
		description:
			'400×300 room with six furniture items, four carrying per-item width/depth/height ' +
			'overrides. Two items overlap deliberately, as a collision-detection baseline.',
		floorIndex: 0,
		project: fixtureProject('fx-furniture-heavy', 'Furniture Heavy', [
			fixtureFloor('floor-ground', 0, {
				walls: rectWalls('outer', 0, 0, 400, 300),
				furniture: [
					furniture('fur-bed', 'bed-double', { x: 120, y: 110 }, {
						width: 176,
						depth: 209,
						height: 100
					}),
					furniture('fur-wardrobe', 'wardrobe', { x: 340, y: 80 }, {
						rotation: 90,
						width: 240,
						depth: 60,
						height: 260
					}),
					furniture('fur-desk', 'desk', { x: 320, y: 250 }, { width: 140, depth: 70, height: 75 }),
					furniture('fur-chair', 'chair', { x: 320, y: 200 }),
					// Deliberately overlaps fur-sofa — see HP-602.
					furniture('fur-table', 'coffee-table', { x: 200, y: 250 }, {
						width: 110,
						depth: 60,
						height: 45
					}),
					furniture('fur-sofa', 'sofa-3seat', { x: 210, y: 255 })
				]
			})
		]),
		expected: { roomCount: 1, roomAreas: [12] }
	};
}

/** All golden fixtures, in the order the implementation plan lists them. */
export const goldenFixtures: readonly GoldenFixture[] = [
	simpleRoom(),
	adjacentTwoRoom(),
	lShapedHouse(),
	hallwayApartment(),
	crossingWalls(),
	tenRoomGrid(),
	twoFloorHouse(),
	stairsAndColumns(),
	openingsHeavy(),
	furnitureHeavy()
] as const;

export function getGoldenFixture(name: string): GoldenFixture {
	const fixture = goldenFixtures.find((f) => f.name === name);
	if (!fixture) {
		throw new Error(
			`Unknown golden fixture "${name}". Available: ${goldenFixtures.map((f) => f.name).join(', ')}`
		);
	}
	return fixture;
}
