import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import {
	FLOOR_COLLECTION_KEYS,
	compareBackendCapacity,
	readDatabaseLayout,
	readLegacyLocalStorage,
	readStoredMeta,
	readStoredProject,
	readStoredProjects,
	readStoredThumbnails,
	waitForAppDatabase,
	waitForHydration,
	seedLegacyLocalStorage
} from './helpers/storage';
import { LEGACY_PROJECT_ROOM_AREA_M2, legacyProject } from './helpers/legacyProject';

/**
 * Storage flow (HP-105, with HP-102/103 assertions along the way).
 *
 * This is the automated version of a manual browser pass done on 2026-08-31. That pass proved
 * the storage layer works; this suite is what stops it silently breaking later. It deliberately
 * asserts against IndexedDB records rather than the UI, because a read that silently returned
 * nothing would leave the UI looking plausibly empty.
 */

/** Collect console errors so every test can assert the page stayed clean. */
function trackConsoleErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (message: ConsoleMessage) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
	return errors;
}

test.describe('IndexedDB is the primary store', () => {
	test('creates the expected database layout on first load', async ({ page }) => {
		await page.goto('/');
		await waitForAppDatabase(page);

		const layout = await readDatabaseLayout(page);

		expect(layout).not.toBeNull();
		expect(layout!.version).toBe(1);
		expect(layout!.objectStores).toEqual(['meta', 'projects', 'thumbnails']);
		// Listing sorts by recency, so the index must exist rather than reading every record.
		expect(layout!.projectIndexes).toContain('updatedAt');
	});

	test('accepts a payload localStorage rejects', async ({ page }) => {
		await page.goto('/');
		await waitForAppDatabase(page);

		// 12 MB — comfortably past a ~5 MB localStorage origin cap, and representative of a
		// traced architect plan held as an inline data URL.
		const result = await compareBackendCapacity(page, 12 * 1024 * 1024);

		expect(result.localStorage).toBe('QuotaExceededError');
		expect(result.indexedDb.stored).toBe(true);
		// Byte-identical round-trip through structured clone.
		expect(result.indexedDb.readBackLength).toBe(result.payloadLength);
	});
});

test.describe('migration from the localStorage build', () => {
	test.beforeEach(async ({ page }) => {
		// Each Playwright test gets a fresh context with empty storage, so seeding before the
		// first navigation is enough to exercise the one-time migration on a genuine cold start.
		await seedLegacyLocalStorage(page, [legacyProject()]);
	});

	test('shows the migrated project in the project list', async ({ page }) => {
		const errors = trackConsoleErrors(page);
		await page.goto('/');

		await expect(page.getByText('Legacy Bungalow')).toBeVisible();
		// The fixture's updatedAt (2026-02-02), not the migration time. Rendered via
		// toLocaleDateString, so the exact separator/padding is locale-dependent — match loosely.
		await expect(page.getByText(/0?2[/.-]0?2[/.-]2026/)).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('stores the project with the current schema version', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Legacy Bungalow')).toBeVisible();

		const record = await readStoredProject(page, 'legacyproj');

		expect(record).not.toBeNull();
		expect(record!.name).toBe('Legacy Bungalow');
		expect(record!.updatedAt).toBe('2026-02-02T18:45:12.000Z');
		// v1 (unversioned) must have been migrated to v2 on the way in.
		expect(record!.data.schemaVersion).toBe(2);
	});

	test('backfills every floor collection the legacy floor omitted', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Legacy Bungalow')).toBeVisible();

		const record = await readStoredProject(page, 'legacyproj');
		const floor = record!.data.floors[0] as unknown as Record<string, unknown>;

		for (const key of FLOOR_COLLECTION_KEYS) {
			expect(Array.isArray(floor[key]), `floor.${key} should be an array`).toBe(true);
		}
		// The fixture supplied only these two; the rest must be present but empty.
		expect(floor.walls).toHaveLength(4);
		expect(floor.doors).toHaveLength(1);
		expect(floor.rooms).toHaveLength(0);
		expect(floor.furniture).toHaveLength(0);
		expect(floor.groups).toHaveLength(0);
	});

	test('preserves element ids and opening references', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Legacy Bungalow')).toBeVisible();

		const record = await readStoredProject(page, 'legacyproj');
		const floor = record!.data.floors[0];

		expect(floor.walls.map((w) => w.id)).toEqual(['w-n', 'w-e', 'w-s', 'w-w']);
		// A remapping bug here would silently detach the door from its wall.
		expect(floor.doors[0].wallId).toBe('w-s');
	});

	test('carries the thumbnail across and records the migration', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Legacy Bungalow')).toBeVisible();

		const thumbnails = await readStoredThumbnails(page);
		const meta = await readStoredMeta(page);

		expect(thumbnails.map((t) => t.id)).toContain('legacyproj');
		expect(meta.map((m) => m.key)).toContain('localStorageMigrated');
	});

	test('leaves localStorage intact as a fallback copy', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Legacy Bungalow')).toBeVisible();

		const legacy = await readLegacyLocalStorage(page);

		// The old copy is the user's safety net if IndexedDB misbehaves; migration must never
		// delete it (HP-105 explicitly forbids destructive behaviour here).
		expect(legacy.projectsPresent).toBe(true);
		expect(legacy.thumbnailKeys).toContain('floorplan_thumb_legacyproj');
	});

	test('does not duplicate the project on repeated loads', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Legacy Bungalow')).toBeVisible();
		await page.goto('/');
		await expect(page.getByText('Legacy Bungalow')).toBeVisible();
		await page.goto('/');
		await expect(page.getByText('Legacy Bungalow')).toBeVisible();

		expect(await readStoredProjects(page)).toHaveLength(1);
	});
});

