import { describe, it, expect } from 'vitest';
import {
	buildSnapIndex,
	findSnapTarget,
	isAxisAligned,
	mergeCollinearRuns,
	segmentAngleDeg,
	segmentLength,
	type Segment
} from '$lib/import/reference/snapGeometry';

/**
 * HP-304 — turning raw PDF line work into snap targets.
 *
 * The real architect plan yields ~63,000 segments with a median length of 0.9 pt: walls are
 * drawn as many short collinear fragments, not single lines. Merging those runs is what makes
 * the geometry useful, and snapping to the result is what makes tracing accurate without having
 * to classify which lines are walls.
 */

const seg = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2 });

describe('segmentLength', () => {
	it('measures a horizontal segment', () => {
		expect(segmentLength(seg(0, 0, 10, 0))).toBe(10);
	});

	it('measures diagonally', () => {
		expect(segmentLength(seg(0, 0, 3, 4))).toBe(5);
	});
});

describe('segmentAngleDeg', () => {
	it('normalises to 0–180, since a segment has no direction', () => {
		expect(segmentAngleDeg(seg(0, 0, 10, 0))).toBeCloseTo(0, 6);
		expect(segmentAngleDeg(seg(10, 0, 0, 0))).toBeCloseTo(0, 6);
		expect(segmentAngleDeg(seg(0, 0, 0, 10))).toBeCloseTo(90, 6);
		expect(segmentAngleDeg(seg(0, 10, 0, 0))).toBeCloseTo(90, 6);
	});

	it('reports a 45 degree diagonal', () => {
		expect(segmentAngleDeg(seg(0, 0, 10, 10))).toBeCloseTo(45, 6);
	});
});

describe('isAxisAligned', () => {
	it('accepts horizontal and vertical within tolerance', () => {
		expect(isAxisAligned(seg(0, 0, 100, 1), 1.5)).toBe(true);
		expect(isAxisAligned(seg(0, 0, 1, 100), 1.5)).toBe(true);
	});

	it('rejects a clear diagonal', () => {
		expect(isAxisAligned(seg(0, 0, 100, 100), 1.5)).toBe(false);
	});
});

describe('mergeCollinearRuns', () => {
	it('joins fragments of one straight line into a single segment', () => {
		// This is the shape the real plan is in: one wall as many touching pieces.
		const fragments = [seg(0, 0, 10, 0), seg(10, 0, 20, 0), seg(20, 0, 30, 0)];

		const merged = mergeCollinearRuns(fragments, { gapTolerance: 0.5, angleTolerance: 1 });

		expect(merged).toHaveLength(1);
		expect(segmentLength(merged[0])).toBeCloseTo(30, 6);
	});

	it('joins fragments given out of order', () => {
		const fragments = [seg(20, 0, 30, 0), seg(0, 0, 10, 0), seg(10, 0, 20, 0)];

		const merged = mergeCollinearRuns(fragments, { gapTolerance: 0.5, angleTolerance: 1 });

		expect(merged).toHaveLength(1);
		expect(segmentLength(merged[0])).toBeCloseTo(30, 6);
	});

	it('joins fragments whose ends are reversed', () => {
		const fragments = [seg(0, 0, 10, 0), seg(20, 0, 10, 0)];

		const merged = mergeCollinearRuns(fragments, { gapTolerance: 0.5, angleTolerance: 1 });

		expect(merged).toHaveLength(1);
		expect(segmentLength(merged[0])).toBeCloseTo(20, 6);
	});

	it('bridges a gap within tolerance', () => {
		// CAD exports often leave hairline gaps between pieces of the same line.
		const fragments = [seg(0, 0, 10, 0), seg(10.3, 0, 20, 0)];

		const merged = mergeCollinearRuns(fragments, { gapTolerance: 0.5, angleTolerance: 1 });

		expect(merged).toHaveLength(1);
	});

	it('does not bridge a gap beyond tolerance', () => {
		// A doorway is a real gap in a wall and must survive as two segments.
		const fragments = [seg(0, 0, 10, 0), seg(100, 0, 110, 0)];

		const merged = mergeCollinearRuns(fragments, { gapTolerance: 0.5, angleTolerance: 1 });

		expect(merged).toHaveLength(2);
	});

	it('keeps parallel but offset lines separate', () => {
		// The two faces of a wall must not collapse into one line.
		const fragments = [seg(0, 0, 30, 0), seg(0, 15, 30, 15)];

		const merged = mergeCollinearRuns(fragments, { gapTolerance: 0.5, angleTolerance: 1 });

		expect(merged).toHaveLength(2);
	});

	it('keeps perpendicular lines separate even when they touch', () => {
		const fragments = [seg(0, 0, 30, 0), seg(30, 0, 30, 30)];

		const merged = mergeCollinearRuns(fragments, { gapTolerance: 0.5, angleTolerance: 1 });

		expect(merged).toHaveLength(2);
	});

	it('drops zero-length segments', () => {
		const merged = mergeCollinearRuns([seg(5, 5, 5, 5), seg(0, 0, 10, 0)], {
			gapTolerance: 0.5,
			angleTolerance: 1
		});

		expect(merged).toHaveLength(1);
	});

	it('discards runs shorter than minLength', () => {
		// Hatching and text-as-paths are short; discarding them is what makes the set usable.
		const merged = mergeCollinearRuns([seg(0, 0, 2, 0), seg(0, 20, 60, 20)], {
			gapTolerance: 0.5,
			angleTolerance: 1,
			minLength: 10
		});

		expect(merged).toHaveLength(1);
		expect(segmentLength(merged[0])).toBeCloseTo(60, 6);
	});

	it('is deterministic regardless of input order', () => {
		const a = [seg(0, 0, 10, 0), seg(10, 0, 20, 0), seg(0, 15, 20, 15)];
		const b = [seg(0, 15, 20, 15), seg(10, 0, 20, 0), seg(0, 0, 10, 0)];
		const opts = { gapTolerance: 0.5, angleTolerance: 1 };

		const mergedA = mergeCollinearRuns(a, opts).map(segmentLength).sort();
		const mergedB = mergeCollinearRuns(b, opts).map(segmentLength).sort();

		expect(mergedA).toEqual(mergedB);
	});

	it('collapses a long fragmented run at realistic scale', () => {
		// 400 one-unit pieces, as a real wall arrives.
		const fragments = Array.from({ length: 400 }, (_, i) => seg(i, 0, i + 1, 0));

		const merged = mergeCollinearRuns(fragments, { gapTolerance: 0.5, angleTolerance: 1 });

		expect(merged).toHaveLength(1);
		expect(segmentLength(merged[0])).toBeCloseTo(400, 6);
	});

	it('handles thousands of segments without pathological slowness', () => {
		// 20 parallel lines of 300 fragments each — the scale of a real sheet.
		const fragments: Segment[] = [];
		for (let line = 0; line < 20; line++) {
			for (let i = 0; i < 300; i++) fragments.push(seg(i, line * 20, i + 1, line * 20));
		}

		const started = Date.now();
		const merged = mergeCollinearRuns(fragments, { gapTolerance: 0.5, angleTolerance: 1 });
		const elapsed = Date.now() - started;

		expect(merged).toHaveLength(20);
		// Generous, but a quadratic implementation would blow straight past it.
		expect(elapsed).toBeLessThan(3000);
	});
});

