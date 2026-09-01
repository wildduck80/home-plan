import { test, expect, type Page } from '@playwright/test';
import { seedLegacyLocalStorage, waitForHydration } from './helpers/storage';
import { legacyProject } from './helpers/legacyProject';

/**
 * Fit warnings (HP-602 / HP-603 / HP-604).
 *
 * The contract is that problems are *reported* and never *prevented*, so these specs check both:
 * a warning appears, and the offending placement is still there afterwards.
 */

async function openEditor(page: Page): Promise<void> {
	await seedLegacyLocalStorage(page, [legacyProject()]);
	await page.goto('/editor?id=legacyproj');
	await waitForHydration(page);
	await expect(page.getByText('1 room')).toBeVisible();
}

/** Place furniture directly through the store, bypassing pointer placement. */
async function addFurniture(
	page: Page,
	items: { id: string; catalogId: string; x: number; y: number; rotation?: number }[]
): Promise<void> {
	await page.evaluate(async (items) => {
		const store = await import('/src/lib/stores/project.ts');
		store.currentProject.update((project: unknown) => {
			const p = project as { floors: { id: string; furniture: unknown[] }[]; activeFloorId: string };
			const floor = p.floors.find((f) => f.id === p.activeFloorId)!;
			floor.furniture = items.map((i) => ({
				id: i.id,
				catalogId: i.catalogId,
				position: { x: i.x, y: i.y },
				rotation: i.rotation ?? 0,
				scale: { x: 1, y: 1, z: 1 }
			}));
			return p as never;
		});
	}, items);
}

async function countFurniture(page: Page): Promise<number> {
	return page.evaluate(async () => {
		const store = await import('/src/lib/stores/project.ts');
		const floor = await new Promise<{ furniture: unknown[] } | null>((resolve) => {
			const unsub = store.activeFloor.subscribe((v: unknown) => resolve(v as never));
			unsub();
		});
		return floor?.furniture.length ?? 0;
	});
}

test.describe('overlapping furniture', () => {
	test('reports a fit issue in the status bar', async ({ page }) => {
		await openEditor(page);

		// Two beds on top of each other, inside the 400x300 room.
		await addFurniture(page, [
			{ id: 'bed-a', catalogId: 'bed_queen', x: 180, y: 150 },
			{ id: 'bed-b', catalogId: 'bed_queen', x: 220, y: 150 }
		]);

		await expect(page.getByText(/fit issue/i)).toBeVisible({ timeout: 10_000 });
	});

	test('keeps the placement — the warning does not undo it', async ({ page }) => {
		await openEditor(page);
		await addFurniture(page, [
			{ id: 'bed-a', catalogId: 'bed_queen', x: 180, y: 150 },
			{ id: 'bed-b', catalogId: 'bed_queen', x: 220, y: 150 }
		]);
		await expect(page.getByText(/fit issue/i)).toBeVisible({ timeout: 10_000 });

		// PRD 16: warnings must be visible but must not block deliberate placement.
		expect(await countFurniture(page)).toBe(2);
	});

	test('stays silent when furniture does not overlap', async ({ page }) => {
		await openEditor(page);
		await addFurniture(page, [
			{ id: 'a', catalogId: 'chair', x: 80, y: 80 },
			{ id: 'b', catalogId: 'chair', x: 300, y: 220 }
		]);

		// Give detection a moment, then confirm nothing is reported.
		await page.waitForTimeout(1500);
		await expect(page.getByText(/fit issue/i)).toHaveCount(0);
	});

	test('explains the problem in the properties panel', async ({ page }) => {
		await openEditor(page);
		await addFurniture(page, [
			{ id: 'bed-a', catalogId: 'bed_queen', x: 180, y: 150 },
			{ id: 'bed-b', catalogId: 'bed_queen', x: 220, y: 150 }
		]);
		await expect(page.getByText(/fit issue/i)).toBeVisible({ timeout: 10_000 });

		await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			store.selectedElementId.set('bed-a');
		});

		// The message must name what clashes, and say the placement is kept.
		await expect(page.getByText(/overlaps/i)).toBeVisible();
		await expect(page.getByText(/the placement is kept/i)).toBeVisible();
	});
});

test.describe('door swing', () => {
	test('reports furniture blocking the door swing', async ({ page }) => {
		await openEditor(page);

		// The fixture's south wall runs right-to-left, so which side `flipSide` opens to depends on
		// the wall's direction of travel — flip it so the leaf swings *into* the room, then stand
		// a wardrobe in the way.
		await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			store.updateDoor('d1', { flipSide: true });
		});
		await addFurniture(page, [{ id: 'blocker', catalogId: 'wardrobe', x: 200, y: 255 }]);

		await expect(page.getByText(/fit issue/i)).toBeVisible({ timeout: 10_000 });

		await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			store.selectedElementId.set('blocker');
		});
		await expect(page.getByText(/door swing/i)).toBeVisible();
	});

	test('stays silent for furniture across the room from the door', async ({ page }) => {
		await openEditor(page);
		await addFurniture(page, [{ id: 'far', catalogId: 'wardrobe', x: 200, y: 60 }]);

		await page.waitForTimeout(1500);
		await expect(page.getByText(/fit issue/i)).toHaveCount(0);
	});
});

test.describe('clearance (HP-605 / HP-606)', () => {
	test('reports a blocked wardrobe opening', async ({ page }) => {
		await openEditor(page);
		await addFurniture(page, [
			{ id: 'w', catalogId: 'wardrobe', x: 200, y: 80 },
			// Directly in front of the wardrobe, inside its 90cm opening zone.
			{ id: 'blocker', catalogId: 'chair', x: 200, y: 150 }
		]);

		await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			store.selectedElementId.set('w');
		});

		await expect(page.getByText(/Wardrobe opening needs 90/i)).toBeVisible({ timeout: 10_000 });
	});

	test('stays quiet when the opening is clear', async ({ page }) => {
		await openEditor(page);
		await addFurniture(page, [
			{ id: 'w', catalogId: 'wardrobe', x: 200, y: 40 },
			// Beyond the zone: wardrobe front at y=70, zone ends at y=160.
			{ id: 'clear', catalogId: 'chair', x: 200, y: 240 }
		]);

		await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			store.selectedElementId.set('w');
		});

		await page.waitForTimeout(1500);
		await expect(page.getByText(/Wardrobe opening needs/i)).toHaveCount(0);
	});

	test('a clearance warning does not move the furniture', async ({ page }) => {
		await openEditor(page);
		await addFurniture(page, [
			{ id: 'w', catalogId: 'wardrobe', x: 200, y: 80 },
			{ id: 'blocker', catalogId: 'chair', x: 200, y: 150 }
		]);
		await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			store.selectedElementId.set('w');
		});
		await expect(page.getByText(/Wardrobe opening needs 90/i)).toBeVisible({ timeout: 10_000 });

		const positions = await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			const floor = await new Promise<{ furniture: { id: string; position: { x: number; y: number } }[] } | null>(
				(resolve) => {
					const unsub = store.activeFloor.subscribe((v: unknown) => resolve(v as never));
					unsub();
				}
			);
			return floor!.furniture.map((f) => [f.id, f.position.x, f.position.y]);
		});

		// Clearance is advisory, exactly like collision.
		expect(positions).toEqual([
			['w', 200, 80],
			['blocker', 200, 150]
		]);
	});
});