test.describe('the migrated project opens and renders', () => {
	test.beforeEach(async ({ page }) => {
		await seedLegacyLocalStorage(page, [legacyProject()]);
	});

	test('renders the normalized geometry and detects the room', async ({ page }) => {
		const errors = trackConsoleErrors(page);
		await page.goto('/editor?id=legacyproj');

		// Status bar is the app's own summary of what it loaded and detected.
		await expect(page.getByText('4 walls')).toBeVisible();
		await expect(page.getByText('1 door')).toBeVisible();
		await expect(page.getByText('1 room')).toBeVisible();
		// 400x300 cm centreline area — the same expectation as the simple-room unit fixture.
		await expect(page.getByText(`${LEGACY_PROJECT_ROOM_AREA_M2.toFixed(1)} m²`).first()).toBeVisible();
		expect(errors).toEqual([]);
	});
});

test.describe('authored room metadata survives a geometry edit (HP-202)', () => {
	test('keeps name, colour and texture when a wall length changes', async ({ page }) => {
		await seedLegacyLocalStorage(page, [legacyProject()]);
		await page.goto('/editor?id=legacyproj');
		await expect(page.getByText('1 room')).toBeVisible();
		await waitForHydration(page);

		// Author the three fields through the store, so this test targets reconciliation rather
		// than the room properties panel's widgets.
		await authorRoomMetadata(page);
		await changeSelectedWallLength(page, 'w-e', 400);
		await saveProject(page);

		const record = await readStoredProject(page, 'legacyproj');
		const rooms = record!.data.floors[0].rooms;
		const eastWall = record!.data.floors[0].walls.find((w) => w.id === 'w-e');

		// Geometry genuinely changed...
		expect(eastWall!.end).toEqual({ x: 400, y: 400 });
		// ...and the authored fields came through anyway.
		expect(rooms).toHaveLength(1);
		expect(rooms[0].name).toBe('Master Bedroom');
		expect(rooms[0].color).toBe('#f4c2c2');
		expect(rooms[0].floorTexture).toBe('walnut');
	});

	test('keeps the same room id across the edit', async ({ page }) => {
		await seedLegacyLocalStorage(page, [legacyProject()]);
		await page.goto('/editor?id=legacyproj');
		await expect(page.getByText('1 room')).toBeVisible();
		await waitForHydration(page);

		await authorRoomMetadata(page);
		await saveProject(page);
		const before = (await readStoredProject(page, 'legacyproj'))!.data.floors[0].rooms[0].id;

		await changeSelectedWallLength(page, 'w-e', 400);
		await saveProject(page);
		const after = (await readStoredProject(page, 'legacyproj'))!.data.floors[0].rooms[0].id;

		expect(after).toBe(before);
	});
});

