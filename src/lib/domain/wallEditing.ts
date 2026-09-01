import type { Point, Wall } from '$lib/models/types';

/**
 * Editing walls and openings by exact dimension (HP-401 / HP-402).
 *
 * Slice B's exit criterion is that a traced floor can be corrected to the dimensions printed on
 * the plan. Tracing gets a wall to *nearly* 412 cm; this is what makes it exactly 412 cm, and
 * what puts a door exactly 55 cm from a corner.
 *
 * Pure, so the arithmetic that determines whether a modelled house matches its drawing is
 * testable without a canvas.
 */

/** Which point stays put when a wall's length changes. */
export type LengthAnchor = 'start' | 'center' | 'end';

/** How an opening's position is being specified. */
export type OffsetKind = 'fromStart' | 'fromEnd' | 'centre';

export interface WallGeometry {
	start: Point;
	end: Point;
	/** Present only when the original wall had one. */
	curvePoint?: Point;
}

export function wallLength(wall: Pick<Wall, 'start' | 'end'>): number {
	return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

function isUsableLength(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Resize a wall to an exact length, preserving its angle.
 *
 * The anchor decides which end moves, and it matters: a wall traced from a plan usually has one
 * corner already joined to its neighbours, and correcting the length must not drag that corner
 * away. `start` and `end` keep the respective point fixed; `center` grows the wall symmetrically.
 *
 * A curve control point is scaled with the wall, so a curved wall does not straighten out.
 *
 * @throws when the requested length is not a positive finite number, or the wall has no direction
 */
export function resizeWallToLength(
	wall: Pick<Wall, 'start' | 'end' | 'curvePoint'>,
	newLength: number,
	anchor: LengthAnchor
): WallGeometry {
	if (!isUsableLength(newLength)) {
		throw new Error('Enter a wall length greater than zero.');
	}

	const current = wallLength(wall);
	if (current < 1e-9) {
		throw new Error('This wall has zero length, so it has no direction to resize along.');
	}

	// Unit vector along the wall.
	const ux = (wall.end.x - wall.start.x) / current;
	const uy = (wall.end.y - wall.start.y) / current;

	let start: Point;
	let end: Point;

	if (anchor === 'start') {
		start = { ...wall.start };
		end = { x: wall.start.x + ux * newLength, y: wall.start.y + uy * newLength };
	} else if (anchor === 'end') {
		end = { ...wall.end };
		start = { x: wall.end.x - ux * newLength, y: wall.end.y - uy * newLength };
	} else {
		const midX = (wall.start.x + wall.end.x) / 2;
		const midY = (wall.start.y + wall.end.y) / 2;
		const half = newLength / 2;
		start = { x: midX - ux * half, y: midY - uy * half };
		end = { x: midX + ux * half, y: midY + uy * half };
	}

	const geometry: WallGeometry = { start, end };

	if (wall.curvePoint) {
		// Scale the control point about the same anchor so the curve keeps its shape.
		const scale = newLength / current;
		const origin = anchor === 'end' ? wall.end : anchor === 'start' ? wall.start : {
			x: (wall.start.x + wall.end.x) / 2,
			y: (wall.start.y + wall.end.y) / 2
		};
		geometry.curvePoint = {
			x: origin.x + (wall.curvePoint.x - origin.x) * scale,
			y: origin.y + (wall.curvePoint.y - origin.y) * scale
		};
	}

	return geometry;
}

export interface OpeningOffsets {
	/** Clear distance from the wall's start to the opening's near edge, in cm. */
	fromStart: number;
	/** Clear distance from the opening's far edge to the wall's end, in cm. */
	fromEnd: number;
	/** Distance from the wall's start to the opening's centre, in cm. */
	centre: number;
}

/**
 * Where an opening sits along its wall, expressed the three ways a drawing might state it.
 *
 * `fromStart` and `fromEnd` measure to the opening's **edges**, not its centre, because that is
 * how architectural dimensions are given — the clear gap between a corner and a door frame.
 */
export function openingOffsets(
	wallLengthCm: number,
	position: number,
	openingWidth: number
): OpeningOffsets {
	const centre = wallLengthCm * position;
	const half = openingWidth / 2;

	return {
		centre,
		fromStart: centre - half,
		fromEnd: wallLengthCm - (centre + half)
	};
}

/**
 * Normalised position (0–1 along the wall) for a stated offset.
 *
 * Clamped so the opening's edges stay on the wall, and no tighter. The previous implementation
 * clamped the *centre* to 5–95% of the wall, which silently refused legitimate dimensions: a
 * door hard against a corner is ordinary, and a plan that says 0 cm should be obeyed.
 *
 * An opening wider than its wall is centred rather than producing an impossible position — that
 * state is reachable by shrinking a wall beneath an existing door.
 */
export function positionForOffset(
	wallLengthCm: number,
	openingWidth: number,
	kind: OffsetKind,
	valueCm: number
): number {
	if (!isUsableLength(wallLengthCm)) return 0.5;

	const half = Math.max(0, openingWidth) / 2;
	if (openingWidth >= wallLengthCm) return 0.5;

	let centre: number;
	if (kind === 'fromStart') centre = valueCm + half;
	else if (kind === 'fromEnd') centre = wallLengthCm - valueCm - half;
	else centre = valueCm;

	if (!Number.isFinite(centre)) return 0.5;

	// The centre can get exactly half a width from each end before the opening overhangs.
	const clamped = Math.max(half, Math.min(wallLengthCm - half, centre));

	return clamped / wallLengthCm;
}
