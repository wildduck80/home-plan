/**
 * Rasterization arithmetic for PDF reference plans (HP-301).
 *
 * Deliberately free of any pdf.js dependency so it can be unit-tested without a browser or a
 * canvas, and so the numbers driving a render are inspectable on their own.
 */

/** PDF user space is 72 units per inch, by definition. */
const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;

/**
 * Largest canvas area to ask for, in pixels.
 *
 * Browsers cap canvas area and the limit is not uniform: Safari has historically refused
 * above roughly 16.7M pixels (4096x4096 on older iOS), while Chrome allows considerably more.
 * Exceeding it does not throw — the canvas silently comes back blank, which would look like a
 * broken import rather than a limit. So the ceiling is enforced here instead.
 *
 * This matters for real permit sets: an A3 landscape sheet at 300 DPI is ~17.4M pixels and
 * would cross the line.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;

/** Fallback when a caller asks for a nonsensical target. */
const DEFAULT_LONG_EDGE_PX = 2400;

export interface PdfPageSize {
	widthPt: number;
	heightPt: number;
}

export interface PageRenderPlan {
	/** Scale factor to hand pdf.js via `getViewport({ scale })`. */
	scale: number;
	widthPx: number;
	heightPx: number;
	/** Effective resolution across the page's long edge. */
	dpi: number;
	/** True when the requested resolution was reduced to respect `MAX_CANVAS_PIXELS`. */
	clamped: boolean;
}

export interface ResolutionPreset {
	label: string;
	description: string;
	longEdgePx: number;
	isDefault?: boolean;
}

/**
 * Offered resolutions, described by the pixel count along the page's long edge rather than by
 * DPI, because DPI depends on the sheet size and these sets mix A4 with A3.
 *
 * The default targets ~150 DPI on A4: architect sheets carry small dimension text, and below
 * that it stops being legible, which defeats the purpose of tracing against the reference.
 */
export const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
	{
		label: 'Standard',
		description: 'Faster, smaller. Good for rough tracing.',
		longEdgePx: 1600
	},
	{
		label: 'High',
		description: 'Recommended. Dimension text stays legible.',
		longEdgePx: 2400,
		isDefault: true
	},
	{
		label: 'Maximum',
		description: 'Sharpest, slowest, largest file.',
		longEdgePx: 3600
	}
] as const;

/** Convert PDF points to millimetres — used to show a human-readable sheet size. */
export function pointsToMillimetres(points: number): number {
	return (points / POINTS_PER_INCH) * MM_PER_INCH;
}

function isUsableNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Work out how to rasterize one page.
 *
 * @param page page size in PDF points, from `page.getViewport({ scale: 1 })`
 * @param targetLongEdgePx desired pixels along the page's long edge
 * @throws when the page size is degenerate — better to fail loudly than to hand a `NaN`
 *         scale to pdf.js and get an unexplained blank canvas
 */
export function planPageRender(page: PdfPageSize, targetLongEdgePx: number): PageRenderPlan {
	if (!isUsableNumber(page.widthPt) || !isUsableNumber(page.heightPt)) {
		throw new Error(
			`Invalid PDF page size (${page.widthPt} x ${page.heightPt} pt). The page may be corrupt.`
		);
	}

	const target = isUsableNumber(targetLongEdgePx) ? targetLongEdgePx : DEFAULT_LONG_EDGE_PX;
	const longEdgePt = Math.max(page.widthPt, page.heightPt);

	let scale = target / longEdgePt;
	let clamped = false;

	// Area grows with the square of scale, so the correction is a square root.
	const areaAtScale = page.widthPt * page.heightPt * scale * scale;
	if (areaAtScale > MAX_CANVAS_PIXELS) {
		scale *= Math.sqrt(MAX_CANVAS_PIXELS / areaAtScale);
		clamped = true;
	}

	// Round to nearest so an exact target lands exactly — floating point makes
	// `841.89 * (2000 / 841.89)` come out at 1999.999…, and flooring that loses a pixel.
	let widthPx = Math.max(1, Math.round(page.widthPt * scale));
	let heightPx = Math.max(1, Math.round(page.heightPt * scale));

	// Rounding up can only add sub-pixel area, but the clamp is a hard limit, so verify rather
	// than assume: if rounding pushed it over, floor instead.
	if (widthPx * heightPx > MAX_CANVAS_PIXELS) {
		widthPx = Math.max(1, Math.floor(page.widthPt * scale));
		heightPx = Math.max(1, Math.floor(page.heightPt * scale));
	}

	return {
		scale,
		widthPx,
		heightPx,
		dpi: (Math.max(widthPx, heightPx) / longEdgePt) * POINTS_PER_INCH,
		clamped
	};
}

/**
 * Whether a picked file looks like a PDF.
 *
 * Checks the extension as well as the mime type: browsers and operating systems hand over an
 * empty or `application/octet-stream` type often enough that trusting the type alone rejects
 * perfectly good files.
 */
export function isPdfFile(file: File): boolean {
	if (file.type === 'application/pdf') return true;

	const looksGeneric = file.type === '' || file.type === 'application/octet-stream';
	return looksGeneric && file.name.toLowerCase().endsWith('.pdf');
}
