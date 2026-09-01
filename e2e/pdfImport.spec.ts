import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedLegacyLocalStorage, waitForHydration } from './helpers/storage';
import { legacyProject } from './helpers/legacyProject';

/**
 * PDF reference import (HP-301).
 *
 * Rendering needs a real canvas, so this is the layer where import is actually verified — the
 * unit suite covers only the rasterization arithmetic (`tests/import/pdfRenderPlan.test.ts`).
 *
 * The committed fixture mirrors the shape of a real architect permit set: paperwork first,
 * drawings at the end, mixed A4/A3. There are also assertions against the author's real
 * architect PDF, which lives in the gitignored `private/` directory and is therefore skipped
 * on any other machine — the suite must pass on a fresh clone.
 */

const FIXTURE_PDF = fileURLToPath(new URL('./fixtures/permit-set.pdf', import.meta.url));
const REAL_PDF = fileURLToPath(new URL('../private/ground-floor.pdf', import.meta.url));

/** Open the editor on a project, ready to import a reference. */
async function openEditor(page: Page): Promise<void> {
	await seedLegacyLocalStorage(page, [legacyProject()]);
	await page.goto('/editor?id=legacyproj');
	await waitForHydration(page);
	await expect(page.getByText('1 room')).toBeVisible();
}

/**
 * Click "Import Image", hand the file chooser a path, and wait for the picker to settle.
 *
 * Waiting for the page buttons matters: reading the document is async, so on a cold Vite
 * compile the dialog can be visible with an empty grid while pdf.js is still parsing. Asserting
 * before then produced a one-in-sixteen failure that looked like a preselection bug.
 */
async function importFile(page: Page, path: string, expectedPages?: number): Promise<void> {
	const chooserPromise = page.waitForEvent('filechooser');
	await page.getByText('Import Image').click();
	const chooser = await chooserPromise;
	await chooser.setFiles(path);

	const dialog = page.getByRole('dialog', { name: /Import PDF floor plan/i });
	await expect(dialog).toBeVisible();

	const pageButtons = dialog.getByRole('button', { name: /^Page \d/ });
	if (expectedPages === undefined) {
		await expect.poll(() => pageButtons.count(), { timeout: 30_000 }).toBeGreaterThan(0);
	} else {
		await expect.poll(() => pageButtons.count(), { timeout: 30_000 }).toBe(expectedPages);
	}
}

/** The reference image currently attached to the active floor, read from the store. */
async function readBackgroundImage(page: Page): Promise<{
	dataUrlPrefix: string;
	dataUrlLength: number;
	opacity: number;
	scale: number;
	locked: boolean;
} | null> {
	return page.evaluate(async () => {
		const store = await import('/src/lib/stores/project.ts');
		const floor = await new Promise<{ backgroundImage?: Record<string, unknown> } | null>(
			(resolve) => {
				const unsub = store.activeFloor.subscribe((value: unknown) => resolve(value as never));
				unsub();
			}
		);
		const bg = floor?.backgroundImage as
			| { dataUrl: string; opacity: number; scale: number; locked: boolean }
			| undefined;
		if (!bg) return null;

		return {
			dataUrlPrefix: bg.dataUrl.slice(0, 20),
			dataUrlLength: bg.dataUrl.length,
			opacity: bg.opacity,
			scale: bg.scale,
			locked: bg.locked
		};
	});
}

/** Natural pixel size of the imported reference image, decoded in the browser. */
async function readBackgroundPixelSize(page: Page): Promise<{ width: number; height: number }> {
	return page.evaluate(async () => {
		const store = await import('/src/lib/stores/project.ts');
		const floor = await new Promise<{ backgroundImage?: { dataUrl: string } } | null>((resolve) => {
			const unsub = store.activeFloor.subscribe((value: unknown) => resolve(value as never));
			unsub();
		});
		const dataUrl = floor?.backgroundImage?.dataUrl;
		if (!dataUrl) throw new Error('no background image');

		const img = new Image();
		await new Promise((resolve, reject) => {
			img.onload = resolve;
			img.onerror = reject;
			img.src = dataUrl;
		});
		return { width: img.naturalWidth, height: img.naturalHeight };
	});
}

