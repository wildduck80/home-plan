import { mergeCollinearRuns, type Segment } from '$lib/import/reference/snapGeometry';
import {
	isPdfFile,
	planPageRender,
	pointsToMillimetres,
	RESOLUTION_PRESETS,
	type PageRenderPlan,
	type PdfPageSize
} from './renderPlan';

/**
 * PDF import service (HP-301).
 *
 * All pdf.js contact is confined to this module. Everything above it — the dialog, the store,
 * the canvas renderer — deals only in data URLs and plain page metadata, per the ticket's
 * technical note: *"Keep PDF rendering isolated behind an import service so the editor still
 * consumes an image/reference asset."*
 *
 * pdf.js is imported dynamically. It is well over a megabyte, and most sessions never open a
 * PDF, so it must not sit in the initial bundle — the same reasoning that already applies to
 * the 3D viewer.
 */

export interface PdfPageDescriptor extends PdfPageSize {
	pageNumber: number;
	/** Human-readable sheet size, e.g. "210 × 297 mm". */
	sizeLabel: string;
	/** True when the page holds enough vector content to plausibly be a drawing. */
	isLikelyDrawing: boolean;
}

export interface LoadedPdf {
	pageCount: number;
	pages: PdfPageDescriptor[];
	/** Render a page to a PNG data URL at (approximately) the requested long-edge pixels. */
	renderPage(pageNumber: number, targetLongEdgePx: number): Promise<RenderedPage>;
	/** Small preview for the page picker. */
	renderThumbnail(pageNumber: number, maxEdgePx?: number): Promise<string>;
	/** Release pdf.js worker resources. Always call this when the dialog closes. */
	destroy(): Promise<void>;
}

export interface RenderedPage {
	dataUrl: string;
	plan: PageRenderPlan;
	pageNumber: number;
	/**
	 * Line work from the page, merged into snap targets, in the rendered image's pixel space.
	 * Empty when the page has no usable vector geometry — a scan, for instance.
	 */
	snapSegments: Segment[];
}

export class PdfImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PdfImportError';
	}
}

/** Vector-operation count above which a page is treated as a drawing rather than paperwork. */
const DRAWING_PATH_THRESHOLD = 500;
const DEFAULT_THUMBNAIL_EDGE_PX = 220;

/**
 * pdf.js path-segment op codes, from `DrawOPS` in the bundle.
 *
 * Not exported by the package, so they are restated here. They are a stable part of the
 * serialised operator list rather than an internal detail that shifts per release, but the
 * decoder below is written to bail out safely on anything it does not recognise.
 */
const DRAW_OPS = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

/** Gap, in image pixels, that still counts as the same line when merging fragments. */
const MERGE_GAP_PX = 2;
/** Shortest merged run worth keeping, in image pixels. Filters hatching and text-as-paths. */
const MIN_SNAP_RUN_PX = 12;
/** Hard cap on stored snap targets, so a pathological drawing cannot bloat the project. */
const MAX_SNAP_SEGMENTS = 4000;

type Matrix = [number, number, number, number, number, number];

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function multiplyMatrix(a: Matrix, b: Matrix): Matrix {
	return [
		a[0] * b[0] + a[1] * b[2],
		a[0] * b[1] + a[1] * b[3],
		a[2] * b[0] + a[3] * b[2],
		a[2] * b[1] + a[3] * b[3],
		a[4] * b[0] + a[5] * b[2] + b[4],
		a[4] * b[1] + a[5] * b[3] + b[5]
	];
}

/**
 * Pull straight line segments out of a page's operator list, in the same pixel space as the
 * rendered image.
 *
 * Seeding the transform with the render viewport's own matrix is what guarantees alignment: the
 * segments then land exactly where the corresponding pixels were painted, including pdf.js's
 * y-axis flip. Doing the arithmetic independently would risk snap points sitting a fraction off
 * the line work.
 *
 * Curves contribute only their endpoints — architect plans are overwhelmingly straight lines,
 * and approximating beziers would add noise for almost no gain.
 */
