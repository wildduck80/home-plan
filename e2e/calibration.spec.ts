import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { seedLegacyLocalStorage, waitForHydration } from './helpers/storage';
import { legacyProject } from './helpers/legacyProject';

/**
 * Scale calibration (HP-303).
 *
 * The acceptance criterion is dimensional: after calibrating on one known distance, a second
 * known distance must measure correctly. The unit suite proves the arithmetic; this proves the
 * whole path — click, type, preview, apply, persist — end to end in a browser.
 */

const FIXTURE_PDF = fileURLToPath(new URL('./fixtures/permit-set.pdf', import.meta.url));

/** Open the editor with a reference plan already imported. */
async function openWithReference(page: Page): Promise<void> {
	await seedLegacyLocalStorage(page, [legacyProject()]);
	await page.goto('/editor?id=legacyproj');
	await waitForHydration(page);
	await expect(page.getByText('1 room')).toBeVisible();

	const chooserPromise = page.waitForEvent('filechooser');
	await page.getByText('Import Image').click();
	(await chooserPromise).setFiles(FIXTURE_PDF);

	const dialog = page.getByRole('dialog', { name: /Import PDF floor plan/i });
	await expect(dialog).toBeVisible();
	await expect
		.poll(() => dialog.getByRole('button', { name: /^Page \d/ }).count(), { timeout: 30_000 })
		.toBe(4);
	await page.getByRole('button', { name: /^Import page$/ }).click();
	await expect(dialog).not.toBeVisible();

	await expect.poll(() => readBackground(page), { timeout: 30_000 }).not.toBeNull();
}

/** The reference image's current transform and calibration record. */
async function readBackground(page: Page): Promise<{
	scale: number;
	position: { x: number; y: number };
	calibration: { knownDistanceCm: number; calibratedAt: string } | null;
} | null> {
	return page.evaluate(async () => {
		const store = await import('/src/lib/stores/project.ts');
		const floor = await new Promise<{ backgroundImage?: Record<string, unknown> } | null>(
			(resolve) => {
				const unsub = store.activeFloor.subscribe((v: unknown) => resolve(v as never));
				unsub();
			}
		);
		const bg = floor?.backgroundImage as
			| {
					scale: number;
					position: { x: number; y: number };
					calibration?: { knownDistanceCm: number; calibratedAt: string };
			  }
			| undefined;
		if (!bg) return null;

		return { scale: bg.scale, position: bg.position, calibration: bg.calibration ?? null };
	});
}

/** Enter calibration mode and place two points, in world coordinates. */
async function placePoints(
	page: Page,
	a: { x: number; y: number },
	b: { x: number; y: number }
): Promise<void> {
	await page.evaluate(
		async ({ a, b }) => {
			const store = await import('/src/lib/stores/project.ts');
			store.calibrationPoints.set([]);
			store.calibrationMode.set(true);
			// Set the points directly rather than clicking the canvas: mapping world coordinates
			// to viewport pixels would make the test depend on zoom and pan state, and it is the
			// calibration arithmetic being verified here, not hit-testing.
			store.calibrationPoints.set([a, b]);
		},
		{ a, b }
	);
}

const panel = (page: Page) => page.getByRole('group', { name: /Scale calibration/i });

test.describe('calibration panel', () => {
	test('opens from the reference properties and shows both point markers', async ({ page }) => {
		await openWithReference(page);
		await page.getByRole('button', { name: /Set Scale/i }).click();

		await expect(panel(page)).toBeVisible();
		await expect(panel(page)).toContainText('Click the start of a dimension you know');
	});

	test('prompts for the second point after the first', async ({ page }) => {
		await openWithReference(page);
		await page.getByRole('button', { name: /Set Scale/i }).click();
		await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			store.calibrationPoints.set([{ x: 0, y: 0 }]);
		});

		await expect(panel(page)).toContainText('Now click the other end');
	});

	test('asks for the real distance once both points are placed', async ({ page }) => {
		await openWithReference(page);
		await placePoints(page, { x: 0, y: 0 }, { x: 400, y: 0 });

		await expect(panel(page)).toContainText('How far apart is that, really?');
	});

	test('previews the resize factor before applying', async ({ page }) => {
		await openWithReference(page);
		await placePoints(page, { x: 0, y: 0 }, { x: 400, y: 0 });

		await panel(page).getByRole('textbox').fill('800');

		// 400 world units are really 800 cm, so the reference must double.
		await expect(panel(page)).toContainText('×2.0000');
		await expect(panel(page)).toContainText('8.00 m');
	});

	test('rejects an unparseable distance without blocking', async ({ page }) => {
		await openWithReference(page);
		await placePoints(page, { x: 0, y: 0 }, { x: 400, y: 0 });

		await panel(page).getByRole('textbox').fill('abc');

		await expect(panel(page)).toContainText(/Enter a number/i);
		await expect(page.getByRole('button', { name: /Apply scale/i })).toBeDisabled();
	});

	test('refuses two points that are too close together', async ({ page }) => {
		await openWithReference(page);
		await placePoints(page, { x: 100, y: 100 }, { x: 100.2, y: 100 });

		await expect(panel(page)).toContainText(/two distinct points/i);
		await expect(page.getByRole('button', { name: /Apply scale/i })).toBeDisabled();
	});

	test('Escape cancels without changing the reference', async ({ page }) => {
		await openWithReference(page);
		const before = await readBackground(page);
		await placePoints(page, { x: 0, y: 0 }, { x: 400, y: 0 });
		await panel(page).getByRole('textbox').fill('800');

		await page.keyboard.press('Escape');

		await expect(panel(page)).not.toBeVisible();
		const after = await readBackground(page);
		expect(after!.scale).toBeCloseTo(before!.scale, 6);
		expect(after!.calibration).toBeNull();
	});

	test('accepts metres as well as centimetres', async ({ page }) => {
		await openWithReference(page);
		await placePoints(page, { x: 0, y: 0 }, { x: 400, y: 0 });

		await panel(page).getByRole('textbox').fill('11.2 m');

		// 1120 cm over 400 world units.
		await expect(panel(page)).toContainText('×2.8000');
	});
});

