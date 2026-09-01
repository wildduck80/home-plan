import { describe, it, expect } from 'vitest';
import {
	computeCalibration,
	measureWorldDistance,
	parseKnownDistance,
	type CalibrationInput
} from '$lib/import/reference/calibration';

/**
 * HP-303 — scale calibration arithmetic.
 *
 * The reference image carries a `scale` that converts image pixels to world centimetres.
 * Calibration solves for the scale that makes a known real-world distance measure correctly,
 * so that walls traced over the reference come out at true size.
 */

/** A reference at 1 px = 1 cm, centred on the world origin. */
function baseInput(overrides: Partial<CalibrationInput> = {}): CalibrationInput {
	return {
		pointA: { x: 0, y: 0 },
		pointB: { x: 100, y: 0 },
		knownDistanceCm: 200,
		currentScale: 1,
		currentPosition: { x: 0, y: 0 },
		...overrides
	};
}

describe('measureWorldDistance', () => {
	it('measures a horizontal span', () => {
		expect(measureWorldDistance({ x: 10, y: 5 }, { x: 110, y: 5 })).toBe(100);
	});

	it('measures diagonally', () => {
		expect(measureWorldDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
	});

	it('is zero for coincident points', () => {
		expect(measureWorldDistance({ x: 7, y: 7 }, { x: 7, y: 7 })).toBe(0);
	});
});

describe('computeCalibration — scale', () => {
	it('doubles the scale when the known distance is twice the measured one', () => {
		// 100 world units currently span what is really 200 cm, so the image must be 2x bigger.
		const result = computeCalibration(baseInput());

		expect(result.scale).toBeCloseTo(2, 6);
		expect(result.ratio).toBeCloseTo(2, 6);
	});

	it('halves the scale when the known distance is half the measured one', () => {
		const result = computeCalibration(baseInput({ knownDistanceCm: 50 }));

		expect(result.scale).toBeCloseTo(0.5, 6);
	});

	it('leaves the scale unchanged when the reference is already correct', () => {
		const result = computeCalibration(baseInput({ knownDistanceCm: 100 }));

		expect(result.scale).toBeCloseTo(1, 6);
		expect(result.ratio).toBeCloseTo(1, 6);
	});

	it('composes with an existing non-unit scale', () => {
		// Already at 3x; the span measures 100 world units but is really 50 cm.
		const result = computeCalibration(
			baseInput({ currentScale: 3, knownDistanceCm: 50 })
		);

		expect(result.scale).toBeCloseTo(1.5, 6);
	});

	it('reports what it measured, for display', () => {
		const result = computeCalibration(baseInput({ pointB: { x: 0, y: 250 } }));

		expect(result.measuredWorldDistance).toBeCloseTo(250, 6);
		expect(result.previousScale).toBe(1);
	});

	it('works on a diagonal measurement', () => {
		const result = computeCalibration(
			baseInput({ pointB: { x: 30, y: 40 }, knownDistanceCm: 100 })
		);

		// Measured 50 world units, known 100 cm.
		expect(result.scale).toBeCloseTo(2, 6);
	});
});

describe('computeCalibration — keeps the measured feature in place', () => {
	it('holds the midpoint of the two points fixed', () => {
		const input = baseInput({ currentPosition: { x: 0, y: 0 } });
		const midpointBefore = {
			x: (input.pointA.x + input.pointB.x) / 2,
			y: (input.pointA.y + input.pointB.y) / 2
		};

		const result = computeCalibration(input);

		// Re-project the midpoint through the new scale and position: scaling about the image
		// centre would fling the calibrated feature off screen, so the position compensates.
		const imageOffset = {
			x: (midpointBefore.x - input.currentPosition.x) / input.currentScale,
			y: (midpointBefore.y - input.currentPosition.y) / input.currentScale
		};
		const midpointAfter = {
			x: result.position.x + imageOffset.x * result.scale,
			y: result.position.y + imageOffset.y * result.scale
		};

		expect(midpointAfter.x).toBeCloseTo(midpointBefore.x, 6);
		expect(midpointAfter.y).toBeCloseTo(midpointBefore.y, 6);
	});

	it('leaves position untouched when the scale does not change', () => {
		const result = computeCalibration(
			baseInput({ knownDistanceCm: 100, currentPosition: { x: 40, y: -20 } })
		);

		expect(result.position.x).toBeCloseTo(40, 6);
		expect(result.position.y).toBeCloseTo(-20, 6);
	});
});

describe('computeCalibration — invalid input', () => {
	it('rejects two points in the same place', () => {
		expect(() =>
			computeCalibration(baseInput({ pointB: { x: 0, y: 0 } }))
		).toThrow(/two distinct points/i);
	});

	it('rejects points closer together than the selection tolerance', () => {
		// A sub-pixel span would amplify any click error enormously.
		expect(() =>
			computeCalibration(baseInput({ pointB: { x: 0.3, y: 0 } }))
		).toThrow(/two distinct points/i);
	});

	it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects a known distance of %s',
		(knownDistanceCm) => {
			expect(() => computeCalibration(baseInput({ knownDistanceCm }))).toThrow(/distance/i);
		}
	);

	it('rejects a non-positive current scale', () => {
		expect(() => computeCalibration(baseInput({ currentScale: 0 }))).toThrow(/scale/i);
	});
});