describe('findSnapTarget', () => {
	const lines = [seg(0, 0, 100, 0), seg(100, 0, 100, 80), seg(0, 50, 100, 50)];
	const index = buildSnapIndex(lines);

	it('returns null when nothing is within range', () => {
		expect(findSnapTarget(index, { x: 500, y: 500 }, 10)).toBeNull();
	});

	it('snaps to an endpoint when close to one', () => {
		const hit = findSnapTarget(index, { x: 2, y: 2 }, 10);

		expect(hit).not.toBeNull();
		expect(hit!.kind).toBe('endpoint');
		expect(hit!.point.x).toBeCloseTo(0, 6);
		expect(hit!.point.y).toBeCloseTo(0, 6);
	});

	it('prefers an endpoint over a nearer point along a line', () => {
		// Corners are what a tracer actually wants, so they outrank line projections.
		const hit = findSnapTarget(index, { x: 98, y: 3 }, 10);

		expect(hit!.kind).toBe('endpoint');
		expect(hit!.point).toEqual({ x: 100, y: 0 });
	});

	it('snaps onto a line when far from any endpoint', () => {
		const hit = findSnapTarget(index, { x: 50, y: 3 }, 10);

		expect(hit!.kind).toBe('line');
		expect(hit!.point.x).toBeCloseTo(50, 6);
		expect(hit!.point.y).toBeCloseTo(0, 6);
	});

	it('picks the closest of several candidates', () => {
		const hit = findSnapTarget(index, { x: 50, y: 47 }, 10);

		expect(hit!.point.y).toBeCloseTo(50, 6);
	});

	it('respects the search radius', () => {
		expect(findSnapTarget(index, { x: 50, y: 20 }, 5)).toBeNull();
		expect(findSnapTarget(index, { x: 50, y: 20 }, 25)).not.toBeNull();
	});

	it('reports the distance it snapped', () => {
		const hit = findSnapTarget(index, { x: 50, y: 4 }, 10);

		expect(hit!.distance).toBeCloseTo(4, 6);
	});

	it('is fast on a large index', () => {
		const many: Segment[] = [];
		for (let i = 0; i < 5000; i++) many.push(seg(i % 500, Math.floor(i / 500) * 10, (i % 500) + 8, Math.floor(i / 500) * 10));
		const bigIndex = buildSnapIndex(many);

		const started = Date.now();
		for (let i = 0; i < 500; i++) findSnapTarget(bigIndex, { x: i % 500, y: 20 }, 12);
		const elapsed = Date.now() - started;

		// A linear scan per query would be 2.5M distance checks; the grid must avoid that.
		expect(elapsed).toBeLessThan(500);
	});

	it('tolerates an empty index', () => {
		expect(findSnapTarget(buildSnapIndex([]), { x: 0, y: 0 }, 10)).toBeNull();
	});
});
