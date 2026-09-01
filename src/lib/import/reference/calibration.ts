import type { Point } from '$lib/models/types';

/**
 * Scale calibration for a reference plan (HP-303).
 *
 * ## The model
 *
 * A reference image carries a `scale` that converts **image pixels to world centimetres**, so
 * an image `w` pixels wide occupies `w * scale` centimetres of world space. Calibration solves
 * for the `scale` that makes a distance the user knows in real life measure correctly, which is
 * what makes walls traced over the reference come out at true size.
 *
 * Pure and free of any store or canvas dependency, so the arithmetic that determines whether a
 * modelled house is dimensionally true is testable on its own.
 */

/**
 * Shortest span, in world units, that may be used for calibration.
 *
 * Calibrating across a tiny span multiplies click error by the ratio of the real distance to
 * the measured one, so a two-pixel slip on a five-pixel span is a catastrophic scale error. The
 * user should pick the longest dimension chain available.
 */
const MIN_CALIBRATION_SPAN = 1;

export interface CalibrationInput {
	/** First clicked point, in world coordinates. */
	pointA: Point;
	/** Second clicked point, in world coordinates. */
	pointB: Point;
	/** The true distance between those two features, in centimetres. */
	knownDistanceCm: number;
	/** The reference image's current scale (image px → world cm). */
	currentScale: number;
	/** The reference image's current centre, in world coordinates. */
	currentPosition: Point;
}

export interface CalibrationResult {
	/** The scale to apply. */
	scale: number;
	/** The position to apply, chosen so the calibrated feature stays put. */
	position: Point;
	/** What the two points measured before calibrating, in world units. */
	measuredWorldDistance: number;
	previousScale: number;
	/** `scale / previousScale` — how much the reference grew or shrank. */
	ratio: number;
}

/** Straight-line distance between two points, in whatever units they are expressed in. */
export function measureWorldDistance(a: Point, b: Point): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

function isUsablePositive(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Work out the scale and position that make `knownDistanceCm` measure correctly.
 *
 * The returned `position` compensates for the rescale so that the **midpoint of the two clicked
 * points stays where it is**. Scaling about the image centre would otherwise fling the feature
 * the user just measured off screen, which makes verifying the result — the whole point of
 * calibrating — needlessly awkward.
 *
 * @throws when the input cannot produce a meaningful scale
 */
export function computeCalibration(input: CalibrationInput): CalibrationResult {
	const { pointA, pointB, knownDistanceCm, currentScale, currentPosition } = input;

	if (!isUsablePositive(currentScale)) {
		throw new Error('The reference image has an invalid scale, so it cannot be calibrated.');
	}

	if (!isUsablePositive(knownDistanceCm)) {
		throw new Error('Enter a real-world distance greater than zero.');
	}

	const measuredWorldDistance = measureWorldDistance(pointA, pointB);
	if (measuredWorldDistance < MIN_CALIBRATION_SPAN) {
		throw new Error(
			'Pick two distinct points, as far apart as possible. A short span magnifies any ' +
				'click error into a large scale error.'
		);
	}

	// measured world units → image pixels → required cm-per-pixel.
	const measuredImagePixels = measuredWorldDistance / currentScale;
	const scale = knownDistanceCm / measuredImagePixels;
	const ratio = scale / currentScale;

	// Hold the midpoint of the measured span fixed:
	//   p = centre + imageOffset * scale, so to keep p constant while scale changes,
	//   centre' = p - (p - centre) * (scale' / scale)
	const midpoint = {
		x: (pointA.x + pointB.x) / 2,
		y: (pointA.y + pointB.y) / 2
	};
	const position = {
		x: midpoint.x - (midpoint.x - currentPosition.x) * ratio,
		y: midpoint.y - (midpoint.y - currentPosition.y) * ratio
	};

	return { scale, position, measuredWorldDistance, previousScale: currentScale, ratio };
}

export type ParsedDistance =
	| { ok: true; cm: number }
	| { ok: false; error: string };

/**
 * Parse a typed distance into centimetres.
 *
 * Accepts a bare number (centimetres), an explicit `mm`/`cm`/`m` unit, and a comma decimal
 * separator — the source plans this was built for are European, where `10,00 m` is the normal
 * way to write a dimension, and rejecting that would be a needless papercut.
 */
export function parseKnownDistance(raw: string): ParsedDistance {
	const text = raw.trim().toLowerCase();
	if (text === '') {
		return { ok: false, error: 'Enter the real-world distance between the two points.' };
	}

	const match = text.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(mm|cm|m)?$/);
	if (!match) {
		return { ok: false, error: 'Enter a number, optionally with mm, cm or m — for example 400 cm.' };
	}

	const value = Number(match[1].replace(',', '.'));
	if (!isUsablePositive(value)) {
		return { ok: false, error: 'Enter a distance greater than zero.' };
	}

	const unit = match[2] ?? 'cm';
	const cm = unit === 'm' ? value * 100 : unit === 'mm' ? value / 10 : value;

	return { ok: true, cm };
}

/** Format a centimetre value for display, in metres when it is large enough to warrant it. */
export function formatCalibratedDistance(cm: number): string {
	if (cm >= 100) return `${(cm / 100).toFixed(2)} m`;
	return `${cm.toFixed(1)} cm`;
}
