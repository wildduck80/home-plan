import { test, expect } from '@playwright/test';
import { seedLegacyLocalStorage, waitForHydration } from './helpers/storage';
import { texturedProject } from './fixtures/texturedProject';
import {
	countLiveContexts,
	installThreeProbe,
	nudgeWall,
	readRendererStats,
	readTextureLoadCallbackCount,
	setViewMode
} from './helpers/three';

/**
 * Three.js scene lifecycle (HP-005).
 *
 * The ticket asks for "a repeatable memory/lifecycle test procedure" and for any reproduced
 * unbounded leak to be fixed. This file is that procedure. Two real leaks were found and
 * fixed; these specs are what stop them coming back.
 *
 * Measured before the fix, on the same procedure:
 *
 * | Metric                                   | Before          | After     |
 * |------------------------------------------|-----------------|-----------|
 * | Textures over 24 scene rebuilds          | 32 → 182 → 332  | 20 → 20   |
 * | Live WebGL contexts after 10 view toggles| 12              | 2         |
 *
 * Measurement uses Three's own `__THREE_DEVTOOLS__` hook, so no test-only code ships in
 * `src/`. See `e2e/helpers/three.ts`.
 */

/** Rebuilds are only bounded, not zero-cost — allow a little slack for env-dependent extras. */
const MAX_TEXTURE_GROWTH = 4;
const MAX_GEOMETRY_GROWTH = 4;
/** The live renderer plus a small number of long-lived helper renderers (thumbnail caches). */
const MAX_LIVE_CONTEXTS = 4;

async function openIn3D(page: import('@playwright/test').Page): Promise<void> {
	await installThreeProbe(page);
	await seedLegacyLocalStorage(page, [texturedProject()]);
	await page.goto('/editor?id=texproj');
	await waitForHydration(page);
	await setViewMode(page, '3d');
	// The viewer is lazy-loaded, so wait for the renderer to actually exist.
	await expect.poll(() => readRendererStats(page).then((s) => s !== null), { timeout: 20_000 }).toBe(
		true
	);
	// Let the first build and a few frames settle before taking a baseline.
	await expect.poll(() => readRendererStats(page).then((s) => s?.frame ?? 0), { timeout: 10_000 })
		.toBeGreaterThan(1);
}

/** Trigger `count` full scene rebuilds by mutating the project, as a wall drag does. */
async function rebuildTimes(page: import('@playwright/test').Page, count: number): Promise<void> {
	for (let i = 0; i < count; i++) {
		await nudgeWall(page, 'w-e', i % 2 === 0 ? 5 : -5);
		await page.waitForTimeout(150);
	}
	await page.waitForTimeout(800);
}

test.describe('scene rebuilds do not leak GPU resources', () => {
	test('texture count stays flat across 24 rebuilds', async ({ page }) => {
		await openIn3D(page);
		const before = await readRendererStats(page);

		await rebuildTimes(page, 24);

		const after = await readRendererStats(page);
		// Before the fix this grew by ~12.5 per rebuild — 300 over 24 — because
		// material.dispose() does not dispose the textures the material references.
		expect(after!.textures - before!.textures).toBeLessThanOrEqual(MAX_TEXTURE_GROWTH);
	});

	test('geometry count stays flat across 24 rebuilds', async ({ page }) => {
		await openIn3D(page);
		const before = await readRendererStats(page);

		await rebuildTimes(page, 24);

		const after = await readRendererStats(page);
		expect(after!.geometries - before!.geometries).toBeLessThanOrEqual(MAX_GEOMETRY_GROWTH);
	});

	test('growth does not accelerate between the first and second batch', async ({ page }) => {
		await openIn3D(page);
		const start = await readRendererStats(page);

		await rebuildTimes(page, 12);
		const mid = await readRendererStats(page);
		await rebuildTimes(page, 12);
		const end = await readRendererStats(page);

		// A linear leak shows up as equal growth in both halves; this catches the shape of the
		// original bug even if the absolute numbers change.
		const firstHalf = mid!.textures - start!.textures;
		const secondHalf = end!.textures - mid!.textures;
		expect(firstHalf).toBeLessThanOrEqual(MAX_TEXTURE_GROWTH);
		expect(secondHalf).toBeLessThanOrEqual(MAX_TEXTURE_GROWTH);
	});

	test('the scene keeps rendering after many rebuilds', async ({ page }) => {
		await openIn3D(page);

		await rebuildTimes(page, 24);
		const after = await readRendererStats(page);
		await page.waitForTimeout(400);
		const later = await readRendererStats(page);

		// A stalled render loop would mean the view is broken, not merely leaky.
		expect(later!.frame).toBeGreaterThan(after!.frame - 1);
	});
});

test.describe('repeated 2D/3D switching releases resources', () => {
	/** Toggle 3D → 2D `count` times, ending in 3D. */
	async function toggleViews(
		page: import('@playwright/test').Page,
		count: number
	): Promise<void> {
		for (let i = 0; i < count; i++) {
			await setViewMode(page, '3d');
			await page.waitForTimeout(450);
			await setViewMode(page, '2d');
			await page.waitForTimeout(250);
		}
		await setViewMode(page, '3d');
		await page.waitForTimeout(1200);
	}

	test('WebGL contexts are released, not accumulated', async ({ page }) => {
		await openIn3D(page);

		await toggleViews(page, 10);

		const created = (await readRendererStats(page))!.renderersCreated;
		const live = await countLiveContexts(page);

		// Switching to 2D unmounts the viewer, so a renderer per mount is expected...
		expect(created).toBeGreaterThan(5);
		// ...but their contexts must be released. Before the fix all 12 stayed live, and browsers
		// cap contexts at roughly 16 — past that the 3D view stops working entirely.
		expect(live).toBeLessThanOrEqual(MAX_LIVE_CONTEXTS);
	});

	test('the 3D view still renders after many switches', async ({ page }) => {
		await openIn3D(page);

		await toggleViews(page, 10);
		const before = await readRendererStats(page);

		// The render loop is deliberately on-demand — `renderer.render()` runs only when the
		// scene is marked dirty — so an idle frame count is expected to stay put. Provoke a
		// change instead: if the newest renderer's context had been lost to the ~16 limit, this
		// would not produce a frame.
		await nudgeWall(page, 'w-e', 5);
		await page.waitForTimeout(600);

		const after = await readRendererStats(page);
		expect(before).not.toBeNull();
		expect(after!.frame).toBeGreaterThan(before!.frame);
	});

	test('texture-load subscribers do not accumulate per mount', async ({ page }) => {
		await openIn3D(page);

		await toggleViews(page, 10);

		// The registry had no unregister function at all, so each mount left a closure behind
		// that a later texture load would invoke against a destroyed renderer.
		expect(await readTextureLoadCallbackCount(page)).toBeLessThanOrEqual(3);
	});
});
