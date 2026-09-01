import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Storage helpers for the E2E suite.
 *
 * These reach into IndexedDB directly rather than inferring state from the UI. That matters:
 * if reads silently returned nothing the UI would look plausibly empty, so asserting on the
 * stored records is the only way to know persistence actually happened.
 */

export const DB_NAME = 'openplan3d';
export const LEGACY_PROJECTS_KEY = 'floorplan_projects';
export const LEGACY_THUMB_PREFIX = 'floorplan_thumb_';

/** Shape of a stored project record, mirroring `StoredProject` in src/lib/services/idbStore.ts. */
export interface StoredProjectRecord {
	id: string;
	name: string;
	updatedAt: string;
	data: {
		schemaVersion: number;
		id: string;
		name: string;
		activeFloorId: string;
		floors: StoredFloor[];
	};
}

export interface StoredFloor {
	id: string;
	name: string;
	level: number;
	walls: { id: string; start: { x: number; y: number }; end: { x: number; y: number } }[];
	rooms: {
		id: string;
		name: string;
		walls: string[];
		floorTexture: string;
		area: number;
		color?: string;
		roomType?: string;
		labelOffset?: { x: number; y: number };
	}[];
	doors: { id: string; wallId: string }[];
	[key: string]: unknown;
}

export interface DatabaseLayout {
	version: number;
	objectStores: string[];
	projectIndexes: string[];
}

/** Every array-valued field a normalized `Floor` must have (HP-103). */
export const FLOOR_COLLECTION_KEYS = [
	'walls',
	'rooms',
	'doors',
	'windows',
	'furniture',
	'stairs',
	'columns',
	'guides',
	'measurements',
	'annotations',
	'textAnnotations',
	'groups'
] as const;

/**
 * A genuinely valid 1x1 PNG.
 *
 * Seeding a fake string like `data:image/jpeg;base64,SEED` makes the browser emit a real
 * `ERR_INVALID_URL` console error when the project list renders the thumbnail — which would
 * then be indistinguishable from an application fault in the console assertions.
 */
export const TINY_PNG_DATA_URL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/**
 * Wait until the app has created its database with all object stores present.
 *
 * Checks `indexedDB.databases()` *before* opening, because a versionless `indexedDB.open()`
 * on a database that does not exist yet silently **creates** an empty one — a probe that
 * fabricates the thing it is measuring, and then breaks every later assertion because the
 * object stores are missing.
 *
 * Note there is no `resetStorage` helper: Playwright gives each test a fresh browser context
 * with its own empty IndexedDB and localStorage, so tests start clean without help. Clearing
 * by hand is worse than useless here — `deleteDatabase` can be blocked by the page's own open
 * connection, leaving the migration flag behind and silently skipping the migration under test.
 */
export async function waitForAppDatabase(page: Page): Promise<void> {
	// `expect.poll`, not `page.waitForFunction`: the latter checks the *truthiness of the
	// returned value*, and an async predicate returns a Promise, which is always truthy — so it
	// resolves on the first poll regardless of the condition. That silently defeated this wait
	// and let later assertions read a database the app had not created yet.
	await expect
		.poll(async () => (await readDatabaseLayout(page))?.objectStores ?? [], { timeout: 15_000 })
		.toEqual(['meta', 'projects', 'thumbnails']);
}

/**
 * Seed `localStorage` the way the pre-HP-105 build would have, *before* any app code runs.
 *
 * Uses `addInitScript` so the seed is in place when the app first resolves its data store —
 * seeding after load would miss the one-time migration entirely.
 */
