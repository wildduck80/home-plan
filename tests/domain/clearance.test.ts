import { describe, it, expect } from 'vitest';
import {
	CLEARANCE_RULES,
	clearanceRuleFor,
	clearanceZone,
	findClearanceIssues,
	nearestDistances,
	polygonDistance
} from '$lib/domain/clearance';
import { orientedBounds, rectCorners, type OrientedRect } from '$lib/domain/collision';
import { createFloor } from '$lib/domain/factories';
import type { Floor, FurnitureItem, Wall } from '$lib/models/types';

/**
 * HP-403 / HP-605 / HP-606 — distances and clearance.
 *
 * "These do not overlap" is a weak answer. What matters is whether you can walk past the bed and
 * open the wardrobe, which needs real distances between rotated shapes and a notion of the space
 * a piece of furniture needs in front of it.
 */

const catalog: Record<string, { width: number; depth: number; height: number; category?: string }> = {
	wardrobe: { width: 120, depth: 60, height: 200, category: 'Bedroom' },
	bed_queen: { width: 200, depth: 150, height: 50, category: 'Bedroom' },
	chair_dining: { width: 45, depth: 50, height: 90, category: 'Dining' },
	stool: { width: 40, depth: 40, height: 45, category: 'Living Room' }
};
const lookup = (id: string) => catalog[id];

function rect(x: number, y: number, w: number, d: number, rotation = 0): OrientedRect {
	return { centre: { x, y }, halfWidth: w / 2, halfDepth: d / 2, rotation };
}

function furniture(
	id: string,
	catalogId: string,
	x: number,
	y: number,
	overrides: Partial<FurnitureItem> = {}
): FurnitureItem {
	return {
		id,
		catalogId,
		position: { x, y },
		rotation: 0,
		scale: { x: 1, y: 1, z: 1 },
		...overrides
	};
}

function wall(id: string, x1: number, y1: number, x2: number, y2: number): Wall {
	return { id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 15, height: 280, color: '#444' };
}

function floorWith(parts: Partial<Floor>): Floor {
	return { ...createFloor({ id: 'f1', level: 0 }), ...parts };
}

describe('polygonDistance', () => {
	it('is zero for overlapping shapes', () => {
		expect(polygonDistance(rectCorners(rect(0, 0, 100, 100)), rectCorners(rect(50, 0, 100, 100)))).toBe(0);
	});

	it('is zero for touching shapes', () => {
		expect(polygonDistance(rectCorners(rect(0, 0, 100, 100)), rectCorners(rect(100, 0, 100, 100)))).toBeCloseTo(0, 6);
	});

	it('measures a face-to-face gap', () => {
		// 100-wide boxes centred 200 apart: 100 of gap between facing edges.
		expect(polygonDistance(rectCorners(rect(0, 0, 100, 100)), rectCorners(rect(200, 0, 100, 100)))).toBeCloseTo(100, 6);
	});

	it('measures a corner-to-corner gap', () => {
		const a = rectCorners(rect(0, 0, 100, 100));
		const b = rectCorners(rect(200, 200, 100, 100));

		// Corners at (50,50) and (150,150): diagonal gap.
		expect(polygonDistance(a, b)).toBeCloseTo(Math.hypot(100, 100), 6);
	});

	it('respects rotation', () => {
		// A diamond's nearest point is its vertex, closer than its bounding box would suggest.
		const diamond = rectCorners(rect(0, 0, 100, 100, 45));
		const box = rectCorners(rect(200, 0, 100, 100));
		const halfDiagonal = Math.hypot(50, 50);

		expect(polygonDistance(diamond, box)).toBeCloseTo(150 - halfDiagonal, 5);
	});

	it('is symmetric', () => {
		const a = rectCorners(rect(0, 0, 90, 40, 15));
		const b = rectCorners(rect(300, 120, 60, 60, -35));

		expect(polygonDistance(a, b)).toBeCloseTo(polygonDistance(b, a), 9);
	});
});

