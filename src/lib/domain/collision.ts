import type { FurnitureItem, Point } from '$lib/models/types';
import { resolveFurnitureDimensions, type CatalogDimensions } from './furniture';

/**
 * Oriented footprints and overlap tests (HP-601 / HP-602).
 *
 * The PRD calls collision detection the highest-value differentiator, because the app exists to
 * answer "does this fit". Everything that depends on that — furniture overlap, door swings,
 * clearance zones, honest distance measurement — needs a footprint that respects rotation.
 *
 * The existing nearest-distance overlay reasons in axis-aligned bounding boxes, so a rotated
 * item's distances are measured from a box it does not occupy. That is the limitation this
 * replaces.
 *
 * Overlap uses the separating axis theorem: two convex shapes are disjoint exactly when some axis
 * exists on which their projections do not overlap. For rectangles the only candidate axes are the
 * four edge normals, which makes the test cheap and exact — no sampling, no tolerance fudging.
 */

export interface OrientedRect {
	centre: Point;
	halfWidth: number;
	halfDepth: number;
	/** Degrees, clockwise, matching `FurnitureItem.rotation`. */
	rotation: number;
}

/** The oriented footprint of a placed furniture item, in world centimetres. */
export function orientedBounds(
	item: FurnitureItem,
	catalogDef: CatalogDimensions | undefined
): OrientedRect {
	const { width, depth } = resolveFurnitureDimensions(item, catalogDef);

	return {
		centre: { x: item.position.x, y: item.position.y },
		halfWidth: width / 2,
		halfDepth: depth / 2,
		rotation: item.rotation
	};
}

