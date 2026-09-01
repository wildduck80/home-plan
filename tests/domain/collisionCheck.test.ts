import { describe, it, expect } from 'vitest';
import { doorSwingPolygon, findCollisions } from '$lib/domain/collisionCheck';
import { convexPolygonsOverlap, orientedBounds } from '$lib/domain/collision';
import { createFloor } from '$lib/domain/factories';
import type { Door, Floor, FurnitureItem, Wall } from '$lib/models/types';

/**
 * HP-602 / HP-603 / HP-604 — finding fit problems on a floor.
 *
 * Warnings, not constraints: the PRD is explicit that deliberate placement must never be blocked.
 * So the bar for reporting is that a human would agree it is a problem — a wardrobe pushed flush
 * against a wall must stay silent, or the warnings become noise and get ignored.
 */

const catalog: Record<string, { width: number; depth: number; height: number }> = {
	wardrobe: { width: 100, depth: 60, height: 200 },
	bed: { width: 160, depth: 200, height: 50 },
	stool: { width: 40, depth: 40, height: 45 }
};
const lookup = (id: string) => catalog[id];

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
	return {
		id,
		start: { x: x1, y: y1 },
		end: { x: x2, y: y2 },
		thickness: 15,
		height: 280,
		color: '#444'
	};
}

function door(id: string, wallId: string, position: number, overrides: Partial<Door> = {}): Door {
	return {
		id,
		wallId,
		position,
		width: 90,
		height: 210,
		type: 'single',
		swingDirection: 'left',
		flipSide: false,
		...overrides
	};
}

function floorWith(parts: Partial<Floor>): Floor {
	return { ...createFloor({ id: 'f1', level: 0 }), ...parts };
}

describe('doorSwingPolygon', () => {
	const hostWall = wall('w', 0, 0, 400, 0);

	it('produces a convex sector rooted at the hinge', () => {
		const polygon = doorSwingPolygon(door('d', 'w', 0.5), hostWall);

		expect(polygon.length).toBeGreaterThanOrEqual(4);
		// The hinge is one end of the opening, 45cm either side of centre on a 90cm door.
		const hinge = polygon[0];
		expect(Math.abs(hinge.y)).toBeCloseTo(0, 6);
		expect([155, 245]).toContain(Math.round(hinge.x));
	});

	it('sweeps a radius equal to the door width', () => {
		const polygon = doorSwingPolygon(door('d', 'w', 0.5), hostWall);
		const hinge = polygon[0];

		for (const p of polygon.slice(1)) {
			const distance = Math.hypot(p.x - hinge.x, p.y - hinge.y);
			expect(distance).toBeLessThanOrEqual(90 + 0.001);
		}
		// The far edge should actually reach the radius.
		const furthest = Math.max(...polygon.slice(1).map((p) => Math.hypot(p.x - hinge.x, p.y - hinge.y)));
		expect(furthest).toBeCloseTo(90, 3);
	});

	it('swings to opposite sides of the wall when flipped', () => {
		const normal = doorSwingPolygon(door('d', 'w', 0.5, { flipSide: false }), hostWall);
		const flipped = doorSwingPolygon(door('d', 'w', 0.5, { flipSide: true }), hostWall);

		const meanY = (poly: { y: number }[]) => poly.reduce((s, p) => s + p.y, 0) / poly.length;
		expect(Math.sign(meanY(normal))).toBe(-Math.sign(meanY(flipped)));
	});

	it('hinges at opposite ends for left and right swing', () => {
		const left = doorSwingPolygon(door('d', 'w', 0.5, { swingDirection: 'left' }), hostWall);
		const right = doorSwingPolygon(door('d', 'w', 0.5, { swingDirection: 'right' }), hostWall);

		expect(left[0].x).not.toBeCloseTo(right[0].x, 1);
	});

	it('follows the wall angle', () => {
		const diagonal = wall('w', 0, 0, 300, 300);
		const polygon = doorSwingPolygon(door('d', 'w', 0.5), diagonal);

		// The hinge must sit on the wall line, i.e. x == y for this wall.
		expect(polygon[0].x).toBeCloseTo(polygon[0].y, 3);
	});

	it('returns nothing for a doorway with no leaf', () => {
		// An opening with no door cannot foul anything.
		expect(doorSwingPolygon(door('d', 'w', 0.5, { type: 'opening' }), hostWall)).toEqual([]);
	});

	it('returns nothing for a sliding or pocket door', () => {
		expect(doorSwingPolygon(door('d', 'w', 0.5, { type: 'sliding' }), hostWall)).toEqual([]);
		expect(doorSwingPolygon(door('d', 'w', 0.5, { type: 'pocket' }), hostWall)).toEqual([]);
	});
});