describe('nearestDistances', () => {
	const floor = floorWith({
		// 400 x 300 room.
		walls: [
			wall('n', 0, 0, 400, 0),
			wall('e', 400, 0, 400, 300),
			wall('s', 400, 300, 0, 300),
			wall('w', 0, 300, 0, 0)
		],
		furniture: [
			furniture('bed', 'bed_queen', 200, 100),
			furniture('stool', 'stool', 200, 250)
		]
	});

	it('reports the nearest wall with its distance', () => {
		const result = nearestDistances(floor, 'bed', lookup);

		expect(result).not.toBeNull();
		expect(result!.nearestWall).not.toBeNull();
		// Bed is 200x150 centred at (200,100): top edge at y=25, so the north wall is 25 away.
		expect(result!.nearestWall!.distance).toBeCloseTo(25, 5);
		expect(result!.nearestWall!.id).toBe('n');
	});

	it('reports the nearest other furniture', () => {
		const result = nearestDistances(floor, 'bed', lookup);

		// Bed bottom edge at y=175, stool top edge at y=230: 55 apart.
		expect(result!.nearestFurniture!.id).toBe('stool');
		expect(result!.nearestFurniture!.distance).toBeCloseTo(55, 5);
	});

	it('returns the closest points, so the distance can be drawn', () => {
		const result = nearestDistances(floor, 'bed', lookup);
		const pair = result!.nearestFurniture!;

		expect(pair.from).toBeDefined();
		expect(pair.to).toBeDefined();
		expect(Math.hypot(pair.to.x - pair.from.x, pair.to.y - pair.from.y)).toBeCloseTo(
			pair.distance,
			5
		);
	});

	it('agrees with a straight measurement between the same two points', () => {
		// HP-403 requires the overlay to agree with the manual measure tool.
		const result = nearestDistances(floor, 'stool', lookup);
		const pair = result!.nearestFurniture!;
		const manual = Math.hypot(pair.to.x - pair.from.x, pair.to.y - pair.from.y);

		expect(manual).toBeCloseTo(pair.distance, 6);
	});

	it('excludes the selected item from its own comparison', () => {
		const result = nearestDistances(floor, 'bed', lookup);

		expect(result!.nearestFurniture!.id).not.toBe('bed');
	});

	it('returns null for an unknown selection', () => {
		expect(nearestDistances(floor, 'nope', lookup)).toBeNull();
	});

	it('handles a floor with nothing else on it', () => {
		const lonely = floorWith({ furniture: [furniture('only', 'stool', 0, 0)] });

		const result = nearestDistances(lonely, 'only', lookup);

		expect(result!.nearestWall).toBeNull();
		expect(result!.nearestFurniture).toBeNull();
	});

	it('reports zero distance when items already overlap', () => {
		const overlapping = floorWith({
			furniture: [furniture('a', 'bed_queen', 0, 0), furniture('b', 'bed_queen', 20, 0)]
		});

		expect(nearestDistances(overlapping, 'a', lookup)!.nearestFurniture!.distance).toBe(0);
	});
});

describe('clearanceZone', () => {
	it('projects a zone in front of the item', () => {
		// Front is the local +depth face. Unrotated, that is downward in screen coordinates.
		const zone = clearanceZone(rect(0, 0, 120, 60), 90);

		const ys = zone.map((p) => p.y);
		expect(Math.min(...ys)).toBeCloseTo(30, 5);
		expect(Math.max(...ys)).toBeCloseTo(120, 5);
	});

	it('matches the item width', () => {
		const zone = clearanceZone(rect(0, 0, 120, 60), 90);
		const xs = zone.map((p) => p.x);

		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120, 5);
	});

	it('rotates with the item', () => {
		const zone = clearanceZone(rect(0, 0, 120, 60, 90), 90);

		// Rotated a quarter turn, the zone extends along -x.
		const xs = zone.map((p) => p.x);
		expect(Math.min(...xs)).toBeCloseTo(-120, 5);
	});

	it('is empty for a non-positive depth', () => {
		expect(clearanceZone(rect(0, 0, 120, 60), 0)).toEqual([]);
	});
});

