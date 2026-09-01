import type { Floor, FurnitureItem, Point, Wall } from '$lib/models/types';
import type { CatalogDimensions } from './furniture';
import {
	convexPolygonsOverlap,
	orientedBounds,
	rectCorners,
	segmentIntersectsRect,
	type OrientedRect
} from './collision';

/**
 * Distances and clearance (HP-403 / HP-605 / HP-606).
 *
 * "These do not overlap" is a weak answer. What decides whether a room works is whether you can
 * walk past the bed and open the wardrobe — which needs real distances between *rotated* shapes,
 * and a notion of the space a piece of furniture needs in front of it.
 *
 * The existing nearest-distance overlay reasons in axis-aligned bounding boxes, so a rotated
 * item's distances are measured from a box it does not occupy. This replaces that arithmetic.
 *
 * Like collision, clearance produces **warnings only** — never a block on placement.
 */

export interface CatalogEntry extends CatalogDimensions {
	category?: string;
}

export type CatalogLookup = (catalogId: string) => CatalogEntry | undefined;

/** Closest point on segment `a`–`b` to `p`, clamped to the segment. */
function closestPointOnSegment(a: Point, b: Point, p: Point): Point {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return { x: a.x, y: a.y };

	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
	t = Math.max(0, Math.min(1, t));

	return { x: a.x + t * dx, y: a.y + t * dy };
}

export interface ClosestPair {
	distance: number;
	from: Point;
	to: Point;
}

/**
 * Closest pair of points between two convex polygons, and the distance between them.
 *
 * Zero when they overlap or touch. Every vertex is tested against every edge of the other
 * polygon, both ways — with four-sided shapes that is 32 point-to-segment tests, cheap enough to
 * run while dragging.
 */
export function closestPairBetween(a: Point[], b: Point[]): ClosestPair {
	if (convexPolygonsOverlap(a, b)) {
		return { distance: 0, from: a[0], to: a[0] };
	}

	let best: ClosestPair = { distance: Infinity, from: a[0], to: b[0] };

	const consider = (from: Point, to: Point) => {
		const distance = Math.hypot(to.x - from.x, to.y - from.y);
		if (distance < best.distance) best = { distance, from, to };
	};

	for (const vertex of a) {
		for (let i = 0; i < b.length; i++) {
			consider(vertex, closestPointOnSegment(b[i], b[(i + 1) % b.length], vertex));
		}
	}
	for (const vertex of b) {
		for (let i = 0; i < a.length; i++) {
			consider(closestPointOnSegment(a[i], a[(i + 1) % a.length], vertex), vertex);
		}
	}

	return best;
}

/** Distance between two convex polygons. Zero when they overlap or touch. */
export function polygonDistance(a: Point[], b: Point[]): number {
	return closestPairBetween(a, b).distance;
}

export interface NearestNeighbour extends ClosestPair {
	id: string;
	label: string;
}

export interface NearestDistances {
	nearestWall: NearestNeighbour | null;
	nearestFurniture: NearestNeighbour | null;
	nearestOpening: NearestNeighbour | null;
}

/**
 * Nearest wall, furniture item and opening to the selected item (HP-403).
 *
 * Returns the closest point pair for each, not just a number, so the overlay can draw the
 * measurement exactly where it was taken — which is what lets it agree with the manual measure
 * tool rather than approximately matching it.
 */