export async function seedLegacyLocalStorage(
	page: Page,
	projects: Record<string, unknown>[],
	options: { thumbnails?: boolean } = {}
): Promise<void> {
	const withThumbnails = options.thumbnails ?? true;

	await page.addInitScript(
		({ projects, withThumbnails, projectsKey, thumbPrefix, tinyPng }) => {
			const map: Record<string, string> = {};
			for (const project of projects) {
				map[(project as { id: string }).id] = JSON.stringify(project);
				if (withThumbnails) {
					localStorage.setItem(`${thumbPrefix}${(project as { id: string }).id}`, tinyPng);
				}
			}
			localStorage.setItem(projectsKey, JSON.stringify(map));
			// Skip the first-run welcome overlay so the project list is directly assertable.
			localStorage.setItem('hasSeenWelcome', '1');
		},
		{
			projects,
			withThumbnails,
			projectsKey: LEGACY_PROJECTS_KEY,
			thumbPrefix: LEGACY_THUMB_PREFIX,
			tinyPng: TINY_PNG_DATA_URL
		}
	);
}

/**
 * Wait until the client-side app has hydrated, so clicks actually reach Svelte handlers.
 *
 * SvelteKit server-renders the markup, so a button is present, visible and "actionable" to
 * Playwright *before* any JavaScript has attached behaviour to it. Clicking in that window is
 * silently swallowed: the native event fires and bubbles, but Svelte's delegated `onclick`
 * does not exist yet, so nothing happens and the test fails with no error to explain it.
 *
 * That window is invisible on warm runs and only opens on a cold Vite compile, which makes it
 * a textbook intermittent failure — worth a named helper rather than a `waitForTimeout`.
 *
 * A dynamic import of an app module resolving proves the client bundle has loaded and executed.
 */
export async function waitForHydration(page: Page): Promise<void> {
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					import('/src/lib/stores/project.ts')
						.then(() => true)
						.catch(() => false)
				),
			{ timeout: 30_000 }
		)
		.toBe(true);
}

/**
 * Click a control until the URL matches, retrying if nothing happens.
 *
 * `waitForHydration` proves the client bundle has *loaded*, not that SvelteKit has finished
 * attaching handlers — on a cold Vite compile there is a window where a button is visible and
 * actionable but its click is silently discarded. Retrying is the only reliable remedy, and it
 * is safe here because the action is idempotent from the user's point of view: either a project
 * was created and we navigate, or nothing happened at all.
 */
export async function clickUntilUrl(
	page: Page,
	locator: Locator,
	urlPattern: RegExp,
	attempts = 6
): Promise<void> {
	for (let attempt = 0; attempt < attempts; attempt++) {
		await locator.click();
		try {
			await page.waitForURL(urlPattern, { timeout: 4000, waitUntil: 'commit' });
			return;
		} catch {
			if (urlPattern.test(page.url())) return;
			// Handler not attached yet; give hydration a moment and try again.
			await page.waitForTimeout(500);
		}
	}
	throw new Error(`Clicking did not navigate to ${urlPattern} after ${attempts} attempts.`);
}

/**
 * Report the app database's structure, or `null` if it does not exist.
 *
 * Never creates it — see `waitForAppDatabase` for why that distinction matters.
 */
export async function readDatabaseLayout(page: Page): Promise<DatabaseLayout | null> {
	return page.evaluate(async (dbName) => {
		const databases = await indexedDB.databases();
		if (!databases.some((entry) => entry.name === dbName)) return null;

		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(dbName);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

		const layout = {
			version: db.version,
			objectStores: [...db.objectStoreNames].sort(),
			projectIndexes: db.objectStoreNames.contains('projects')
				? [...db.transaction('projects').objectStore('projects').indexNames].sort()
				: []
		};
		db.close();
		return layout;
	}, DB_NAME);
}

