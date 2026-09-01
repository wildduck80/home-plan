import { describe, it, expect } from 'vitest';
import {
	orientedBounds,
	rectCorners,
	rectsOverlap,
	overlapArea,
	pointInRect,
	segmentIntersectsRect,
	type OrientedRect
} from '$lib/domain/collision';
import type { FurnitureItem } from '$lib/models/types';

/**
 * HP-601 / HP-602 — oriented footprints and overlap detection.
 *
 * The PRD calls collision the highest-value differentiator: the app exists to answer "does this
 * fit". Everything downstream — furniture overlap, door swings, clearance zones, honest distance
 * measurement — needs a footprint that respects rotation, which the existing axis-aligned
 * distance overlay does not.
 */

const catalogDef = { id: 'wardrobe', width: 100, depth: 60, height: 200 };

function item(overrides: Partial<FurnitureItem> = {}): FurnitureItem {
	return {
		id: 'f1',
		catalogId: 'wardrobe',
		position: { x: 0, y: 0 },
		rotation: 0,
		scale: { x: 1, y: 1, z: 1 },
		...overrides
	};
}

/** An axis-aligned rect, for readability in tests. */
function rect(x: number, y: number, w: number, d: number, rotation = 0): OrientedRect {
	return { centre: { x, y }, halfWidth: w / 2, halfDepth: d / 2, rotation };
}

describe('orientedBounds', () => {
	it('uses the item\'s resolved physical dimensions', () => {
		const bounds = orientedBounds(item({ width: 240, depth: 65 }), catalogDef);

		expect(bounds.halfWidth).toBe(120);
		expect(bounds.halfDepth).toBe(32.5);
	});

	it('falls back to catalog dimensions', () => {
		const bounds = orientedBounds(item(), catalogDef);

		expect(bounds.halfWidth).toBe(50);
		expect(bounds.halfDepth).toBe(30);
	});

	it('centres on the item position', () => {
		const bounds = orientedBounds(item({ position: { x: 120, y: -40 } }), catalogDef);

		expect(bounds.centre).toEqual({ x: 120, y: -40 });
	});

	it('carries the rotation rather than flattening it', () => {
		// The existing distance overlay reasons in axis-aligned boxes, which is exactly the
		// limitation this replaces.
		expect(orientedBounds(item({ rotation: 37 }), catalogDef).rotation).toBe(37);
	});

	it('accounts for item scale', () => {
		const bounds = orientedBounds(item({ scale: { x: 2, y: 0.5, z: 1 } }), catalogDef);

		expect(bounds.halfWidth).toBe(100);
		expect(bounds.halfDepth).toBe(15);
	});
});

describe('rectCorners', () => {
	it('returns four corners for an unrotated rect', () => {
		const corners = rectCorners(rect(0, 0, 100, 60));

		expect(corners).toHaveLength(4);
		const xs = corners.map((c) => c.x).sort((a, b) => a - b);
		const ys = corners.map((c) => c.y).sort((a, b) => a - b);
		expect(xs[0]).toBeCloseTo(-50, 6);
		expect(xs[3]).toBeCloseTo(50, 6);
		expect(ys[0]).toBeCloseTo(-30, 6);
		expect(ys[3]).toBeCloseTo(30, 6);
	});

	it('rotates the corners about the centre', () => {
		const corners = rectCorners(rect(0, 0, 100, 60, 90));

		// A 90 degree turn swaps the extents.
		const xs = corners.map((c) => c.x);
		const ys = corners.map((c) => c.y);
		expect(Math.max(...xs)).toBeCloseTo(30, 6);
		expect(Math.max(...ys)).toBeCloseTo(50, 6);
	});

	it('preserves the centre under rotation', () => {
		const corners = rectCorners(rect(10, 20, 100, 60, 33));
		const cx = corners.reduce((sum, c) => sum + c.x, 0) / 4;
		const cy = corners.reduce((sum, c) => sum + c.y, 0) / 4;

		expect(cx).toBeCloseTo(10, 6);
		expect(cy).toBeCloseTo(20, 6);
	});
});