export function nearestDistances(
	floor: Floor,
	selectedId: string,
	catalogLookup: CatalogLookup
): NearestDistances | null {
	const item = floor.furniture.find((f) => f.id === selectedId);
	if (!item) return null;

	const def = catalogLookup(item.catalogId);
	if (!def) return null;

	const corners = rectCorners(orientedBounds(item, def));

	let nearestWall: NearestNeighbour | null = null;
	for (const w of floor.walls) {
		const pair = closestPairBetween(corners, [w.start, w.end, w.end, w.start]);
		if (!nearestWall || pair.distance < nearestWall.distance) {
			nearestWall = { ...pair, id: w.id, label: 'wall' };
		}
	}

	let nearestFurniture: NearestNeighbour | null = null;
	for (const other of floor.furniture) {
		if (other.id === selectedId) continue;
		const otherDef = catalogLookup(other.catalogId);
		if (!otherDef) continue;

		const pair = closestPairBetween(corners, rectCorners(orientedBounds(other, otherDef)));
		if (!nearestFurniture || pair.distance < nearestFurniture.distance) {
			nearestFurniture = { ...pair, id: other.id, label: other.catalogId.replace(/[-_]/g, ' ') };
		}
	}

	let nearestOpening: NearestNeighbour | null = null;
	for (const opening of [...floor.doors, ...floor.windows]) {
		const host = floor.walls.find((w) => w.id === opening.wallId);
		if (!host) continue;

		// The opening's two edges along its wall.
		const dx = host.end.x - host.start.x;
		const dy = host.end.y - host.start.y;
		const length = Math.hypot(dx, dy);
		if (length < 1e-6) continue;
		const ux = dx / length;
		const uy = dy / length;
		const centreAlong = length * opening.position;
		const half = opening.width / 2;
		const edgeA: Point = {
			x: host.start.x + ux * (centreAlong - half),
			y: host.start.y + uy * (centreAlong - half)
		};
		const edgeB: Point = {
			x: host.start.x + ux * (centreAlong + half),
			y: host.start.y + uy * (centreAlong + half)
		};

		const pair = closestPairBetween(corners, [edgeA, edgeB, edgeB, edgeA]);
		if (!nearestOpening || pair.distance < nearestOpening.distance) {
			nearestOpening = { ...pair, id: opening.id, label: 'opening' };
		}
	}

	return { nearestWall, nearestFurniture, nearestOpening };
}

export interface ClearanceRule {
	label: string;
	depthCm: number;
	/** Matches a catalog id, or a category when the id is not specific enough. */
	matches: (catalogId: string, entry: CatalogEntry) => boolean;
}

/**
 * Clearance presets from the PRD.
 *
 * Deliberately **not** applied to everything. A universal circulation rule would flag every
 * side table in the house, and a warning that fires constantly is one the user stops reading.
 * Only furniture that genuinely needs space in front of it gets a rule.
 */
export const CLEARANCE_RULES: readonly ClearanceRule[] = [
	{
		label: 'Kitchen working aisle',
		depthCm: 100,
		matches: (id, entry) =>
			entry.category === 'Kitchen' && /counter|island|worktop|cabinet/i.test(id)
	},
	{
		label: 'Wardrobe opening',
		depthCm: 90,
		matches: (id) => /wardrobe|closet|armoire/i.test(id)
	},
	{
		label: 'Dining chair pull-out',
		depthCm: 75,
		matches: (id, entry) => entry.category === 'Dining' && /chair|stool|seat/i.test(id)
	},
	{
		label: 'Bed side circulation',
		depthCm: 60,
		matches: (id) => /\bbed\b|bed[_-]/i.test(id)
	}
] as const;

/** The clearance rule for a catalog item, or null when it needs none. */
export function clearanceRuleFor(catalogId: string, entry: CatalogEntry): ClearanceRule | null {
	return CLEARANCE_RULES.find((rule) => rule.matches(catalogId, entry)) ?? null;
}

/**
 * The space an item needs in front of it, as a polygon.
 *
 * "Front" is the item's local **+depth** face. Furniture carries no explicit facing, so a
 * convention is unavoidable; +depth matches how the catalog defines depth and how items are drawn
 * unrotated. Rotating the item rotates the zone with it.
 */