/** All records from one object store, or `[]` if the database or store is absent. */
async function readStore<T>(page: Page, storeName: string): Promise<T[]> {
	return page.evaluate(
		async ({ dbName, storeName }) => {
			// Check before opening — a versionless open would create an empty database.
			const databases = await indexedDB.databases();
			if (!databases.some((entry) => entry.name === dbName)) return [];

			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(dbName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});

			if (!db.objectStoreNames.contains(storeName)) {
				db.close();
				return [];
			}

			const records = await new Promise<unknown[]>((resolve, reject) => {
				const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			db.close();
			return records;
		},
		{ dbName: DB_NAME, storeName }
	) as Promise<T[]>;
}

export function readStoredProjects(page: Page): Promise<StoredProjectRecord[]> {
	return readStore<StoredProjectRecord>(page, 'projects');
}

export function readStoredThumbnails(page: Page): Promise<{ id: string; dataUrl: string }[]> {
	return readStore<{ id: string; dataUrl: string }>(page, 'thumbnails');
}

export function readStoredMeta(page: Page): Promise<{ key: string; value: unknown }[]> {
	return readStore<{ key: string; value: unknown }>(page, 'meta');
}

/** One stored project by id, or null. */
export async function readStoredProject(
	page: Page,
	id: string
): Promise<StoredProjectRecord | null> {
	const all = await readStoredProjects(page);
	return all.find((record) => record.id === id) ?? null;
}

/** Whether the legacy localStorage entries are still present — migration must not remove them. */
export async function readLegacyLocalStorage(
	page: Page
): Promise<{ projectsPresent: boolean; thumbnailKeys: string[] }> {
	return page.evaluate(
		({ projectsKey, thumbPrefix }) => ({
			projectsPresent: localStorage.getItem(projectsKey) !== null,
			thumbnailKeys: Object.keys(localStorage).filter((key) => key.startsWith(thumbPrefix))
		}),
		{ projectsKey: LEGACY_PROJECTS_KEY, thumbPrefix: LEGACY_THUMB_PREFIX }
	);
}

/**
 * Attempt the same payload against both backends and report what each did.
 *
 * The point of HP-105 is that IndexedDB accepts writes localStorage rejects, so the
 * comparison has to be made in one place against one payload to mean anything.
 */
export async function compareBackendCapacity(
	page: Page,
	payloadBytes: number
): Promise<{
	localStorage: 'accepted' | string;
	indexedDb: { stored: boolean; readBackLength?: number; error?: string };
	payloadLength: number;
}> {
	return page.evaluate(
		async ({ dbName, payloadBytes }) => {
			const payload = 'data:image/png;base64,' + 'A'.repeat(payloadBytes);

			let localStorageResult: string;
			try {
				localStorage.setItem('__capacity_probe__', payload);
				localStorage.removeItem('__capacity_probe__');
				localStorageResult = 'accepted';
			} catch (error) {
				localStorageResult = (error as Error).name;
			}

			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(dbName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});

			if (!db.objectStoreNames.contains('projects')) {
				db.close();
				return {
					localStorage: localStorageResult,
					indexedDb: { stored: false, error: 'projects store missing' },
					payloadLength: payload.length
				};
			}

			let indexedDb: { stored: boolean; readBackLength?: number; error?: string };
			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction('projects', 'readwrite');
					tx.objectStore('projects').put({
						id: '__capacity_probe__',
						name: 'Capacity Probe',
						updatedAt: new Date().toISOString(),
						data: { probe: payload }
					});
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
					tx.onabort = () => reject(tx.error);
				});

				const readBack = await new Promise<{ data: { probe: string } }>((resolve, reject) => {
					const request = db
						.transaction('projects')
						.objectStore('projects')
						.get('__capacity_probe__');
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});

				indexedDb = { stored: true, readBackLength: readBack.data.probe.length };

				// Leave no probe record behind for later assertions to trip over.
				await new Promise<void>((resolve) => {
					const tx = db.transaction('projects', 'readwrite');
					tx.objectStore('projects').delete('__capacity_probe__');
					tx.oncomplete = () => resolve();
					tx.onerror = () => resolve();
				});
			} catch (error) {
				indexedDb = { stored: false, error: (error as Error).name };
			}

			db.close();
			return { localStorage: localStorageResult, indexedDb, payloadLength: payload.length };
		},
		{ dbName: DB_NAME, payloadBytes }
	);
}