test.describe('save and reload', () => {
	test('persists an edit across a full page reload', async ({ page }) => {
		await seedLegacyLocalStorage(page, [legacyProject()]);
		await page.goto('/editor?id=legacyproj');
		await expect(page.getByText('1 room')).toBeVisible();
		await waitForHydration(page);

		await authorRoomMetadata(page);
		await saveProject(page);

		// Full reload — new page load, store re-resolved, project re-read from IndexedDB.
		await page.goto('/editor?id=legacyproj');

		// Room labels are painted onto <canvas>, so they are not DOM text — assert that the app
		// re-read and re-detected the room, then that the authored name came back from storage.
		await expect(page.getByText('1 room')).toBeVisible();
		const record = await readStoredProject(page, 'legacyproj');
		expect(record!.data.floors[0].rooms[0].name).toBe('Master Bedroom');
	});

	test('creating a project from the empty state persists it', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('hasSeenWelcome', '1'));
		await page.goto('/');
		await expect(page.getByText('No projects yet')).toBeVisible();
		// Must not click SSR'd markup before hydration — see waitForHydration.
		await waitForHydration(page);

		await page.getByRole('button', { name: /^Create Project$/ }).click();
		await expect(page).toHaveURL(/\/editor/);

		await page.goto('/');

		const stored = await readStoredProjects(page);
		expect(stored).toHaveLength(1);
	});

	test('creating a second project from the header persists it', async ({ page }) => {
		await seedLegacyLocalStorage(page, [legacyProject()]);
		await page.goto('/');
		await expect(page.getByText('Legacy Bungalow')).toBeVisible();
		await waitForHydration(page);

		await page.getByRole('button', { name: /^New Project$/ }).click();
		await expect(page).toHaveURL(/\/editor/);

		await page.goto('/');

		expect(await readStoredProjects(page)).toHaveLength(2);
	});
});

/**
 * Set name, colour and floor texture on the floor's single detected room.
 *
 * Goes through the app's own `updateRoom` command via the detected-rooms store, which is the
 * same path the properties panel uses, so reconciliation sees genuinely authored data.
 */
async function authorRoomMetadata(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const mod = await import('/src/lib/stores/project.ts');
		const detected = mod.detectedRoomsStore;
		const rooms = await new Promise<{ id: string }[]>((resolve) => {
			const unsub = detected.subscribe((value: { id: string }[]) => resolve(value));
			unsub();
		});
		if (rooms.length === 0) throw new Error('no detected rooms to author');
		mod.updateRoom(rooms[0].id, {
			name: 'Master Bedroom',
			color: '#f4c2c2',
			floorTexture: 'walnut'
		});
	});
}

/** Change one wall's length through the app's own command, as the properties panel does. */
async function changeSelectedWallLength(
	page: Page,
	wallId: string,
	lengthCm: number
): Promise<void> {
	await page.evaluate(
		async ({ wallId, lengthCm }) => {
			const mod = await import('/src/lib/stores/project.ts');
			const project = await new Promise<{ floors: { id: string; walls: { id: string; start: { x: number; y: number }; end: { x: number; y: number } }[] }[]; activeFloorId: string }>(
				(resolve) => {
					const unsub = mod.currentProject.subscribe((value: unknown) => resolve(value as never));
					unsub();
				}
			);
			const floor = project.floors.find((f) => f.id === project.activeFloorId)!;
			const wall = floor.walls.find((w) => w.id === wallId)!;
			// Extend along the wall's own direction, keeping `start` fixed.
			const dx = wall.end.x - wall.start.x;
			const dy = wall.end.y - wall.start.y;
			const current = Math.hypot(dx, dy);
			const scale = lengthCm / current;
			mod.updateWall(wallId, {
				end: { x: wall.start.x + dx * scale, y: wall.start.y + dy * scale }
			});
		},
		{ wallId, lengthCm }
	);
}

/** Trigger a manual save and wait for the store to confirm it. */
async function saveProject(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const mod = await import('/src/lib/stores/saveStatus.ts');
		await mod.manualSave();
	});
}