export function clearanceZone(rect: OrientedRect, depthCm: number): Point[] {
	if (!(depthCm > 0)) return [];

	const radians = (rect.rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	// Local corners of a band sitting just beyond the front face.
	const local: Point[] = [
		{ x: -rect.halfWidth, y: rect.halfDepth },
		{ x: rect.halfWidth, y: rect.halfDepth },
		{ x: rect.halfWidth, y: rect.halfDepth + depthCm },
		{ x: -rect.halfWidth, y: rect.halfDepth + depthCm }
	];

	return local.map((p) => ({
		x: rect.centre.x + p.x * cos - p.y * sin,
		y: rect.centre.y + p.x * sin + p.y * cos
	}));
}

export interface ClearanceIssue {
	ids: string[];
	message: string;
	/** How much clear space is actually available, in cm. */
	availableCm: number;
	/** What the rule wanted. */
	requiredCm: number;
	/** The zone polygon, so the overlay can draw it. */
	zone: Point[];
}

/**
 * Clearance problems on a floor (HP-605).
 *
 * Only the item's **front** zone is checked, which is what keeps this useful: a wardrobe backed
 * against the wall behind it is exactly how wardrobes are placed, and flagging that would be
 * wrong. Anything intruding into the space in front is a genuine problem.
 */
export function findClearanceIssues(floor: Floor, catalogLookup: CatalogLookup): ClearanceIssue[] {
	const issues: ClearanceIssue[] = [];

	for (const item of floor.furniture) {
		const def = catalogLookup(item.catalogId);
		if (!def) continue;

		const rule = clearanceRuleFor(item.catalogId, def);
		if (!rule) continue;

		const rect = orientedBounds(item, def);
		const zone = clearanceZone(rect, rule.depthCm);
		if (zone.length === 0) continue;

		const itemCorners = rectCorners(rect);

		for (const other of floor.furniture) {
			if (other.id === item.id) continue;
			const otherDef = catalogLookup(other.catalogId);
			if (!otherDef) continue;

			const otherCorners = rectCorners(orientedBounds(other, otherDef));
			if (!convexPolygonsOverlap(zone, otherCorners)) continue;

			const available = polygonDistance(itemCorners, otherCorners);
			issues.push({
				ids: [item.id, other.id],
				message: `${rule.label} needs ${rule.depthCm} cm — only ${Math.round(available)} cm available.`,
				availableCm: available,
				requiredCm: rule.depthCm,
				zone
			});
		}

		for (const w of floor.walls) {
			// A wall passing through the item itself is a collision, reported by collisionCheck —
			// not a clearance problem, and reporting it twice would be noise.
			if (segmentIntersectsRect(w.start, w.end, rect)) continue;

			// Only the front zone is tested, so a wall behind the item — which is exactly how a
			// wardrobe is placed — is correctly ignored.
			if (!segmentCrossesPolygon(w, zone)) continue;

			const available = polygonDistance(itemCorners, [w.start, w.end, w.end, w.start]);
			issues.push({
				ids: [item.id, w.id],
				message: `${rule.label} needs ${rule.depthCm} cm — a wall is ${Math.round(available)} cm away.`,
				availableCm: available,
				requiredCm: rule.depthCm,
				zone
			});
		}
	}

	return issues;
}

/** Whether a wall segment enters a polygon. */
function segmentCrossesPolygon(w: Wall, polygon: Point[]): boolean {
	// Treat the segment as a degenerate polygon so the shared overlap test can be reused.
	return convexPolygonsOverlap(polygon, [w.start, w.end, w.end, w.start]);
}

/** Every furniture item that has a clearance rule, with its zone. For the overlay (HP-606). */
export function clearanceZonesFor(
	item: FurnitureItem,
	catalogLookup: CatalogLookup
): { zone: Point[]; rule: ClearanceRule } | null {
	const def = catalogLookup(item.catalogId);
	if (!def) return null;

	const rule = clearanceRuleFor(item.catalogId, def);
	if (!rule) return null;

	const zone = clearanceZone(orientedBounds(item, def), rule.depthCm);
	return zone.length > 0 ? { zone, rule } : null;
}