describe('clearanceRuleFor', () => {
	it('gives a wardrobe a door-opening clearance', () => {
		const rule = clearanceRuleFor('wardrobe', catalog.wardrobe);

		expect(rule).not.toBeNull();
		expect(rule!.depthCm).toBe(90);
	});

	it('gives a dining chair a pull-out clearance', () => {
		expect(clearanceRuleFor('chair_dining', catalog.chair_dining)!.depthCm).toBe(75);
	});

	it('gives a bed side circulation', () => {
		expect(clearanceRuleFor('bed_queen', catalog.bed_queen)!.depthCm).toBe(60);
	});

	it('gives ordinary furniture no rule', () => {
		// Everything having a clearance rule would make the feature noise.
		expect(clearanceRuleFor('stool', catalog.stool)).toBeNull();
	});

	it('exposes the presets the PRD lists', () => {
		const depths = CLEARANCE_RULES.map((r) => r.depthCm);

		expect(depths).toContain(60);
		expect(depths).toContain(75);
		expect(depths).toContain(90);
		expect(depths).toContain(100);
	});
});

describe('findClearanceIssues', () => {
	it('flags a wardrobe whose opening is blocked', () => {
		const floor = floorWith({
			furniture: [
				furniture('w', 'wardrobe', 200, 100),
				// Directly in front, well inside the 90cm opening zone.
				furniture('blocker', 'stool', 200, 160)
			]
		});

		const issues = findClearanceIssues(floor, lookup);

		expect(issues).toHaveLength(1);
		expect(issues[0].ids).toContain('w');
		expect(issues[0].ids).toContain('blocker');
		expect(issues[0].message.toLowerCase()).toContain('90');
	});

	it('stays quiet when the clearance is respected', () => {
		const floor = floorWith({
			furniture: [
				furniture('w', 'wardrobe', 200, 100),
				// Beyond the 90cm zone: wardrobe front at y=130, zone ends at 220.
				furniture('clear', 'stool', 200, 260)
			]
		});

		expect(findClearanceIssues(floor, lookup)).toEqual([]);
	});

	it('flags a wall standing in a clearance zone', () => {
		const floor = floorWith({
			walls: [wall('front', 0, 160, 400, 160)],
			furniture: [furniture('w', 'wardrobe', 200, 100)]
		});

		const issues = findClearanceIssues(floor, lookup);

		expect(issues).toHaveLength(1);
		expect(issues[0].ids).toContain('front');
	});

	it('does not flag the wall the item is backed against', () => {
		// A wardrobe against the wall behind it is exactly how wardrobes are placed.
		const floor = floorWith({
			walls: [wall('behind', 0, 70, 400, 70)],
			furniture: [furniture('w', 'wardrobe', 200, 100)]
		});

		expect(findClearanceIssues(floor, lookup)).toEqual([]);
	});

	it('gives items with no rule no issues', () => {
		const floor = floorWith({
			furniture: [furniture('a', 'stool', 0, 0), furniture('b', 'stool', 45, 0)]
		});

		expect(findClearanceIssues(floor, lookup)).toEqual([]);
	});

	it('reports the clearance actually available, not just that it failed', () => {
		const floor = floorWith({
			furniture: [furniture('w', 'wardrobe', 200, 100), furniture('blocker', 'stool', 200, 180)]
		});

		const [issue] = findClearanceIssues(floor, lookup);

		// Wardrobe front at y=130, blocker near edge at y=160: 30cm available of 90 needed.
		expect(issue.availableCm).toBeCloseTo(30, 0);
	});
});

/** What the feature is for. */
describe('acceptance: can you open the wardrobe', () => {
	it('accepts a bedroom with adequate circulation and rejects one without', () => {
		const roomy = floorWith({
			furniture: [furniture('w', 'wardrobe', 200, 60), furniture('bed', 'bed_queen', 200, 260)]
		});
		const cramped = floorWith({
			furniture: [furniture('w', 'wardrobe', 200, 60), furniture('bed', 'bed_queen', 200, 175)]
		});

		expect(findClearanceIssues(roomy, lookup)).toEqual([]);
		expect(findClearanceIssues(cramped, lookup).length).toBeGreaterThan(0);
	});
});