describe('rectsOverlap — axis-aligned', () => {
	it('detects a clear overlap', () => {
		expect(rectsOverlap(rect(0, 0, 100, 100), rect(50, 0, 100, 100))).toBe(true);
	});

	it('reports no overlap when clearly apart', () => {
		expect(rectsOverlap(rect(0, 0, 100, 100), rect(300, 0, 100, 100))).toBe(false);
	});

	it('does not treat touching edges as overlapping', () => {
		// Two wardrobes pushed against each other are a legitimate arrangement, not a collision.
		expect(rectsOverlap(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBe(false);
	});

	it('does not treat touching corners as overlapping', () => {
		expect(rectsOverlap(rect(0, 0, 100, 100), rect(100, 100, 100, 100))).toBe(false);
	});

	it('detects containment', () => {
		expect(rectsOverlap(rect(0, 0, 200, 200), rect(0, 0, 50, 50))).toBe(true);
	});

	it('is symmetric', () => {
		const a = rect(0, 0, 100, 60);
		const b = rect(40, 10, 80, 80);

		expect(rectsOverlap(a, b)).toBe(rectsOverlap(b, a));
	});
});

describe('rectsOverlap — rotated', () => {
	it('detects an overlap only a rotated test would find', () => {
		// Axis-aligned boxes would report these as overlapping; rotated, they miss each other.
		const a = rect(0, 0, 200, 20, 45);
		const b = rect(0, 90, 200, 20, 45);

		expect(rectsOverlap(a, b)).toBe(false);
	});

	it('detects a genuine rotated overlap', () => {
		const a = rect(0, 0, 200, 20, 45);
		const b = rect(0, 0, 200, 20, -45);

		// Two diagonals crossing at the centre.
		expect(rectsOverlap(a, b)).toBe(true);
	});

	it('separates a rotated pair that an axis-aligned test would call a collision', () => {
		// A long thin item at 45 degrees, and another just clear of its true footprint but
		// inside its bounding box.
		const diagonal = rect(0, 0, 400, 20, 45);
		const corner = rect(130, -130, 40, 40);

		expect(rectsOverlap(diagonal, corner)).toBe(false);
	});

	it('handles a rotation of 180 as equivalent to 0', () => {
		const a = rect(0, 0, 100, 60, 0);
		const b = rect(0, 0, 100, 60, 180);

		expect(rectsOverlap(a, b)).toBe(true);
	});

	it('is symmetric for rotated rects', () => {
		const a = rect(0, 0, 150, 40, 23);
		const b = rect(60, 30, 90, 90, -50);

		expect(rectsOverlap(a, b)).toBe(rectsOverlap(b, a));
	});
});

describe('overlapArea', () => {
	it('is zero for separated rects', () => {
		expect(overlapArea(rect(0, 0, 100, 100), rect(300, 0, 100, 100))).toBe(0);
	});

	it('is zero for touching rects', () => {
		expect(overlapArea(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBeCloseTo(0, 6);
	});

	it('measures a simple axis-aligned overlap', () => {
		// 100x100 boxes offset by 50 in x: overlap is 50 x 100.
		expect(overlapArea(rect(0, 0, 100, 100), rect(50, 0, 100, 100))).toBeCloseTo(5000, 0);
	});

	it('measures containment as the smaller area', () => {
		expect(overlapArea(rect(0, 0, 200, 200), rect(0, 0, 50, 40))).toBeCloseTo(2000, 0);
	});

	it('grows as two items are pushed further into each other', () => {
		const a = rect(0, 0, 100, 100);
		const slight = overlapArea(a, rect(90, 0, 100, 100));
		const deep = overlapArea(a, rect(40, 0, 100, 100));

		expect(deep).toBeGreaterThan(slight);
	});

	it('handles rotated overlap without returning nonsense', () => {
		const area = overlapArea(rect(0, 0, 200, 20, 45), rect(0, 0, 200, 20, -45));

		expect(area).toBeGreaterThan(0);
		// Cannot exceed the smaller rect's own area.
		expect(area).toBeLessThanOrEqual(200 * 20 + 1);
	});
});

describe('pointInRect', () => {
	it('accepts a point inside', () => {
		expect(pointInRect({ x: 10, y: 10 }, rect(0, 0, 100, 100))).toBe(true);
	});

	it('rejects a point outside', () => {
		expect(pointInRect({ x: 200, y: 0 }, rect(0, 0, 100, 100))).toBe(false);
	});

	it('respects rotation', () => {
		// Just outside a rotated thin rect, but inside its axis-aligned bounding box.
		const diagonal = rect(0, 0, 400, 20, 45);

		expect(pointInRect({ x: 100, y: -100 }, diagonal)).toBe(false);
		expect(pointInRect({ x: 100, y: 100 }, diagonal)).toBe(true);
	});
});

describe('segmentIntersectsRect', () => {
	it('detects a segment crossing the rect', () => {
		expect(
			segmentIntersectsRect({ x: -200, y: 0 }, { x: 200, y: 0 }, rect(0, 0, 100, 100))
		).toBe(true);
	});

	it('detects a segment fully inside', () => {
		expect(segmentIntersectsRect({ x: -10, y: 0 }, { x: 10, y: 0 }, rect(0, 0, 100, 100))).toBe(
			true
		);
	});

	it('reports no intersection for a segment clear of the rect', () => {
		expect(
			segmentIntersectsRect({ x: -200, y: 300 }, { x: 200, y: 300 }, rect(0, 0, 100, 100))
		).toBe(false);
	});

	it('does not count a segment merely touching an edge', () => {
		// A wardrobe flush against a wall is normal, not a collision.
		expect(
			segmentIntersectsRect({ x: -200, y: 50 }, { x: 200, y: 50 }, rect(0, 0, 100, 100))
		).toBe(false);
	});

	it('respects rect rotation', () => {
		const diagonal = rect(0, 0, 400, 20, 45);

		// Along the diagonal: intersects. Across the empty corner: does not.
		expect(segmentIntersectsRect({ x: -100, y: -100 }, { x: 100, y: 100 }, diagonal)).toBe(true);
		expect(segmentIntersectsRect({ x: 60, y: -140 }, { x: 140, y: -60 }, diagonal)).toBe(false);
	});
});

/** The question the app exists to answer. */
describe('acceptance: does the wardrobe fit', () => {
	it('flags a wardrobe overlapping a bed', () => {
		const bed = orientedBounds(
			item({ id: 'bed', position: { x: 100, y: 100 }, width: 176, depth: 209 }),
			catalogDef
		);
		const wardrobe = orientedBounds(
			item({ id: 'w', position: { x: 200, y: 150 }, width: 240, depth: 60, rotation: 90 }),
			catalogDef
		);

		expect(rectsOverlap(bed, wardrobe)).toBe(true);
		expect(overlapArea(bed, wardrobe)).toBeGreaterThan(0);
	});

	it('accepts a wardrobe placed flush alongside a bed', () => {
		const bed = orientedBounds(item({ position: { x: 0, y: 0 }, width: 160, depth: 200 }), catalogDef);
		// Immediately to the right of the bed, touching but not overlapping.
		const wardrobe = orientedBounds(
			item({ position: { x: 80 + 30, y: 0 }, width: 60, depth: 200 }),
			catalogDef
		);

		expect(rectsOverlap(bed, wardrobe)).toBe(false);
	});
});