function extractSegments(
	operatorList: { fnArray: number[]; argsArray: unknown[] },
	ops: Record<string, number>,
	viewportTransform: number[]
): Segment[] {
	const segments: Segment[] = [];
	const stack: Matrix[] = [];
	let ctm = [...viewportTransform] as Matrix;

	for (let i = 0; i < operatorList.fnArray.length; i++) {
		const fn = operatorList.fnArray[i];

		if (fn === ops.save) {
			stack.push([...ctm] as Matrix);
		} else if (fn === ops.restore) {
			ctm = stack.pop() ?? ctm;
		} else if (fn === ops.transform) {
			ctm = multiplyMatrix(operatorList.argsArray[i] as Matrix, ctm);
		} else if (fn === ops.constructPath) {
			const args = operatorList.argsArray[i] as [number, unknown[], unknown];
			const data = args?.[1]?.[0] as ArrayLike<number> | undefined;
			if (!data || typeof data.length !== 'number') continue;

			let current: [number, number] | null = null;
			let start: [number, number] | null = null;

			for (let j = 0; j < data.length; ) {
				const op = data[j++];

				if (op === DRAW_OPS.moveTo) {
					current = start = applyMatrix(ctm, data[j++], data[j++]);
				} else if (op === DRAW_OPS.lineTo) {
					const next = applyMatrix(ctm, data[j++], data[j++]);
					if (current) {
						segments.push({ x1: current[0], y1: current[1], x2: next[0], y2: next[1] });
					}
					current = next;
				} else if (op === DRAW_OPS.curveTo) {
					j += 4;
					current = applyMatrix(ctm, data[j++], data[j++]);
				} else if (op === DRAW_OPS.quadraticCurveTo) {
					j += 2;
					current = applyMatrix(ctm, data[j++], data[j++]);
				} else if (op === DRAW_OPS.closePath) {
					if (current && start) {
						segments.push({ x1: current[0], y1: current[1], x2: start[0], y2: start[1] });
					}
					current = start;
				} else {
					// Unrecognised op: the rest of this path cannot be decoded safely.
					break;
				}
			}
		}
	}

	return segments;
}

type PdfJsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJsModule> | null = null;

/**
 * Load pdf.js and point it at its worker.
 *
 * The worker URL is resolved through Vite's `?url` suffix so the file is emitted as a real
 * asset and hashed like any other; hard-coding a CDN would break offline use, which matters for
 * a local-first app.
 */
async function getPdfJs(): Promise<PdfJsModule> {
	if (!pdfjsPromise) {
		pdfjsPromise = (async () => {
			const pdfjs = await import('pdfjs-dist');
			const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
			pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
			return pdfjs;
		})();
	}

	return pdfjsPromise;
}

/** Render one page onto a fresh canvas and return it as a PNG data URL. */
async function renderToDataUrl(
	page: { getViewport: (o: { scale: number }) => unknown; render: (o: never) => { promise: Promise<void> } },
	plan: PageRenderPlan
): Promise<string> {
	const canvas = document.createElement('canvas');
	canvas.width = plan.widthPx;
	canvas.height = plan.heightPx;

	const context = canvas.getContext('2d');
	if (!context) throw new PdfImportError('Could not create a canvas to render the PDF page.');

	// Architect plans are line work on white. Without this the transparent areas render black
	// once the PNG is composited over the editor background.
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, canvas.width, canvas.height);

	const viewport = page.getViewport({ scale: plan.scale });
	await page.render({ canvasContext: context, viewport, canvas } as never).promise;

	const dataUrl = canvas.toDataURL('image/png');

	// Drop the backing store immediately; a 2400px sheet is tens of megabytes in memory and
	// several of these get created while browsing pages.
	canvas.width = 0;
	canvas.height = 0;

	return dataUrl;
}

/**
 * Open a PDF and describe its pages.
 *
 * @throws {PdfImportError} when the file is not a readable PDF, with a message aimed at the user
 */
/**
 * Snap targets for one page, in the rendered image's pixel space.
 *
 * Failure here is non-fatal by design: the reference image is already usable without snapping,
 * so a page whose operator list cannot be decoded should still import.
 */
