import { describe, it, expect } from 'vitest';
import {
	MAX_CANVAS_PIXELS,
	RESOLUTION_PRESETS,
	isPdfFile,
	planPageRender,
	pointsToMillimetres,
	type PdfPageSize
} from '$lib/import/pdf/renderPlan';

/**
 * HP-301 — the arithmetic behind rasterizing a PDF page.
 *
 * Kept separate from pdf.js so it is testable without a browser or a canvas: the rendering
 * itself needs a real canvas and is covered by E2E instead.
 */

/** A4 portrait, the size of the ground-floor sheet. */
const A4: PdfPageSize = { widthPt: 595.28, heightPt: 841.89 };
/** A3 landscape, the size of the large drawing sheets in a permit set. */
const A3_LANDSCAPE: PdfPageSize = { widthPt: 1190.55, heightPt: 841.89 };

describe('pointsToMillimetres', () => {
	it('converts PDF points at 72 per inch', () => {
		expect(pointsToMillimetres(72)).toBeCloseTo(25.4, 5);
	});

	it('identifies A4 from its point size', () => {
		expect(Math.round(pointsToMillimetres(A4.widthPt))).toBe(210);
		expect(Math.round(pointsToMillimetres(A4.heightPt))).toBe(297);
	});
});

describe('planPageRender — target resolution', () => {
	it('scales so the long edge hits the requested pixel width', () => {
		const plan = planPageRender(A4, 2400);

		expect(Math.max(plan.widthPx, plan.heightPx)).toBe(2400);
	});

	it('preserves aspect ratio', () => {
		const plan = planPageRender(A4, 2400);
		const pageAspect = A4.heightPt / A4.widthPt;

		expect(plan.heightPx / plan.widthPx).toBeCloseTo(pageAspect, 2);
	});

	it('uses the long edge regardless of orientation', () => {
		const portrait = planPageRender(A4, 2000);
		const landscape = planPageRender(A3_LANDSCAPE, 2000);

		expect(Math.max(portrait.widthPx, portrait.heightPx)).toBe(2000);
		expect(Math.max(landscape.widthPx, landscape.heightPx)).toBe(2000);
		// Landscape is wider than tall.
		expect(landscape.widthPx).toBeGreaterThan(landscape.heightPx);
	});

	it('reports the effective DPI it achieved', () => {
		// A4 is 8.27in wide; 2480px across that is ~300 DPI.
		const plan = planPageRender(A4, 3508);

		expect(plan.dpi).toBeGreaterThan(290);
		expect(plan.dpi).toBeLessThan(310);
	});

	it('produces integer pixel dimensions', () => {
		const plan = planPageRender(A4, 1234);

		expect(Number.isInteger(plan.widthPx)).toBe(true);
		expect(Number.isInteger(plan.heightPx)).toBe(true);
	});
});

describe('planPageRender — canvas limits', () => {
	it('clamps a request that would exceed the maximum canvas area', () => {
		// A3 landscape at 300 DPI is ~17.4M pixels, past Safari's ~16.7M cap.
		const plan = planPageRender(A3_LANDSCAPE, 4960);

		expect(plan.widthPx * plan.heightPx).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
		expect(plan.clamped).toBe(true);
	});

	it('does not clamp a request that fits', () => {
		const plan = planPageRender(A4, 2400);

		expect(plan.clamped).toBe(false);
		expect(Math.max(plan.widthPx, plan.heightPx)).toBe(2400);
	});

	it('keeps aspect ratio when clamping', () => {
		const plan = planPageRender(A3_LANDSCAPE, 8000);
		const pageAspect = A3_LANDSCAPE.widthPt / A3_LANDSCAPE.heightPt;

		expect(plan.widthPx / plan.heightPx).toBeCloseTo(pageAspect, 1);
	});

	it('still returns a usable size for an absurd request', () => {
		const plan = planPageRender(A4, 100_000);

		expect(plan.widthPx).toBeGreaterThan(100);
		expect(plan.heightPx).toBeGreaterThan(100);
		expect(plan.scale).toBeGreaterThan(0);
		expect(Number.isFinite(plan.scale)).toBe(true);
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		'falls back to the default preset for an invalid target (%s)',
		(target) => {
			const plan = planPageRender(A4, target as number);

			expect(plan.widthPx).toBeGreaterThan(0);
			expect(Number.isFinite(plan.scale)).toBe(true);
		}
	);

	it('rejects a degenerate page size rather than producing NaN', () => {
		expect(() => planPageRender({ widthPt: 0, heightPt: 0 }, 2400)).toThrow(/page size/i);
		expect(() => planPageRender({ widthPt: Number.NaN, heightPt: 100 }, 2400)).toThrow(
			/page size/i
		);
	});
});

describe('RESOLUTION_PRESETS', () => {
	it('offers presets in ascending order', () => {
		const targets = RESOLUTION_PRESETS.map((preset) => preset.longEdgePx);

		expect(targets).toEqual([...targets].sort((a, b) => a - b));
	});

	it('has exactly one default', () => {
		expect(RESOLUTION_PRESETS.filter((preset) => preset.isDefault)).toHaveLength(1);
	});

	it('every preset fits an A4 page within the canvas limit', () => {
		for (const preset of RESOLUTION_PRESETS) {
			const plan = planPageRender(A4, preset.longEdgePx);
			expect(plan.widthPx * plan.heightPx, preset.label).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
		}
	});

	it('reaches at least ~150 DPI on A4 at the default preset', () => {
		const preset = RESOLUTION_PRESETS.find((entry) => entry.isDefault)!;
		const plan = planPageRender(A4, preset.longEdgePx);

		// Architect plans carry small dimension text; below ~150 DPI it stops being legible,
		// which defeats the point of tracing against the reference.
		expect(plan.dpi).toBeGreaterThanOrEqual(150);
	});
});

describe('isPdfFile', () => {
	function file(name: string, type: string): File {
		return new File([new Uint8Array([1, 2, 3])], name, { type });
	}

	it('accepts the standard PDF mime type', () => {
		expect(isPdfFile(file('plan.pdf', 'application/pdf'))).toBe(true);
	});

	it('accepts by extension when the mime type is missing or generic', () => {
		// Some systems hand over an empty or octet-stream type for a perfectly good PDF.
		expect(isPdfFile(file('plan.pdf', ''))).toBe(true);
		expect(isPdfFile(file('plan.PDF', 'application/octet-stream'))).toBe(true);
	});

	it('rejects images and other files', () => {
		expect(isPdfFile(file('plan.png', 'image/png'))).toBe(false);
		expect(isPdfFile(file('notes.txt', 'text/plain'))).toBe(false);
	});
});
