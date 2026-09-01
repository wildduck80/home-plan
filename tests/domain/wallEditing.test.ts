import { describe, it, expect } from 'vitest';
import {
	openingOffsets,
	positionForOffset,
	resizeWallToLength,
	wallLength,
	type LengthAnchor
} from '$lib/domain/wallEditing';
import type { Wall } from '$lib/models/types';

/**
 * HP-401 / HP-402 — entering exact architectural dimensions.
 *
 * Slice B's exit criterion is that a real floor can be traced and then given exact dimensions.
 * These are the two operations that make that possible: resizing a wall to a stated length, and
 * placing an opening at a stated offset.
 */

function wall(overrides: Partial<Wall> = {}): Wall {
	return {
		id: 'w1',
		start: { x: 0, y: 0 },
		end: { x: 400, y: 0 },
		thickness: 15,
		height: 280,
		color: '#444',
		...overrides
	};
}

describe('wallLength', () => {
	it('measures a horizontal wall', () => {
		expect(wallLength(wall())).toBe(400);
	});

	it('measures a diagonal wall', () => {
		expect(wallLength(wall({ end: { x: 300, y: 400 } }))).toBe(500);
	});
});

describe('resizeWallToLength — anchors', () => {
	it('keeps the start fixed and moves the end', () => {
		const result = resizeWallToLength(wall(), 500, 'start');

		expect(result.start).toEqual({ x: 0, y: 0 });
		expect(result.end.x).toBeCloseTo(500, 6);
		expect(result.end.y).toBeCloseTo(0, 6);
	});

	it('keeps the end fixed and moves the start', () => {
		const result = resizeWallToLength(wall(), 500, 'end');

		expect(result.end).toEqual({ x: 400, y: 0 });
		expect(result.start.x).toBeCloseTo(-100, 6);
		expect(result.start.y).toBeCloseTo(0, 6);
	});

	it('keeps the centre fixed and moves both ends', () => {
		const result = resizeWallToLength(wall(), 500, 'center');

		// Original centre is (200, 0); it must not move.
		expect((result.start.x + result.end.x) / 2).toBeCloseTo(200, 6);
		expect(result.start.x).toBeCloseTo(-50, 6);
		expect(result.end.x).toBeCloseTo(450, 6);
	});

	it.each<LengthAnchor>(['start', 'center', 'end'])(
		'produces exactly the requested length with anchor %s',
		(anchor) => {
			const result = resizeWallToLength(wall({ end: { x: 300, y: 400 } }), 250, anchor);

			expect(wallLength({ ...wall(), ...result })).toBeCloseTo(250, 6);
		}
	);

	it('preserves the wall angle', () => {
		const original = wall({ end: { x: 300, y: 400 } });
		const angleBefore = Math.atan2(400, 300);

		const result = resizeWallToLength(original, 1000, 'start');
		const angleAfter = Math.atan2(result.end.y - result.start.y, result.end.x - result.start.x);

		expect(angleAfter).toBeCloseTo(angleBefore, 6);
	});

	it('scales a curve control point with the wall', () => {
		const curved = wall({ curvePoint: { x: 200, y: 50 } });

		const result = resizeWallToLength(curved, 800, 'start');

		// The control point must follow, or a curved wall would straighten unexpectedly.
		expect(result.curvePoint).toBeDefined();
		expect(result.curvePoint!.x).toBeCloseTo(400, 6);
		expect(result.curvePoint!.y).toBeCloseTo(100, 6);
	});

	it('omits the curve point when the wall has none', () => {
		expect(resizeWallToLength(wall(), 500, 'start').curvePoint).toBeUndefined();
	});

	it('is reversible — resizing back returns the original geometry', () => {
		const original = wall({ end: { x: 300, y: 400 } });

		const grown = resizeWallToLength(original, 900, 'center');
		const shrunk = resizeWallToLength({ ...original, ...grown }, 500, 'center');

		expect(shrunk.start.x).toBeCloseTo(original.start.x, 6);
		expect(shrunk.start.y).toBeCloseTo(original.start.y, 6);
		expect(shrunk.end.x).toBeCloseTo(original.end.x, 6);
		expect(shrunk.end.y).toBeCloseTo(original.end.y, 6);
	});

	it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects an invalid length (%s)',
		(length) => {
			expect(() => resizeWallToLength(wall(), length as number, 'start')).toThrow(/length/i);
		}
	);

	it('rejects a degenerate wall rather than producing NaN', () => {
		const degenerate = wall({ end: { x: 0, y: 0 } });

		expect(() => resizeWallToLength(degenerate, 400, 'start')).toThrow(/zero length/i);
	});
});