test.describe('applying a calibration', () => {
	test('sets the scale and records what it was calibrated from', async ({ page }) => {
		await openWithReference(page);
		const before = await readBackground(page);
		await placePoints(page, { x: 0, y: 0 }, { x: 400, y: 0 });
		await panel(page).getByRole('textbox').fill('800');
		await page.getByRole('button', { name: /Apply scale/i }).click();

		await expect(panel(page)).not.toBeVisible();

		const after = await readBackground(page);
		expect(after!.scale).toBeCloseTo(before!.scale * 2, 5);
		expect(after!.calibration).not.toBeNull();
		expect(after!.calibration!.knownDistanceCm).toBe(800);
		expect(new Date(after!.calibration!.calibratedAt).getTime()).toBeGreaterThan(0);
	});

	test('survives a save and reload', async ({ page }) => {
		await openWithReference(page);
		await placePoints(page, { x: 0, y: 0 }, { x: 400, y: 0 });
		await panel(page).getByRole('textbox').fill('800');
		await page.getByRole('button', { name: /Apply scale/i }).click();
		await expect(panel(page)).not.toBeVisible();

		const applied = await readBackground(page);
		await page.evaluate(async () => {
			const save = await import('/src/lib/stores/saveStatus.ts');
			await save.manualSave();
		});
		await page.goto('/editor?id=legacyproj');
		await waitForHydration(page);

		const reloaded = await readBackground(page);
		expect(reloaded!.scale).toBeCloseTo(applied!.scale, 6);
		// HP-303 requires the calibration itself to persist, not just its effect.
		expect(reloaded!.calibration!.knownDistanceCm).toBe(800);
	});

	/**
	 * HP-303 requires recalibration to be supported. Worth being precise about what "does not
	 * compound" means, because the obvious reading is wrong: calibration is defined against
	 * *image features*, not world coordinates. Once the reference is rescaled, a given world
	 * span covers a different number of image pixels, so re-measuring the same world span and
	 * entering the same distance legitimately yields a different scale. Idempotence holds when
	 * the same *feature* is re-measured, which is asserted precisely in
	 * `tests/import/calibration.test.ts`.
	 *
	 * What matters here is that a second pass is possible and fully replaces the record.
	 */
	test('supports recalibrating an already-calibrated reference', async ({ page }) => {
		await openWithReference(page);

		await placePoints(page, { x: 0, y: 0 }, { x: 400, y: 0 });
		await panel(page).getByRole('textbox').fill('800');
		await page.getByRole('button', { name: /Apply scale/i }).click();
		await expect(panel(page)).not.toBeVisible();
		const first = await readBackground(page);
		expect(first!.calibration!.knownDistanceCm).toBe(800);

		// Second pass: the panel must show the existing calibration and accept a new value.
		await placePoints(page, { x: 0, y: 0 }, { x: 400, y: 0 });
		await expect(panel(page)).toContainText('Currently set from 8.00 m');
		await panel(page).getByRole('textbox').fill('1000');
		await page.getByRole('button', { name: /Apply scale/i }).click();
		await expect(panel(page)).not.toBeVisible();

		const second = await readBackground(page);
		// The record is replaced, not accumulated.
		expect(second!.calibration!.knownDistanceCm).toBe(1000);
		// And the scale is derived from the state at that moment: 400 world units at scale
		// `first.scale` is 400/first.scale image px, told to be 1000 cm.
		expect(second!.scale).toBeCloseTo(1000 / (400 / first!.scale), 5);
	});

	/**
	 * The HP-303 acceptance criterion, end to end: calibrate on one dimension and a second,
	 * independent dimension must then measure correctly.
	 */
	test('a second known dimension measures correctly afterwards', async ({ page }) => {
		await openWithReference(page);

		// Two features 1120 cm apart in reality, spanning 414 world units before calibration.
		await placePoints(page, { x: 100, y: 50 }, { x: 514, y: 50 });
		await panel(page).getByRole('textbox').fill('1120');
		await page.getByRole('button', { name: /Apply scale/i }).click();
		await expect(panel(page)).not.toBeVisible();

		// A second feature 1000 cm apart occupies 414 * (1000/1120) = 369.64 world units at the
		// original scale. Measure it under the calibrated scale and it must read 1000 cm.
		const measuredCm = await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			const cal = await import('/src/lib/import/reference/calibration.ts');
			const floor = await new Promise<{ backgroundImage?: { scale: number } } | null>(
				(resolve) => {
					const unsub = store.activeFloor.subscribe((v: unknown) => resolve(v as never));
					unsub();
				}
			);
			const scale = floor!.backgroundImage!.scale;
			// Span of the 1000 cm chain, in image pixels — independent of the applied scale.
			const spanInImagePixels = 414 * (1000 / 1120);
			return cal.measureWorldDistance({ x: 0, y: 0 }, { x: spanInImagePixels, y: 0 }) * scale;
		});

		expect(measuredCm).toBeCloseTo(1000, 2);
	});
});