/** The four corners, in order around the rectangle. */
export function rectCorners(r: OrientedRect): Point[] {
	const radians = (r.rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	const local: Point[] = [
		{ x: -r.halfWidth, y: -r.halfDepth },
		{ x: r.halfWidth, y: -r.halfDepth },
		{ x: r.halfWidth, y: r.halfDepth },
		{ x: -r.halfWidth, y: r.halfDepth }
	];

	return local.map((p) => ({
		x: r.centre.x + p.x * cos - p.y * sin,
		y: r.centre.y + p.x * sin + p.y * cos
	}));
}

function projectOntoAxis(corners: Point[], axis: Point): { min: number; max: number } {
	let min = Infinity;
	let max = -Infinity;

	for (const c of corners) {
		const dot = c.x * axis.x + c.y * axis.y;
		if (dot < min) min = dot;
		if (dot > max) max = dot;
	}

	return { min, max };
}

/** Unit outward normals of every edge of a convex polygon. */
function polygonAxes(polygon: Point[]): Point[] {
	const axes: Point[] = [];

	for (let i = 0; i < polygon.length; i++) {
		const a = polygon[i];
		const b = polygon[(i + 1) % polygon.length];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const length = Math.hypot(dx, dy);
		if (length < 1e-9) continue;
		// Normal, normalised so the epsilon below means the same thing on every axis.
		axes.push({ x: -dy / length, y: dx / length });
	}

	return axes;
}

/**
 * Whether two convex polygons overlap with positive area, by the separating axis theorem.
 *
 * Generalised beyond rectangles because a door swing is a circular *sector*, which is convex for
 * a quarter turn and so works with the same test — approximating it as a square would over-report
 * at the far corner and produce warnings the user can see are wrong.
 *
 * Touching edges and corners are **not** overlaps. Furniture pushed flush against a wall or
 * another piece is a normal arrangement, and flagging it would make the warning meaningless. The
 * epsilon absorbs floating-point noise from the rotation arithmetic so a flush placement does not
 * intermittently register as a collision.
 */
export function convexPolygonsOverlap(a: Point[], b: Point[]): boolean {
	const EPSILON = 1e-6;
	if (a.length < 3 || b.length < 3) return false;

	for (const axis of [...polygonAxes(a), ...polygonAxes(b)]) {
		const projA = projectOntoAxis(a, axis);
		const projB = projectOntoAxis(b, axis);

		// A gap on any axis proves separation.
		if (projA.max - projB.min <= EPSILON || projB.max - projA.min <= EPSILON) {
			return false;
		}
	}

	return true;
}

/** Whether two oriented rectangles overlap with positive area. */
export function rectsOverlap(a: OrientedRect, b: OrientedRect): boolean {
	return convexPolygonsOverlap(rectCorners(a), rectCorners(b));
}

/** Clip a convex polygon against a half-plane, keeping the inside. Sutherland–Hodgman step. */
function clipAgainstEdge(polygon: Point[], edgeStart: Point, edgeEnd: Point): Point[] {
	// Positive means inside, for corners listed clockwise in screen coordinates.
	const side = (p: Point) =>
		(edgeEnd.x - edgeStart.x) * (p.y - edgeStart.y) - (edgeEnd.y - edgeStart.y) * (p.x - edgeStart.x);

	const output: Point[] = [];

	for (let i = 0; i < polygon.length; i++) {
		const current = polygon[i];
		const next = polygon[(i + 1) % polygon.length];
		const currentSide = side(current);
		const nextSide = side(next);

		if (currentSide >= 0) output.push(current);

		// Crossing the edge: add the intersection point.
		if ((currentSide >= 0 && nextSide < 0) || (currentSide < 0 && nextSide >= 0)) {
			const t = currentSide / (currentSide - nextSide);
			output.push({
				x: current.x + t * (next.x - current.x),
				y: current.y + t * (next.y - current.y)
			});
		}
	}

	return output;
}

function polygonArea(polygon: Point[]): number {
	if (polygon.length < 3) return 0;

	let sum = 0;
	for (let i = 0; i < polygon.length; i++) {
		const a = polygon[i];
		const b = polygon[(i + 1) % polygon.length];
		sum += a.x * b.y - b.x * a.y;
	}

	return Math.abs(sum) / 2;
}

/**
 * Area of the overlap between two rectangles, in square centimetres. Zero when they do not
 * overlap.
 *
 * Reported rather than a plain boolean so a warning can say *how badly* something overlaps — a
 * 2 cm clash and a 60 cm clash deserve different urgency, and the PRD's example warning quotes a
 * figure ("intersects door swing by 14 cm").
 */
export function overlapArea(a: OrientedRect, b: OrientedRect): number {
	return convexOverlapArea(rectCorners(a), rectCorners(b));
}

/** Area shared by two convex polygons, in square centimetres. Zero when they do not overlap. */
export function convexOverlapArea(a: Point[], b: Point[]): number {
	if (!convexPolygonsOverlap(a, b)) return 0;

	// Clip a against each of b's edges; what survives is the intersection.
	let polygon = a;
	const clipCorners = b;

	for (let i = 0; i < clipCorners.length && polygon.length > 0; i++) {
		polygon = clipAgainstEdge(polygon, clipCorners[i], clipCorners[(i + 1) % clipCorners.length]);
	}

	return polygonArea(polygon);
}

/** Whether a point lies inside a rectangle, respecting rotation. */
export function pointInRect(p: Point, r: OrientedRect): boolean {
	const radians = (-r.rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const dx = p.x - r.centre.x;
	const dy = p.y - r.centre.y;

	// Rotate the point into the rectangle's own frame, where the test is trivial.
	const localX = dx * cos - dy * sin;
	const localY = dx * sin + dy * cos;

	return Math.abs(localX) <= r.halfWidth && Math.abs(localY) <= r.halfDepth;
}

/** Whether two segments properly cross, excluding mere touching. */
function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
	const cross = (o: Point, p: Point, q: Point) =>
		(p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);

	const d1 = cross(b1, b2, a1);
	const d2 = cross(b1, b2, a2);
	const d3 = cross(a1, a2, b1);
	const d4 = cross(a1, a2, b2);

	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Whether a line segment intersects a rectangle's interior.
 *
 * Used for furniture-versus-wall checks (HP-603): a wall is a segment, and a piece of furniture
 * crossing it is a real error. A segment merely running along an edge does not count, because
 * furniture flush against a wall is the normal case.
 */
export function segmentIntersectsRect(a: Point, b: Point, r: OrientedRect): boolean {
	// Either endpoint strictly inside is enough.
	if (pointInRect(a, r) || pointInRect(b, r)) {
		// Guard against the flush case, where an endpoint sits exactly on the boundary.
		const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		if (pointInRect(midpoint, r)) return true;
	}

	const corners = rectCorners(r);
	for (let i = 0; i < corners.length; i++) {
		if (segmentsCross(a, b, corners[i], corners[(i + 1) % corners.length])) return true;
	}

	return false;
}
