import type { Point } from '$lib/models/types';

/**
 * Snap geometry for tracing over a reference plan (HP-304).
 *
 * ## Why this exists
 *
 * A CAD-exported architect PDF does not contain walls; it contains line work. Measured on the
 * real plan this was built for: ~63,000 segments, **median length 0.9 pt**, because every wall
 * is drawn as many short collinear fragments. 61% are axis-aligned, so the drawing is orthogonal,
 * but the fragments are individually useless.
 *
 * Merging those runs turns them into a few hundred meaningful lines, which are then offered as
 * snap targets. Crucially this needs **no classification** — nothing here tries to decide which
 * lines are walls, which are dimension chains and which are furniture. The user picks by
 * clicking, so an irrelevant candidate costs nothing, and a plan can never be filled with
 * confidently-wrong walls.
 *
 * Pure: no pdf.js, no canvas, no stores.
 */

export interface Segment {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface MergeOptions {
	/** Largest end-to-end gap that still counts as the same line. */
	gapTolerance: number;
	/** Largest angular difference, in degrees, that still counts as the same direction. */
	angleTolerance: number;
	/** Runs shorter than this are discarded. Filters hatching and text-as-paths. */
	minLength?: number;
}

export function segmentLength(s: Segment): number {
	return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
}

/** Angle in 0–180 degrees. A segment has no direction, so 10° and 190° are the same line. */
export function segmentAngleDeg(s: Segment): number {
	const raw = (Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180) / Math.PI;
	return ((raw % 180) + 180) % 180;
}

/** Smallest difference between two 0–180 angles, accounting for the wrap at 180/0. */
function angleDifference(a: number, b: number): number {
	const diff = Math.abs(a - b) % 180;
	return Math.min(diff, 180 - diff);
}

export function isAxisAligned(s: Segment, toleranceDeg: number): boolean {
	const angle = segmentAngleDeg(s);
	return (
		angleDifference(angle, 0) <= toleranceDeg || angleDifference(angle, 90) <= toleranceDeg
	);
}

/** Perpendicular distance from a point to the infinite line through a segment. */
function distanceToLine(s: Segment, px: number, py: number): number {
	const dx = s.x2 - s.x1;
	const dy = s.y2 - s.y1;
	const len = Math.hypot(dx, dy);
	if (len === 0) return Math.hypot(px - s.x1, py - s.y1);

	return Math.abs((px - s.x1) * dy - (py - s.y1) * dx) / len;
}

/**
 * Merge fragments that lie on the same straight line into maximal segments.
 *
 * Groups by direction and by which line the fragment sits on, then walks each group in order
 * along its own axis, extending a run while the next fragment starts within `gapTolerance`.
 * Bucketing first keeps this near-linear; comparing every fragment with every other would be
 * quadratic and hopeless at 63,000 inputs.
 *
 * A gap larger than the tolerance deliberately ends the run — a doorway is a real gap in a wall
 * and must survive as two separate lines.
 */
export function mergeCollinearRuns(segments: Segment[], options: MergeOptions): Segment[] {
	const { gapTolerance, angleTolerance, minLength = 0 } = options;

	// Bucket by rounded angle, then by offset of the line from the origin. Two fragments can only
	// merge if they agree on both.
	const angleStep = Math.max(angleTolerance, 0.01);
	const offsetStep = Math.max(gapTolerance, 0.01);
	const buckets = new Map<string, Segment[]>();

	for (const s of segments) {
		if (segmentLength(s) <= 0) continue;

		const angle = segmentAngleDeg(s);
		// Signed distance from the origin to the fragment's line, quantised.
		const offset = distanceToLine(s, 0, 0);
		const key = `${Math.round(angle / angleStep)}|${Math.round(offset / offsetStep)}`;

		const bucket = buckets.get(key);
		if (bucket) bucket.push(s);
		else buckets.set(key, [s]);
	}

	const merged: Segment[] = [];

	for (const bucket of buckets.values()) {
		// Project along the bucket's dominant direction so ordering is 1-D.
		const reference = bucket[0];
		const angle = (segmentAngleDeg(reference) * Math.PI) / 180;
		const ux = Math.cos(angle);
		const uy = Math.sin(angle);
		const project = (x: number, y: number) => x * ux + y * uy;

		// Normalise each fragment so its start projects before its end.
		type Run = { start: number; end: number; a: Point; b: Point };
		const runs: Run[] = bucket.map((s) => {
			const t1 = project(s.x1, s.y1);
			const t2 = project(s.x2, s.y2);
			return t1 <= t2
				? { start: t1, end: t2, a: { x: s.x1, y: s.y1 }, b: { x: s.x2, y: s.y2 } }
				: { start: t2, end: t1, a: { x: s.x2, y: s.y2 }, b: { x: s.x1, y: s.y1 } };
		});
		runs.sort((p, q) => p.start - q.start || p.end - q.end);

		let current = runs[0];
		for (let i = 1; i < runs.length; i++) {
			const next = runs[i];
			// Overlapping or touching within tolerance: extend.
			if (next.start <= current.end + gapTolerance) {
				if (next.end > current.end) {
					current = { start: current.start, end: next.end, a: current.a, b: next.b };
				}
				continue;
			}
			merged.push({ x1: current.a.x, y1: current.a.y, x2: current.b.x, y2: current.b.y });
			current = next;
		}
		merged.push({ x1: current.a.x, y1: current.a.y, x2: current.b.x, y2: current.b.y });
	}

	const kept = minLength > 0 ? merged.filter((s) => segmentLength(s) >= minLength) : merged;

	// Stable order so callers and tests see the same result for the same input.
	return kept.sort(
		(a, b) => a.x1 - b.x1 || a.y1 - b.y1 || a.x2 - b.x2 || a.y2 - b.y2
	);
}

export type SnapKind = 'endpoint' | 'line';

export interface SnapCandidate {
	point: Point;
	kind: SnapKind;
	distance: number;
	segment: Segment;
}

/**
 * Spatial grid over the segments.
 *
 * Without it every cursor move would test every segment — 5,000 segments at 60fps is 300,000
 * distance checks per second for no reason. The grid narrows each query to the cells the search
 * radius touches.
 */
export interface SnapIndex {
	cellSize: number;
	cells: Map<string, Segment[]>;
	count: number;
}

const DEFAULT_CELL_SIZE = 50;

function cellKey(cx: number, cy: number): string {
	return `${cx},${cy}`;
}

export function buildSnapIndex(segments: Segment[], cellSize = DEFAULT_CELL_SIZE): SnapIndex {
	const cells = new Map<string, Segment[]>();

	for (const s of segments) {
		// Register the segment in every cell its bounding box overlaps, so a long line is
		// reachable from anywhere along it rather than only near its midpoint.
		const minCx = Math.floor(Math.min(s.x1, s.x2) / cellSize);
		const maxCx = Math.floor(Math.max(s.x1, s.x2) / cellSize);
		const minCy = Math.floor(Math.min(s.y1, s.y2) / cellSize);
		const maxCy = Math.floor(Math.max(s.y1, s.y2) / cellSize);

		for (let cx = minCx; cx <= maxCx; cx++) {
			for (let cy = minCy; cy <= maxCy; cy++) {
				const key = cellKey(cx, cy);
				const bucket = cells.get(key);
				if (bucket) bucket.push(s);
				else cells.set(key, [s]);
			}
		}
	}

	return { cellSize, cells, count: segments.length };
}

/** Closest point on a segment to `p`, clamped to the segment's ends. */
function closestPointOnSegment(s: Segment, p: Point): Point {
	const dx = s.x2 - s.x1;
	const dy = s.y2 - s.y1;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return { x: s.x1, y: s.y1 };

	let t = ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / lenSq;
	t = Math.max(0, Math.min(1, t));

	return { x: s.x1 + t * dx, y: s.y1 + t * dy };
}

/**
 * Best snap target within `radius` of `p`, or null.
 *
 * Endpoints win over points along a line even when slightly further away: corners are what a
 * tracer is usually aiming for, and landing exactly on one is what makes traced geometry close
 * up properly.
 */
export function findSnapTarget(index: SnapIndex, p: Point, radius: number): SnapCandidate | null {
	if (index.count === 0) return null;

	const { cellSize, cells } = index;
	const minCx = Math.floor((p.x - radius) / cellSize);
	const maxCx = Math.floor((p.x + radius) / cellSize);
	const minCy = Math.floor((p.y - radius) / cellSize);
	const maxCy = Math.floor((p.y + radius) / cellSize);

	let bestEndpoint: SnapCandidate | null = null;
	let bestLine: SnapCandidate | null = null;
	const seen = new Set<Segment>();

	for (let cx = minCx; cx <= maxCx; cx++) {
		for (let cy = minCy; cy <= maxCy; cy++) {
			const bucket = cells.get(cellKey(cx, cy));
			if (!bucket) continue;

			for (const s of bucket) {
				// A segment spans several cells, so skip repeats.
				if (seen.has(s)) continue;
				seen.add(s);

				for (const end of [
					{ x: s.x1, y: s.y1 },
					{ x: s.x2, y: s.y2 }
				]) {
					const distance = Math.hypot(end.x - p.x, end.y - p.y);
					if (distance <= radius && (!bestEndpoint || distance < bestEndpoint.distance)) {
						bestEndpoint = { point: end, kind: 'endpoint', distance, segment: s };
					}
				}

				const onLine = closestPointOnSegment(s, p);
				const lineDistance = Math.hypot(onLine.x - p.x, onLine.y - p.y);
				if (lineDistance <= radius && (!bestLine || lineDistance < bestLine.distance)) {
					bestLine = { point: onLine, kind: 'line', distance: lineDistance, segment: s };
				}
			}
		}
	}

	return bestEndpoint ?? bestLine;
}
