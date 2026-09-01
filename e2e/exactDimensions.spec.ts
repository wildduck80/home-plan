import { test, expect, type Page } from '@playwright/test';
import { clickUntilUrl, seedLegacyLocalStorage, waitForHydration } from './helpers/storage';
import { legacyProject } from './helpers/legacyProject';

/**
 * Exact dimension editing (HP-401 / HP-402), and the Slice B exit criterion.
 *
 * Slice B is complete when a real floor can be traced, given exact dimensions, and yield correct
 * rooms. The arithmetic is unit-tested; this drives it through the actual panel.
 */

async function openEditor(page: Page): Promise<void> {
	await seedLegacyLocalStorage(page, [legacyProject()]);
	await page.goto('/editor?id=legacyproj');
	await waitForHydration(page);
	await expect(page.getByText('1 room')).toBeVisible();
}

/** Select a wall by id through the app's own selection store. */
async function selectWall(page: Page, wallId: string): Promise<void> {
	await page.evaluate(async (id) => {
		const store = await import('/src/lib/stores/project.ts');
		store.selectedElementId.set(id);
	}, wallId);
}

async function readWall(page: Page, wallId: string) {
	return page.evaluate(async (id) => {
		const store = await import('/src/lib/stores/project.ts');
		const floor = await new Promise<{ walls: { id: string; start: { x: number; y: number }; end: { x: number; y: number } }[]; doors: { id: string; position: number; width: number }[] } | null>(
			(resolve) => {
				const unsub = store.activeFloor.subscribe((v: unknown) => resolve(v as never));
				unsub();
			}
		);
		const wall = floor!.walls.find((w) => w.id === id)!;
		return {
			start: wall.start,
			end: wall.end,
			length: Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
		};
	}, wallId);
}

const lengthInput = (page: Page) => page.locator('input[type="number"]').first();

test.describe('exact wall length with anchors (HP-401)', () => {
	test('offers all three anchors, defaulting to Start', async ({ page }) => {
		await openEditor(page);
		await selectWall(page, 'w-n');

		const group = page.getByRole('group', { name: /Length anchor/i });
		await expect(group).toBeVisible();
		await expect(group.getByRole('button', { name: 'Start' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	test('anchoring at Start moves only the far end', async ({ page }) => {
		await openEditor(page);
		await selectWall(page, 'w-n');
		const before = await readWall(page, 'w-n');

		await lengthInput(page).fill('500');
		await lengthInput(page).press('Enter');

		const after = await readWall(page, 'w-n');
		expect(after.length).toBeCloseTo(500, 3);
		expect(after.start).toEqual(before.start);
		expect(after.end.x).not.toBeCloseTo(before.end.x, 3);
	});

	test('anchoring at End moves only the near end', async ({ page }) => {
		await openEditor(page);
		await selectWall(page, 'w-n');
		const before = await readWall(page, 'w-n');

		await page.getByRole('group', { name: /Length anchor/i }).getByRole('button', { name: 'End' }).click();
		await lengthInput(page).fill('500');
		await lengthInput(page).press('Enter');

		const after = await readWall(page, 'w-n');
		expect(after.length).toBeCloseTo(500, 3);
		expect(after.end).toEqual(before.end);
	});

	test('anchoring at Center keeps the midpoint fixed', async ({ page }) => {
		await openEditor(page);
		await selectWall(page, 'w-n');
		const before = await readWall(page, 'w-n');
		const midBefore = (before.start.x + before.end.x) / 2;

		await page.getByRole('group', { name: /Length anchor/i }).getByRole('button', { name: 'Center' }).click();
		await lengthInput(page).fill('500');
		await lengthInput(page).press('Enter');

		const after = await readWall(page, 'w-n');
		expect(after.length).toBeCloseTo(500, 3);
		expect((after.start.x + after.end.x) / 2).toBeCloseTo(midBefore, 3);
	});
});

test.describe('exact opening offsets (HP-402)', () => {
	/** The seeded fixture has one 90cm door centred on a 400cm south wall. */
	async function readDoor(page: Page) {
		return page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			const geom = await import('/src/lib/domain/wallEditing.ts');
			const floor = await new Promise<{ walls: { id: string; start: { x: number; y: number }; end: { x: number; y: number } }[]; doors: { id: string; position: number; width: number; wallId: string }[] } | null>(
				(resolve) => {
					const unsub = store.activeFloor.subscribe((v: unknown) => resolve(v as never));
					unsub();
				}
			);
			const door = floor!.doors[0];
			const wall = floor!.walls.find((w) => w.id === door.wallId)!;
			const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
			return { position: door.position, ...geom.openingOffsets(length, door.position, door.width) };
		});
	}

	test('places a door at an exact distance from the corner', async ({ page }) => {
		await openEditor(page);
		await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			store.selectedElementId.set('d1');
		});

		// The panel exposes distance-from-each-end; set the first to a stated dimension.
		const fromStart = page.getByLabel(/From wall start/i);
		await fromStart.fill('55');
		await fromStart.dispatchEvent('input');

		await expect.poll(async () => (await readDoor(page)).fromStart, { timeout: 5000 }).toBeCloseTo(
			55,
			0
		);
	});

	test('allows a door flush against a corner', async ({ page }) => {
		await openEditor(page);
		await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			store.selectedElementId.set('d1');
		});

		const fromStart = page.getByLabel(/From wall start/i);
		await fromStart.fill('0');
		await fromStart.dispatchEvent('input');

		// The old implementation clamped the centre to 5% of the wall, silently refusing a
		// legitimate architectural dimension. 0 must now mean 0.
		await expect.poll(async () => (await readDoor(page)).fromStart, { timeout: 5000 }).toBeCloseTo(
			0,
			0
		);
	});
});