describe('findCollisions — furniture against furniture (HP-602)', () => {
	it('reports an overlapping pair once, not twice', () => {
		const floor = floorWith({
			furniture: [furniture('a', 'bed', 0, 0), furniture('b', 'bed', 40, 0)]
		});

		const collisions = findCollisions(floor, lookup).filter((c) => c.kind === 'furniture-furniture');

		expect(collisions).toHaveLength(1);
		expect(collisions[0].ids.sort()).toEqual(['a', 'b']);
	});

	it('stays silent for furniture placed flush', () => {
		// A wardrobe against a bed is a normal arrangement.
		const floor = floorWith({
			furniture: [furniture('bed', 'bed', 0, 0), furniture('w', 'wardrobe', 130, 0)]
		});

		expect(findCollisions(floor, lookup)).toEqual([]);
	});

	it('respects rotation when deciding overlap', () => {
		// Rotated clear of each other, though their bounding boxes intersect.
		const floor = floorWith({
			furniture: [
				furniture('a', 'bed', 0, 0, { rotation: 45 }),
				furniture('b', 'stool', 150, -150)
			]
		});

		expect(findCollisions(floor, lookup)).toEqual([]);
	});

	it('reports how much area overlaps, so severity can be judged', () => {
		const floor = floorWith({
			furniture: [furniture('a', 'bed', 0, 0), furniture('b', 'bed', 40, 0)]
		});

		const [collision] = findCollisions(floor, lookup);

		expect(collision.overlapArea).toBeGreaterThan(0);
	});

	it('ignores an item whose catalog entry is unknown rather than throwing', () => {
        const floor = floorWith({
			furniture: [furniture('a', 'bed', 0, 0), furniture('ghost', 'not-in-catalog', 0, 0)]
		});

		expect(() => findCollisions(floor, lookup)).not.toThrow();
	});

	it('scales to a furniture-heavy floor', () => {
		const many: FurnitureItem[] = [];
		for (let i = 0; i < 300; i++) many.push(furniture(`f${i}`, 'stool', i * 50, 0));
		const floor = floorWith({ furniture: many });

		const started = Date.now();
		findCollisions(floor, lookup);
		expect(Date.now() - started).toBeLessThan(1000);
	});
});

describe('findCollisions — furniture against walls (HP-603)', () => {
	it('reports furniture crossing a wall', () => {
		const floor = floorWith({
			walls: [wall('w', 0, 0, 400, 0)],
			furniture: [furniture('a', 'bed', 200, 0)]
		});

		const collisions = findCollisions(floor, lookup).filter((c) => c.kind === 'furniture-wall');

		expect(collisions).toHaveLength(1);
		expect(collisions[0].ids).toContain('a');
		expect(collisions[0].ids).toContain('w');
	});

	it('stays silent for furniture flush against a wall', () => {
		// Bed depth 200, so its edge sits exactly on the wall at y = -100.
		const floor = floorWith({
			walls: [wall('w', 0, 0, 400, 0)],
			furniture: [furniture('a', 'bed', 200, -100)]
		});

		expect(findCollisions(floor, lookup).filter((c) => c.kind === 'furniture-wall')).toEqual([]);
	});

	it('stays silent for furniture nowhere near a wall', () => {
		const floor = floorWith({
			walls: [wall('w', 0, 0, 400, 0)],
			furniture: [furniture('a', 'stool', 200, -500)]
		});

		expect(findCollisions(floor, lookup)).toEqual([]);
	});
});