describe('parseKnownDistance', () => {
	it('accepts a plain number as centimetres', () => {
		expect(parseKnownDistance('400')).toEqual({ ok: true, cm: 400 });
	});

	it('accepts decimals', () => {
		expect(parseKnownDistance('412.5')).toEqual({ ok: true, cm: 412.5 });
	});

	it('accepts a comma decimal separator', () => {
		// The source plans here are European; "10,00 m" is normal notation.
		expect(parseKnownDistance('412,5')).toEqual({ ok: true, cm: 412.5 });
	});

	it('accepts an explicit cm unit', () => {
		expect(parseKnownDistance('400 cm')).toEqual({ ok: true, cm: 400 });
	});

	it('converts metres', () => {
		expect(parseKnownDistance('11.2 m')).toEqual({ ok: true, cm: 1120 });
		expect(parseKnownDistance('11,2m')).toEqual({ ok: true, cm: 1120 });
	});

	it('converts millimetres', () => {
		expect(parseKnownDistance('900 mm')).toEqual({ ok: true, cm: 90 });
	});

	it('ignores surrounding whitespace', () => {
		expect(parseKnownDistance('  400  ')).toEqual({ ok: true, cm: 400 });
	});

	it.each(['', '   ', 'abc', '-5', '0', 'cm', '4 furlongs'])(
		'rejects %s with a reason',
		(input) => {
			const result = parseKnownDistance(input);

			expect(result.ok).toBe(false);
			// Narrow explicitly — `expect` does not inform the type checker.
			if (result.ok) throw new Error('expected a rejection');
			expect(result.error).toBeTruthy();
		}
	);
});

/**
 * The acceptance criterion, expressed against the real source plan.
 *
 * The architect sheet carries dimension chains along its edges: 1120 cm across the top and
 * 1000 cm just below it. Calibrating on one and measuring the other is a self-check that needs
 * no external measurement — if the arithmetic is right, the second chain reads its own value.
 */
describe('acceptance: calibrating one dimension makes another measure correctly', () => {
	/**
	 * Simulate a plan drawn at an arbitrary, unknown scale. `pxPerCm` is the truth the user does
	 * not know; calibration has to recover it.
	 */
	function planAtUnknownScale(pxPerCm: number) {
		return {
			// Two features whose true separation is 1120 cm.
			chainA: [
				{ x: 100 * 1, y: 50 },
				{ x: 100 + 1120 * pxPerCm, y: 50 }
			] as const,
			// Two features whose true separation is 1000 cm.
			chainB: [
				{ x: 160, y: 90 },
				{ x: 160 + 1000 * pxPerCm, y: 90 }
			] as const
		};
	}

	it('recovers the true scale from the 1120 cm chain', () => {
		const truePxPerCm = 0.37; // arbitrary drawing scale
		const plan = planAtUnknownScale(truePxPerCm);

		const result = computeCalibration({
			pointA: plan.chainA[0],
			pointB: plan.chainA[1],
			knownDistanceCm: 1120,
			currentScale: 1,
			currentPosition: { x: 0, y: 0 }
		});

		// scale converts image px to cm, so it must be the inverse of px-per-cm.
		expect(result.scale).toBeCloseTo(1 / truePxPerCm, 6);
	});

	it('then measures the 1000 cm chain as 1000 cm', () => {
		const truePxPerCm = 0.37;
		const plan = planAtUnknownScale(truePxPerCm);

		const { scale } = computeCalibration({
			pointA: plan.chainA[0],
			pointB: plan.chainA[1],
			knownDistanceCm: 1120,
			currentScale: 1,
			currentPosition: { x: 0, y: 0 }
		});

		// Measure the *other* chain under the calibrated scale.
		const measuredPx = measureWorldDistance(plan.chainB[0], plan.chainB[1]);
		const measuredCm = measuredPx * scale;

		expect(measuredCm).toBeCloseTo(1000, 4);
	});

	it('stays accurate within a realistic click error', () => {
		const truePxPerCm = 0.37;
		const plan = planAtUnknownScale(truePxPerCm);
		// Two pixels of click error on a 1120 cm chain spanning ~414 px.
		const sloppyB = { x: plan.chainA[1].x + 2, y: plan.chainA[1].y };

		const { scale } = computeCalibration({
			pointA: plan.chainA[0],
			pointB: sloppyB,
			knownDistanceCm: 1120,
			currentScale: 1,
			currentPosition: { x: 0, y: 0 }
		});

		const measuredCm = measureWorldDistance(plan.chainB[0], plan.chainB[1]) * scale;

		// ~0.5% off, which is the selection tolerance of the source rather than an arithmetic
		// error — the acceptance criterion allows for exactly this.
		expect(measuredCm).toBeGreaterThan(990);
		expect(measuredCm).toBeLessThan(1010);
	});

	it('is idempotent — recalibrating on the same feature changes nothing', () => {
		const truePxPerCm = 0.37;
		const plan = planAtUnknownScale(truePxPerCm);

		const first = computeCalibration({
			pointA: plan.chainA[0],
			pointB: plan.chainA[1],
			knownDistanceCm: 1120,
			currentScale: 1,
			currentPosition: { x: 0, y: 0 }
		});

		// The clicked points are in world space, so after rescaling the same feature now spans
		// a different world distance — recompute where it landed.
		const scaledB = {
			x: first.position.x + ((plan.chainA[1].x - 0) / 1) * first.scale,
			y: first.position.y + ((plan.chainA[1].y - 0) / 1) * first.scale
		};
		const scaledA = {
			x: first.position.x + ((plan.chainA[0].x - 0) / 1) * first.scale,
			y: first.position.y + ((plan.chainA[0].y - 0) / 1) * first.scale
		};

		const second = computeCalibration({
			pointA: scaledA,
			pointB: scaledB,
			knownDistanceCm: 1120,
			currentScale: first.scale,
			currentPosition: first.position
		});

		expect(second.scale).toBeCloseTo(first.scale, 6);
		expect(second.ratio).toBeCloseTo(1, 6);
	});
});
