import type { Door, Floor, FurnitureItem, Point, Wall } from '$lib/models/types';
import type { CatalogDimensions } from './furniture';
import {
	convexOverlapArea,
	convexPolygonsOverlap,
	orientedBounds,
	rectCorners,
	segmentIntersectsRect
} from './collision';

/**
 * Finding fit problems on a floor (HP-602 / HP-603 / HP-604).
 *
 * These are **warnings, not constraints**. The PRD is explicit that deliberate placement must
 * never be blocked, which sets the bar for reporting: a human has to agree it is a problem. A
 * wardrobe pushed flush against a wall stays silent, because otherwise the warnings become noise
 * and get ignored — at which point a real clash goes unnoticed too.
 */

export type CollisionKind = 'furniture-furniture' | 'furniture-wall' | 'furniture-door';

export interface Collision {
	kind: CollisionKind;
	/** Ids of the elements involved, for highlighting. */
	ids: string[];
	/** Human-readable, naming both parties. */
	message: string;
	/** Square centimetres of overlap, where meaningful. Lets severity be judged. */
	overlapArea: number;
}

/** Resolves a catalog id to its dimensions. Injected so this module needs no catalog import. */
export type CatalogLookup = (catalogId: string) => CatalogDimensions | undefined;

/** Door types with a leaf that sweeps an arc. Everything else cannot foul anything. */
const SWINGING_DOOR_TYPES = new Set<Door['type']>(['single', 'double', 'french', 'bifold', 'garage']);

/** Segments used to approximate the swing arc. Enough that the sector reads as curved. */
const ARC_SEGMENTS = 6;

/** A readable name for an item, preferring the catalog id over an opaque uid. */
function describeFurniture(item: FurnitureItem): string {
	return item.catalogId.replace(/[-_]/g, ' ');
}

/**
 * The area a door leaf sweeps, as a convex polygon.
 *
 * Modelled as a circular sector rooted at the hinge with radius equal to the door width — which
 * is what a door actually sweeps. Approximating it as a square would over-report at the far
 * corner, producing warnings the user can see are wrong, and the fastest way to get a warning
 * system ignored is to have it cry wolf.
 *
 * A quarter sector is convex, so it works with the same separating-axis test as everything else.
 *
 * Returns an empty array for doors with no swinging leaf — sliding, pocket and plain openings.
 */
export function doorSwingPolygon(door: Door, wall: Wall): Point[] {
	if (!SWINGING_DOOR_TYPES.has(door.type)) return [];

	const dx = wall.end.x - wall.start.x;
	const dy = wall.end.y - wall.start.y;
	const wallLength = Math.hypot(dx, dy);
	if (wallLength < 1e-6) return [];

	// Unit vector along the wall, and its normal.
	const ux = dx / wallLength;
	const uy = dy / wallLength;
	// `flipSide` chooses which side of the wall the leaf opens to.
	const side = door.flipSide ? 1 : -1;
	const nx = -uy * side;
	const ny = ux * side;

	const centreAlong = wallLength * door.position;
	const half = door.width / 2;
	// `swingDirection` chooses which end of the opening the hinge sits at.
	const hingeAlong = door.swingDirection === 'left' ? centreAlong - half : centreAlong + half;
	const hinge: Point = {
		x: wall.start.x + ux * hingeAlong,
		y: wall.start.y + uy * hingeAlong
	};

	// Sweep from along-the-wall (leaf closed) round to the normal (leaf fully open). The
	// direction depends on which end is hinged, so the sector always lands on the door.
	const towardOpening = door.swingDirection === 'left' ? 1 : -1;
	const startAngle = Math.atan2(uy * towardOpening, ux * towardOpening);
	const endAngle = Math.atan2(ny, nx);

	// Take the shorter way round, so the sector is the quarter turn a leaf actually makes.
	let sweep = endAngle - startAngle;
	while (sweep > Math.PI) sweep -= Math.PI * 2;
	while (sweep < -Math.PI) sweep += Math.PI * 2;

	const polygon: Point[] = [hinge];
	for (let i = 0; i <= ARC_SEGMENTS; i++) {
		const angle = startAngle + (sweep * i) / ARC_SEGMENTS;
		polygon.push({
			x: hinge.x + Math.cos(angle) * door.width,
			y: hinge.y + Math.sin(angle) * door.width
		});
	}

	return polygon;
}

/**
 * Every fit problem on a floor.
 *
 * Furniture pairs are compared once each, and results are deduplicated by element pair so a
 * single clash is reported once rather than from both sides.
 */
export function findCollisions(floor: Floor, catalogLookup: CatalogLookup): Collision[] {
	const collisions: Collision[] = [];

	// Resolve footprints once. Items with an unknown catalog id are skipped rather than throwing:
	// a project can reference a catalog entry a later build renamed.
	const footprints = floor.furniture
		.map((item) => {
			const def = catalogLookup(item.catalogId);
			return def ? { item, rect: orientedBounds(item, def) } : null;
		})
		.filter((entry): entry is { item: FurnitureItem; rect: ReturnType<typeof orientedBounds> } => entry !== null);

	// Furniture against furniture (HP-602).
	for (let i = 0; i < footprints.length; i++) {
		for (let j = i + 1; j < footprints.length; j++) {
			const a = footprints[i];
			const b = footprints[j];
			const area = convexOverlapArea(rectCorners(a.rect), rectCorners(b.rect));
			if (area <= 0) continue;

			collisions.push({
				kind: 'furniture-furniture',
				ids: [a.item.id, b.item.id],
				message: `${describeFurniture(a.item)} overlaps ${describeFurniture(b.item)} by ${Math.round(area / 100)} cm².`,
				overlapArea: area
			});
		}
	}

	// Furniture against walls (HP-603).
	for (const { item, rect } of footprints) {
		for (const w of floor.walls) {
			if (!segmentIntersectsRect(w.start, w.end, rect)) continue;

			collisions.push({
				kind: 'furniture-wall',
				ids: [item.id, w.id],
				message: `${describeFurniture(item)} crosses a wall.`,
				overlapArea: 0
			});
		}
	}

	// Furniture against door swings (HP-604).
	for (const d of floor.doors) {
		const host = floor.walls.find((w) => w.id === d.wallId);
		// A door whose wall was deleted is stale data, not a collision.
		if (!host) continue;

		const swing = doorSwingPolygon(d, host);
		if (swing.length === 0) continue;

		for (const { item, rect } of footprints) {
			const corners = rectCorners(rect);
			if (!convexPolygonsOverlap(swing, corners)) continue;

			const area = convexOverlapArea(swing, corners);
			collisions.push({
				kind: 'furniture-door',
				ids: [item.id, d.id],
				message: `${describeFurniture(item)} blocks the door swing.`,
				overlapArea: area
			});
		}
	}

	return collisions;
}

/** Collisions involving one element, for showing a warning on the selected item. */
export function collisionsFor(collisions: Collision[], elementId: string): Collision[] {
	return collisions.filter((c) => c.ids.includes(elementId));
}