describe('findCollisions — door swing (HP-604)', () => {
	it('reports furniture standing in a door swing', () => {
		const floor = floorWith({
			walls: [wall('w', 0, 0, 400, 0)],
			doors: [door('d', 'w', 0.5)],
			// Just inside the swing, clear of the wall itself.
			furniture: [furniture('a', 'stool', 200, -40)]
		});

		const collisions = findCollisions(floor, lookup).filter((c) => c.kind === 'furniture-door');

		expect(collisions).toHaveLength(1);
		expect(collisions[0].ids).toContain('d');
	});

	it('stays silent when furniture is clear of the swing', () => {
		const floor = floorWith({
			walls: [wall('w', 0, 0, 400, 0)],
			doors: [door('d', 'w', 0.5)],
			// Same side, but well beyond the door's reach.
			furniture: [furniture('a', 'stool', 200, -300)]
		});

		expect(findCollisions(floor, lookup).filter((c) => c.kind === 'furniture-door')).toEqual([]);
	});

	it('stays silent when furniture is on the other side of the door', () => {
		const floor = floorWith({
			walls: [wall('w', 0, 0, 400, 0)],
			doors: [door('d', 'w', 0.5, { flipSide: false })],
			furniture: [furniture('a', 'stool', 200, 40)]
		});

		expect(findCollisions(floor, lookup).filter((c) => c.kind === 'furniture-door')).toEqual([]);
	});

	it('never reports a sliding door', () => {
		const floor = floorWith({
			walls: [wall('w', 0, 0, 400, 0)],
			doors: [door('d', 'w', 0.5, { type: 'sliding' })],
			furniture: [furniture('a', 'stool', 200, -40)]
		});

		expect(findCollisions(floor, lookup).filter((c) => c.kind === 'furniture-door')).toEqual([]);
	});

	it('ignores a door whose wall no longer exists', () => {
		const floor = floorWith({ doors: [door('d', 'missing-wall', 0.5)], furniture: [] });

		expect(() => findCollisions(floor, lookup)).not.toThrow();
	});
});

describe('collision messages', () => {
	it('names both parties so the warning is actionable', () => {
		const floor = floorWith({
			furniture: [furniture('a', 'bed', 0, 0), furniture('b', 'wardrobe', 40, 0)]
		});

		const [collision] = findCollisions(floor, lookup);

		// The PRD's example warning names both objects and quotes a figure.
		expect(collision.message.toLowerCase()).toContain('bed');
		expect(collision.message.toLowerCase()).toContain('wardrobe');
	});

	it('describes a door swing clash in those terms', () => {
		const floor = floorWith({
			walls: [wall('w', 0, 0, 400, 0)],
			doors: [door('d', 'w', 0.5)],
			furniture: [furniture('a', 'stool', 200, -40)]
		});

		const [collision] = findCollisions(floor, lookup).filter((c) => c.kind === 'furniture-door');

		expect(collision.message.toLowerCase()).toContain('door');
		expect(collision.message.toLowerCase()).toContain('swing');
	});
});

/** The question the app exists to answer, on a realistic arrangement. */
describe('acceptance: detecting obvious fit problems', () => {
	it('finds the wardrobe blocking the door but not the one beside the bed', () => {
		const floor = floorWith({
			walls: [wall('south', 0, 300, 400, 300), wall('west', 0, 0, 0, 300)],
			// flipSide false swings the leaf inward, into the room — outward would be away from
			// the furniture entirely, which is what an earlier version of this test got wrong.
			doors: [door('entry', 'south', 0.5, { flipSide: false })],
			furniture: [
				furniture('bed', 'bed', 200, 120),
				// Flush beside the bed: fine.
				furniture('bedside', 'stool', 200 + 80 + 20, 120),
				// Standing in the entry swing: a problem.
				furniture('blocker', 'wardrobe', 200, 250)
			]
		});

		const collisions = findCollisions(floor, lookup);
		const blocked = collisions.filter((c) => c.ids.includes('blocker'));

		expect(blocked.length).toBeGreaterThan(0);
		expect(collisions.some((c) => c.ids.includes('bedside'))).toBe(false);
	});
});