async function snapTargetsFor(
	page: {
		getViewport: (o: { scale: number }) => { transform: number[] };
		getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
	},
	plan: PageRenderPlan
): Promise<Segment[]> {
	try {
		const pdfjs = await getPdfJs();
		const viewport = page.getViewport({ scale: plan.scale });
		const operatorList = await page.getOperatorList();

		const raw = extractSegments(
			operatorList,
			pdfjs.OPS as unknown as Record<string, number>,
			viewport.transform
		);

		const merged = mergeCollinearRuns(raw, {
			gapTolerance: MERGE_GAP_PX,
			angleTolerance: 1,
			minLength: MIN_SNAP_RUN_PX
		});

		// Keep the longest when over budget: long lines are the ones worth snapping to, and
		// short ones are usually hatching or lettering.
		if (merged.length > MAX_SNAP_SEGMENTS) {
			return merged
				.slice()
				.sort(
					(a, b) =>
						Math.hypot(b.x2 - b.x1, b.y2 - b.y1) - Math.hypot(a.x2 - a.x1, a.y2 - a.y1)
				)
				.slice(0, MAX_SNAP_SEGMENTS);
		}

		return merged;
	} catch (e: unknown) {
		console.warn('[PdfImport] Could not extract snap geometry; import continues without it', e);
		return [];
	}
}

export async function loadPdf(file: File): Promise<LoadedPdf> {
	if (!isPdfFile(file)) {
		throw new PdfImportError(`"${file.name}" is not a PDF file.`);
	}

	const pdfjs = await getPdfJs();
	const data = new Uint8Array(await file.arrayBuffer());

	let document_: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
	try {
		document_ = await pdfjs.getDocument({ data }).promise;
	} catch (error: unknown) {
		const detail = error instanceof Error ? error.message : 'Unknown error';
		throw new PdfImportError(`Could not read "${file.name}": ${detail}`);
	}

	if (document_.numPages < 1) {
		await document_.destroy();
		throw new PdfImportError(`"${file.name}" contains no pages.`);
	}

	const pages: PdfPageDescriptor[] = [];
	for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber++) {
		const page = await document_.getPage(pageNumber);
		const viewport = page.getViewport({ scale: 1 });

		// Path count separates drawing sheets from the paperwork that precedes them in a permit
		// set — a 36-page document where the plans are pages 28-36 is otherwise a hunt.
		let pathCount = 0;
		try {
			const ops = await page.getOperatorList();
			pathCount = ops.fnArray.filter((fn: number) => fn === pdfjs.OPS.constructPath).length;
		} catch {
			// Operator lists are an optimisation for sorting pages; failing to read one must not
			// prevent the page from being importable.
		}

		const widthMm = Math.round(pointsToMillimetres(viewport.width));
		const heightMm = Math.round(pointsToMillimetres(viewport.height));

		pages.push({
			pageNumber,
			widthPt: viewport.width,
			heightPt: viewport.height,
			sizeLabel: `${widthMm} × ${heightMm} mm`,
			isLikelyDrawing: pathCount >= DRAWING_PATH_THRESHOLD
		});

		page.cleanup();
	}

	return {
		pageCount: document_.numPages,
		pages,

		async renderPage(pageNumber: number, targetLongEdgePx: number): Promise<RenderedPage> {
			const descriptor = pages.find((entry) => entry.pageNumber === pageNumber);
			if (!descriptor) {
				throw new PdfImportError(`Page ${pageNumber} does not exist in this document.`);
			}

			const plan = planPageRender(descriptor, targetLongEdgePx);
			const page = await document_.getPage(pageNumber);
			try {
				const dataUrl = await renderToDataUrl(page as never, plan);
				return { dataUrl, plan, pageNumber, snapSegments: await snapTargetsFor(page, plan) };
			} finally {
				page.cleanup();
			}
		},

		async renderThumbnail(
			pageNumber: number,
			maxEdgePx = DEFAULT_THUMBNAIL_EDGE_PX
		): Promise<string> {
			const descriptor = pages.find((entry) => entry.pageNumber === pageNumber);
			if (!descriptor) {
				throw new PdfImportError(`Page ${pageNumber} does not exist in this document.`);
			}

			const plan = planPageRender(descriptor, maxEdgePx);
			const page = await document_.getPage(pageNumber);
			try {
				return await renderToDataUrl(page as never, plan);
			} finally {
				page.cleanup();
			}
		},

		async destroy(): Promise<void> {
			await document_.destroy();
		}
	};
}

export { RESOLUTION_PRESETS, isPdfFile, planPageRender };
export type { PageRenderPlan, PdfPageSize };
