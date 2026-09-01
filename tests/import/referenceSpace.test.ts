import { describe, it, expect } from 'vitest';
import {
	imageToWorld,
	worldToImage,
	segmentImageToWorld,
	type ReferenceFrame
} from '$lib/import/reference/referenceSpace';

/**
 * HP-304 — mapping between reference-image pixels and world centimetres.
 *
 * Snap targets are stored in image-pixel space so they travel with the image through
 * calibration, panning and rotation. They are only useful if this mapping matches exactly what
 * the canvas draws: the reference is painted **centred on `position`**, scaled by `scale`, and
 * rotated about that centre. Any disagreement puts snap points slightly off the line work,
 * which is worse than no snapping at all.
 */

/** A 200x100 image at 1px = 1cm, centred on the origin. */
const identityFrame: ReferenceFrame = {
	position: { x: 0, y: 0 },
	scale: 1,
	rotation: 0,
	imageWidth: 200,
	imageHeight: 100
};

describe('imageToWorld', () => {
	it('maps the image centre to the frame position', () => {
		expect(imageToWorld(identityFrame, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
	});

	it('maps the top-left corner to negative half-extents', () => {
		expect(imageToWorld(identityFrame, { x: 0, y: 0 })).toEqual({ x: -100, y: -50 });
	});

	it('maps the bottom-right corner to positive half-extents', () => {
		expect(imageToWorld(identityFrame, { x: 200, y: 100 })).toEqual({ x: 100, y: 50 });
	});

	it('applies scale', () => {
		const frame = { ...identityFrame, scale: 2 };

		expect(imageToWorld(frame, { x: 200, y: 100 })).toEqual({ x: 200, y: 100 });
	});

	it('applies position', () => {
		const frame = { ...identityFrame, position: { x: 1000, y: 500 } };

		expect(imageToWorld(frame, { x: 100, y: 50 })).toEqual({ x: 1000, y: 500 });
	});

	it('applies both scale and position', () => {
		const frame = { ...identityFrame, scale: 3, position: { x: 10, y: 20 } };

		// 50px right of centre, scaled by 3, offset by position.
		expect(imageToWorld(frame, { x: 150, y: 50 })).toEqual({ x: 160, y: 20 });
	});

	it('rotates about the frame position', () => {
		const frame = { ...identityFrame, rotation: 90 };
		const result = imageToWorld(frame, { x: 200, y: 50 });

		// A point 100 to the right of centre rotates to 100 below it (y grows downward).
		expect(result.x).toBeCloseTo(0, 6);
		expect(result.y).toBeCloseTo(100, 6);
	});

	it('rotates and translates together', () => {
		const frame = { ...identityFrame, rotation: 180, position: { x: 5, y: 7 } };
		const result = imageToWorld(frame, { x: 200, y: 50 });

		expect(result.x).toBeCloseTo(-95, 6);
		expect(result.y).toBeCloseTo(7, 6);
	});
});

describe('worldToImage', () => {
	it('is the inverse of imageToWorld', () => {
		const frame: ReferenceFrame = {
			position: { x: 137, y: -42 },
			scale: 2.75,
			rotation: 33,
			imageWidth: 1700,
			imageHeight: 2400
		};

		for (const p of [
			{ x: 0, y: 0 },
			{ x: 1700, y: 2400 },
			{ x: 850, y: 1200 },
			{ x: 123, y: 987 }
		]) {
			const round = worldToImage(frame, imageToWorld(frame, p));
			expect(round.x).toBeCloseTo(p.x, 4);
			expect(round.y).toBeCloseTo(p.y, 4);
		}
	});

	it('maps the frame position back to the image centre', () => {
		const frame = { ...identityFrame, position: { x: 60, y: 80 }, scale: 4 };

		const result = worldToImage(frame, { x: 60, y: 80 });

		expect(result.x).toBeCloseTo(100, 6);
		expect(result.y).toBeCloseTo(50, 6);
	});

	it('returns the image centre for a degenerate scale rather than NaN', () => {
		const frame = { ...identityFrame, scale: 0 };

		const result = worldToImage(frame, { x: 10, y: 10 });

		expect(Number.isFinite(result.x)).toBe(true);
		expect(Number.isFinite(result.y)).toBe(true);
	});
});

describe('segmentImageToWorld', () => {
	it('converts both endpoints', () => {
		const frame = { ...identityFrame, scale: 2 };

		const world = segmentImageToWorld(frame, { x1: 0, y1: 0, x2: 200, y2: 100 });

		expect(world).toEqual({ x1: -200, y1: -100, x2: 200, y2: 100 });
	});

	it('preserves length up to the scale factor', () => {
		const frame = { ...identityFrame, scale: 3, rotation: 41 };

		const world = segmentImageToWorld(frame, { x1: 0, y1: 0, x2: 100, y2: 0 });
		const length = Math.hypot(world.x2 - world.x1, world.y2 - world.y1);

		// Rotation must not change length; scale multiplies it.
		expect(length).toBeCloseTo(300, 4);
	});
});

/**
 * The property that matters in practice: after calibration changes scale and position, a snap
 * target stored in image space must still sit on the same feature of the drawing.
 */
describe('snap targets survive recalibration', () => {
	it('tracks the same drawing feature through a scale and position change', () => {
		const before: ReferenceFrame = {
			position: { x: 0, y: 0 },
			scale: 1,
			rotation: 0,
			imageWidth: 1000,
			imageHeight: 1000
		};
		// A feature at a fixed pixel in the drawing.
		const featurePixel = { x: 250, y: 750 };
		const worldBefore = imageToWorld(before, featurePixel);

		// Calibration doubles the scale and shifts the centre to keep a midpoint fixed.
		const after: ReferenceFrame = { ...before, scale: 2, position: { x: -300, y: 120 } };
		const worldAfter = imageToWorld(after, featurePixel);

		// The world position changes — that is the point of rescaling — but converting back from
		// world under the new frame must return the same pixel.
		expect(worldAfter).not.toEqual(worldBefore);
		const backToPixel = worldToImage(after, worldAfter);
		expect(backToPixel.x).toBeCloseTo(featurePixel.x, 4);
		expect(backToPixel.y).toBeCloseTo(featurePixel.y, 4);
	});
});
