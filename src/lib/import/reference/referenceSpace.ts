import type { Point } from '$lib/models/types';
import type { Segment } from './snapGeometry';

/**
 * Mapping between reference-image pixels and world centimetres (HP-304).
 *
 * Snap targets extracted from a PDF are stored in **image-pixel space**, not world space. That
 * is deliberate: calibration changes the reference's scale and position, and panning changes it
 * again, so world coordinates would go stale the moment the user calibrated. Pixel coordinates
 * are fixed to the drawing itself and stay correct through every transform.
 *
 * This module must agree exactly with how the canvas paints the reference — centred on
 * `position`, scaled by `scale`, rotated about that centre. A mismatch puts snap points slightly
 * off the line work, which is worse than offering no snapping at all.
 */

export interface ReferenceFrame {
	/** World position of the image's centre. */
	position: Point;
	/** World centimetres per image pixel. */
	scale: number;
	/** Degrees, applied about `position`. */
	rotation: number;
	imageWidth: number;
	imageHeight: number;
}

/** Image pixel → world centimetres. */
export function imageToWorld(frame: ReferenceFrame, p: Point): Point {
	// Offset from the image centre, in world units.
	const dx = (p.x - frame.imageWidth / 2) * frame.scale;
	const dy = (p.y - frame.imageHeight / 2) * frame.scale;

	if (!frame.rotation) {
		return { x: frame.position.x + dx, y: frame.position.y + dy };
	}

	const radians = (frame.rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	return {
		x: frame.position.x + dx * cos - dy * sin,
		y: frame.position.y + dx * sin + dy * cos
	};
}

/** World centimetres → image pixel. Inverse of `imageToWorld`. */
export function worldToImage(frame: ReferenceFrame, p: Point): Point {
	let dx = p.x - frame.position.x;
	let dy = p.y - frame.position.y;

	if (frame.rotation) {
		const radians = (-frame.rotation * Math.PI) / 180;
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);
		const rx = dx * cos - dy * sin;
		const ry = dx * sin + dy * cos;
		dx = rx;
		dy = ry;
	}

	// A zero or non-finite scale would produce NaN and silently poison every snap query, so
	// fall back to the image centre instead.
	const scale = Number.isFinite(frame.scale) && frame.scale !== 0 ? frame.scale : 1;

	return {
		x: dx / scale + frame.imageWidth / 2,
		y: dy / scale + frame.imageHeight / 2
	};
}

/** Convert a segment's endpoints from image space to world space. */
export function segmentImageToWorld(frame: ReferenceFrame, s: Segment): Segment {
	const a = imageToWorld(frame, { x: s.x1, y: s.y1 });
	const b = imageToWorld(frame, { x: s.x2, y: s.y2 });

	return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}
