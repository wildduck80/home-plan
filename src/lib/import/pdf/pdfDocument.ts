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
				return { dataUrl: await renderToDataUrl(page as never, plan), plan, pageNumber };
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