test.describe('PDF page picker', () => {
	test('lists every page and flags the drawings', async ({ page }) => {
		await openEditor(page);
		await importFile(page, FIXTURE_PDF, 4);

		await expect(page.getByRole('dialog', { name: /Import PDF floor plan/i })).toBeVisible();
		await expect(page.getByText('4 pages')).toBeVisible();

		// Pages 3 and 4 carry dense line work; 1 and 2 are paperwork.
		await expect(page.getByRole('button', { name: /Page 3/ })).toContainText('PLAN');
		await expect(page.getByRole('button', { name: /Page 4/ })).toContainText('PLAN');
		await expect(page.getByRole('button', { name: /Page 1/ })).not.toContainText('PLAN');
	});

	test('preselects the first drawing rather than page 1', async ({ page }) => {
		await openEditor(page);
		await importFile(page, FIXTURE_PDF, 4);

		// In a permit set page 1 is a cover sheet, so defaulting to it would be wrong.
		await expect(page.getByRole('button', { name: /Page 3/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(page.getByRole('button', { name: /Page 1/ })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
	});

	test('shows each sheet size', async ({ page }) => {
		await openEditor(page);
		await importFile(page, FIXTURE_PDF, 4);

		await expect(page.getByRole('button', { name: /Page 1/ })).toContainText('210 × 297 mm');
		await expect(page.getByRole('button', { name: /Page 3/ })).toContainText('420 × 297 mm');
	});

	test('renders thumbnails for every page', async ({ page }) => {
		await openEditor(page);
		await importFile(page, FIXTURE_PDF, 4);

		const thumbnails = page.locator('div[role="dialog"] img[alt^="Page"]');
		await expect.poll(() => thumbnails.count(), { timeout: 20_000 }).toBe(4);
	});

	test('closes on Escape without importing', async ({ page }) => {
		await openEditor(page);
		await importFile(page, FIXTURE_PDF, 4);
		await expect(page.getByRole('dialog', { name: /Import PDF/i })).toBeVisible();

		await page.keyboard.press('Escape');

		await expect(page.getByRole('dialog', { name: /Import PDF/i })).not.toBeVisible();
		expect(await readBackgroundImage(page)).toBeNull();
	});
});

test.describe('importing a page as the reference layer', () => {
	test('attaches the rendered page to the active floor', async ({ page }) => {
		await openEditor(page);
		await importFile(page, FIXTURE_PDF, 4);
		await page.getByRole('button', { name: /^Import page$/ }).click();

		await expect(page.getByRole('dialog', { name: /Import PDF/i })).not.toBeVisible();

		const bg = await expect
			.poll(() => readBackgroundImage(page), { timeout: 30_000 })
			.not.toBeNull()
			.then(() => readBackgroundImage(page));

		expect(bg!.dataUrlPrefix).toContain('data:image/png');
		// A rendered architect sheet is substantial; a near-empty string would mean a blank canvas.
		expect(bg!.dataUrlLength).toBeGreaterThan(20_000);
		// Defaults that make a reference traceable rather than opaque.
		expect(bg!.opacity).toBeCloseTo(0.4, 2);
		expect(bg!.locked).toBe(false);
	});

	test('renders at the selected resolution', async ({ page }) => {
		await openEditor(page);
		await importFile(page, FIXTURE_PDF, 4);
		// Page 3 is A3 landscape (420x297mm).
		await page.getByRole('button', { name: /Page 3/ }).click();
		await page.getByRole('button', { name: /^Standard$/ }).click();
		await page.getByRole('button', { name: /^Import page$/ }).click();

		await expect.poll(() => readBackgroundImage(page), { timeout: 30_000 }).not.toBeNull();

		const size = await readBackgroundPixelSize(page);
		// Standard targets 1600px on the long edge, which for landscape is the width.
		expect(size.width).toBe(1600);
		expect(size.width).toBeGreaterThan(size.height);
		// Aspect ratio must match the sheet: 420/297.
		expect(size.width / size.height).toBeCloseTo(420 / 297, 1);
	});

	test('respects the canvas pixel ceiling at maximum resolution', async ({ page }) => {
		await openEditor(page);
		await importFile(page, FIXTURE_PDF, 4);
		await page.getByRole('button', { name: /Page 3/ }).click();
		await page.getByRole('button', { name: /^Maximum$/ }).click();
		await page.getByRole('button', { name: /^Import page$/ }).click();

		await expect.poll(() => readBackgroundImage(page), { timeout: 40_000 }).not.toBeNull();

		const size = await readBackgroundPixelSize(page);
		// A3 at 3600px long edge would be ~9.1M pixels — under the 16M ceiling, so unclamped.
		// The point is that it renders at all: exceeding a canvas limit yields a blank image
		// rather than an error, so a non-trivial decoded size is the real assertion.
		expect(size.width * size.height).toBeLessThanOrEqual(16_000_000);
		expect(size.width).toBeGreaterThan(1600);
	});

	test('a raster image still imports directly, without the page picker', async ({ page }) => {
		await openEditor(page);

		// A 1x1 PNG — the non-PDF path must be untouched by this feature.
		const chooserPromise = page.waitForEvent('filechooser');
		await page.getByText('Import Image').click();
		const chooser = await chooserPromise;
		await chooser.setFiles({
			name: 'plan.png',
			mimeType: 'image/png',
			buffer: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
				'base64'
			)
		});

		await expect(page.getByRole('dialog', { name: /Import PDF/i })).not.toBeVisible();
		await expect.poll(() => readBackgroundImage(page), { timeout: 10_000 }).not.toBeNull();
	});
});

/**
 * The real architect plan. Skipped unless `private/ground-floor.pdf` is present, so the suite
 * still passes on a clone that does not have it.
 */
test.describe('the real architect plan', () => {
	test.skip(!existsSync(REAL_PDF), 'private/ground-floor.pdf not present');

	test('imports as a single-page A4 drawing', async ({ page }) => {
		await openEditor(page);
		await importFile(page, REAL_PDF, 1);

		await expect(page.getByRole('dialog', { name: /Import PDF/i })).toBeVisible();
		await expect(page.getByText('1 page')).toBeVisible();
		// ~9,900 vector paths, so it must be recognised as a drawing.
		await expect(page.getByRole('button', { name: /Page 1/ })).toContainText('PLAN');
		await expect(page.getByRole('button', { name: /Page 1/ })).toContainText('210 × 297 mm');
	});

	test('renders legibly at the default resolution', async ({ page }) => {
		await openEditor(page);
		await importFile(page, REAL_PDF, 1);
		await page.getByRole('button', { name: /^Import page$/ }).click();

		await expect.poll(() => readBackgroundImage(page), { timeout: 60_000 }).not.toBeNull();

		const size = await readBackgroundPixelSize(page);
		// High preset: 2400px long edge on a portrait A4 sheet.
		expect(size.height).toBe(2400);
		expect(size.width / size.height).toBeCloseTo(210 / 297, 1);

		const bg = await readBackgroundImage(page);
		// A dense CAD sheet compresses to well over a megabyte of PNG; anything tiny would mean
		// the vector content failed to rasterize.
		expect(bg!.dataUrlLength).toBeGreaterThan(200_000);
	});
});