describe('openingOffsets', () => {
	it('reports distances from both ends and the centre', () => {
		// A 90cm door centred at 25% of a 400cm wall.
		const offsets = openingOffsets(400, 0.25, 90);

		expect(offsets.centre).toBeCloseTo(100, 6);
		expect(offsets.fromStart).toBeCloseTo(55, 6);
		expect(offsets.fromEnd).toBeCloseTo(255, 6);
	});

	it('measures from the opening edges, not its centre', () => {
		const offsets = openingOffsets(400, 0.5, 100);

		// Centred on a 400 wall: edges at 150 and 250.
		expect(offsets.fromStart).toBeCloseTo(150, 6);
		expect(offsets.fromEnd).toBeCloseTo(150, 6);
	});

	it('adds up to the wall length', () => {
		const offsets = openingOffsets(400, 0.3, 90);

		expect(offsets.fromStart + 90 + offsets.fromEnd).toBeCloseTo(400, 6);
	});

	it('reports zero when the opening sits flush against the start', () => {
		const offsets = openingOffsets(400, 45 / 400, 90);

		expect(offsets.fromStart).toBeCloseTo(0, 6);
	});
});

describe('positionForOffset', () => {
	it('places an opening a stated distance from the wall start', () => {
		// 90cm door, 55cm clear of the start -> centre at 100 of 400 -> position 0.25.
		expect(positionForOffset(400, 90, 'fromStart', 55)).toBeCloseTo(0.25, 6);
	});

	it('places an opening a stated distance from the wall end', () => {
		expect(positionForOffset(400, 90, 'fromEnd', 55)).toBeCloseTo(0.75, 6);
	});

	it('places an opening by its centre', () => {
		expect(positionForOffset(400, 90, 'centre', 200)).toBeCloseTo(0.5, 6);
	});

	it('round-trips against openingOffsets', () => {
		const position = 0.375;
		const offsets = openingOffsets(400, position, 90);

		expect(positionForOffset(400, 90, 'fromStart', offsets.fromStart)).toBeCloseTo(position, 6);
		expect(positionForOffset(400, 90, 'fromEnd', offsets.fromEnd)).toBeCloseTo(position, 6);
		expect(positionForOffset(400, 90, 'centre', offsets.centre)).toBeCloseTo(position, 6);
	});

	it('allows an opening flush against the wall start', () => {
		// The old behaviour clamped to 5% of the wall, which silently refused a legitimate
		// architectural dimension — a door hard against a corner is normal.
		const position = positionForOffset(400, 90, 'fromStart', 0);

		expect(position).toBeCloseTo(45 / 400, 6);
		expect(openingOffsets(400, position, 90).fromStart).toBeCloseTo(0, 6);
	});

	it('allows an opening flush against the wall end', () => {
		const position = positionForOffset(400, 90, 'fromEnd', 0);

		expect(openingOffsets(400, position, 90).fromEnd).toBeCloseTo(0, 6);
	});

	it('clamps so the opening cannot overhang the start', () => {
		const position = positionForOffset(400, 90, 'fromStart', -100);

		// Half the width is the closest the centre can legitimately get.
		expect(position).toBeCloseTo(45 / 400, 6);
	});

	it('clamps so the opening cannot overhang the end', () => {
		const position = positionForOffset(400, 90, 'fromStart', 999);

		expect(position).toBeCloseTo(1 - 45 / 400, 6);
	});

	it('centres an opening wider than its wall rather than returning nonsense', () => {
		// Degenerate but reachable by shrinking a wall under an existing door.
		const position = positionForOffset(200, 300, 'fromStart', 0);

		expect(position).toBeCloseTo(0.5, 6);
	});

	it.each([0, -5, Number.NaN])('falls back to the centre for a wall length of %s', (length) => {
		expect(positionForOffset(length as number, 90, 'fromStart', 10)).toBe(0.5);
	});
});

/**
 * The Slice B exit criterion in miniature: trace a wall roughly, correct it to an exact
 * dimension, and place an opening at an exact offset.
 */
describe('acceptance: exact dimensions after tracing', () => {
	it('corrects a traced wall to a stated length without moving its start corner', () => {
		// As traced from a plan: nearly 412cm but not exactly.
		const traced = wall({ end: { x: 411.3, y: 2.1 } });

		const corrected = resizeWallToLength(traced, 412, 'start');

		expect(wallLength({ ...traced, ...corrected })).toBeCloseTo(412, 6);
		// The corner already joined to another wall must not move.
		expect(corrected.start).toEqual(traced.start);
	});

	it('places a 90cm door exactly 55cm from a corner', () => {
		const position = positionForOffset(412, 90, 'fromStart', 55);
		const offsets = openingOffsets(412, position, 90);

		expect(offsets.fromStart).toBeCloseTo(55, 6);
		expect(offsets.fromEnd).toBeCloseTo(412 - 55 - 90, 6);
	});
});