/**
 * Slice B exit criterion, in the part these tickets own.
 *
 * The original version of this test tried to prove "correct rooms" by resizing two walls and
 * expecting the area to follow. That premise was wrong: walls are independent segments, so
 * changing one length breaks the loop rather than reshaping the room — the opposite wall does not
 * follow. Dragging connected geometry is `moveWallEndpoint`, a different operation.
 *
 * What HP-401/402 actually promise is that a stated dimension is honoured exactly and that
 * attached openings stay valid. Room correctness is covered by the detection suite.
 */
test.describe('Slice B exit criterion', () => {
	test('a stated wall length is honoured exactly and keeps its opening attached', async ({ page }) => {
		await openEditor(page);

		// The south wall carries the fixture's door.
		await selectWall(page, 'w-s');
		await lengthInput(page).fill('512');
		await lengthInput(page).press('Enter');

		const wall = await readWall(page, 'w-s');
		expect(wall.length).toBeCloseTo(512, 3);

		// The opening must still be on that wall and still within it.
		const door = await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			const geom = await import('/src/lib/domain/wallEditing.ts');
			const floor = await new Promise<{ walls: { id: string; start: { x: number; y: number }; end: { x: number; y: number } }[]; doors: { id: string; wallId: string; position: number; width: number }[] } | null>(
				(resolve) => {
					const unsub = store.activeFloor.subscribe((v: unknown) => resolve(v as never));
					unsub();
				}
			);
			const d = floor!.doors[0];
			const w = floor!.walls.find((x) => x.id === d.wallId)!;
			const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
			return { wallId: d.wallId, ...geom.openingOffsets(len, d.position, d.width) };
		});

		expect(door.wallId).toBe('w-s');
		// Both clearances non-negative means the door still fits on the wall.
		expect(door.fromStart).toBeGreaterThanOrEqual(0);
		expect(door.fromEnd).toBeGreaterThanOrEqual(0);
	});

	test('the floor still reports a room after an exact correction', async ({ page }) => {
		await openEditor(page);
		await selectWall(page, 'w-n');

		await lengthInput(page).fill('400');
		await lengthInput(page).press('Enter');

		// Setting the same length back must leave the closed 400x300 room intact at 12 m².
		await expect(page.getByText('1 room')).toBeVisible();
		await expect(page.getByText('12.0 m²').first()).toBeVisible();
	});
});
