import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clickUntilUrl, waitForHydration } from './helpers/storage';

/**
 * Snap-to-reference tracing (HP-304).
 *
 * Exercised against the real architect PDF, because the whole feature exists to cope with real
 * CAD line work — 63,000 fragments merged into a few hundred targets. Skipped where that file is
 * absent so the suite still passes on a fresh clone.
 */

const REAL_PDF = fileURLToPath(new URL('../private/ground-floor.pdf', import.meta.url));

test.describe('snap targets from a real vector plan', () => {
	test.skip(!existsSync(REAL_PDF), 'private/ground-floor.pdf not present');

	async function importRealPlan(page: Page): Promise<void> {
		await page.addInitScript(() => localStorage.setItem('hasSeenWelcome', '1'));
		await page.goto('/');
		await expect(page.getByText('No projects yet')).toBeVisible();
		await waitForHydration(page);
		await clickUntilUrl(page, page.getByRole('button', { name: /^Create Project$/ }), /\/editor/);
		await waitForHydration(page);
		await expect(page.getByText(/Grid/).first()).toBeVisible({ timeout: 30_000 });

		const chooser = page.waitForEvent('filechooser');
		await page.getByText('Import Image').click();
		(await chooser).setFiles(REAL_PDF);
		await expect(page.getByRole('button', { name: /Page 1/ })).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: /^Import page$/ }).click();
		await expect(page.getByRole('dialog', { name: /Import PDF/i })).not.toBeVisible();
	}

	/** The reference as stored on the active floor. */
	async function readReference(page: Page) {
		return page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			const floor = await new Promise<{ backgroundImage?: Record<string, unknown> } | null>(
				(resolve) => {
					const unsub = store.activeFloor.subscribe((v: unknown) => resolve(v as never));
					unsub();
				}
			);
			const bg = floor?.backgroundImage as
				| { locked: boolean; snapSegments?: unknown[] }
				| undefined;
			if (!bg) return null;
			return { locked: bg.locked, segmentCount: bg.snapSegments?.length ?? 0 };
		});
	}

	test('extracts a usable number of snap targets', async ({ page }) => {
		await importRealPlan(page);

		const ref = await expect
			.poll(() => readReference(page), { timeout: 60_000 })
			.not.toBeNull()
			.then(() => readReference(page));

		// 63k raw fragments merge to a few hundred lines. Anything near zero means extraction
		// silently failed; anything enormous means merging did not work.
		expect(ref!.segmentCount).toBeGreaterThan(100);
		expect(ref!.segmentCount).toBeLessThan(4001);
	});

	test('locks the reference on import so it is not dragged by accident', async ({ page }) => {
		await importRealPlan(page);

		await expect.poll(() => readReference(page), { timeout: 60_000 }).not.toBeNull();

		expect((await readReference(page))!.locked).toBe(true);
	});

	test('snap targets survive a save and reload', async ({ page }) => {
		await importRealPlan(page);
		await expect.poll(() => readReference(page), { timeout: 60_000 }).not.toBeNull();
		const before = (await readReference(page))!.segmentCount;

		await page.evaluate(async () => {
			const save = await import('/src/lib/stores/saveStatus.ts');
			await save.manualSave();
		});
		await page.reload();
		await waitForHydration(page);

		await expect.poll(() => readReference(page), { timeout: 30_000 }).not.toBeNull();
		expect((await readReference(page))!.segmentCount).toBe(before);
	});

	test('snapping lands points on the drawing, not on the grid', async ({ page }) => {
		await importRealPlan(page);
		await expect.poll(() => readReference(page), { timeout: 60_000 }).not.toBeNull();

		// Probe the pure snap path with the real stored segments: pick a segment endpoint, offset
		// slightly, and confirm the query returns the exact endpoint rather than a grid multiple.
		const result = await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			const geom = await import('/src/lib/import/reference/snapGeometry.ts');
			const floor = await new Promise<{ backgroundImage?: { snapSegments: { x1: number; y1: number; x2: number; y2: number }[] } } | null>(
				(resolve) => {
					const unsub = store.activeFloor.subscribe((v: unknown) => resolve(v as never));
					unsub();
				}
			);
			const segments = floor!.backgroundImage!.snapSegments;
			const index = geom.buildSnapIndex(segments);
			const target = segments[0];
			const hit = geom.findSnapTarget(index, { x: target.x1 + 3, y: target.y1 + 3 }, 12);
			return hit ? { kind: hit.kind, dx: hit.point.x - target.x1, dy: hit.point.y - target.y1 } : null;
		});

		expect(result).not.toBeNull();
		expect(result!.kind).toBe('endpoint');
		expect(Math.abs(result!.dx)).toBeLessThan(0.001);
		expect(Math.abs(result!.dy)).toBeLessThan(0.001);
	});
});
