import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { installFakeLocalStorage, type FakeLocalStorage } from './fakeLocalStorage';
import { createProject } from '$lib/domain/factories';

/**
 * HP-105 — backend selection.
 *
 * IndexedDB is preferred for capacity, but editing must never hard-fail because a browser
 * has it disabled (private modes, hardened configurations) — hence the localStorage fallback.
 * `projectStore` is the facade the app uses so no caller knows which one won.
 */

let storage: FakeLocalStorage;
let datastore: typeof import('$lib/services/datastore');

async function loadDatastore() {
	vi.resetModules();
	datastore = await import('$lib/services/datastore');
}

function withIndexedDb(value: unknown): void {
	Object.defineProperty(globalThis, 'indexedDB', {
		value,
		configurable: true,
		writable: true
	});
}

beforeEach(async () => {
	withIndexedDb(new IDBFactory());
	storage = installFakeLocalStorage();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'info').mockImplementation(() => {});
	await loadDatastore();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('resolveDataStore', () => {
	it('chooses IndexedDB when it is available', async () => {
		const { idbStore } = await import('$lib/services/idbStore');

		expect(await datastore.resolveDataStore()).toBe(idbStore);
	});

	it('resolves once and caches the result', async () => {
		const first = await datastore.resolveDataStore();
		const second = await datastore.resolveDataStore();

		expect(first).toBe(second);
	});

	it('falls back to localStorage when IndexedDB is absent', async () => {
		withIndexedDb(undefined);
		await loadDatastore();

		expect(await datastore.resolveDataStore()).toBe(datastore.localStore);
	});

	it('falls back to localStorage when opening the database throws', async () => {
		withIndexedDb({
			open: () => {
				throw new Error('IndexedDB is disabled');
			}
		});
		await loadDatastore();

		expect(await datastore.resolveDataStore()).toBe(datastore.localStore);
	});
});

describe('projectStore facade', () => {
	it('saves and loads through whichever backend was chosen', async () => {
		const project = createProject('Facade House');

		await datastore.projectStore.save(project);
		const loaded = await datastore.projectStore.load(project.id);

		expect(loaded?.name).toBe('Facade House');
	});

	it('works end to end on the localStorage fallback', async () => {
		withIndexedDb(undefined);
		await loadDatastore();
		const project = createProject('Fallback House');

		await datastore.projectStore.save(project);

		expect((await datastore.projectStore.load(project.id))?.name).toBe('Fallback House');
		// Proof it really used localStorage.
		expect(storage.getItem('floorplan_projects')).toContain('Fallback House');
	});

	it('exposes thumbnails through the facade', async () => {
		await datastore.projectStore.saveThumbnail('p1', 'data:image/jpeg;base64,AAA');

		expect(await datastore.projectStore.getThumbnail('p1')).toBe('data:image/jpeg;base64,AAA');
	});

	it('supports list, duplicate and delete', async () => {
		const project = createProject('Original');
		await datastore.projectStore.save(project);

		const copy = await datastore.projectStore.duplicate(project.id);
		expect((await datastore.projectStore.list())).toHaveLength(2);

		await datastore.projectStore.delete(copy!.id);

		const remaining = await datastore.projectStore.list();
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).toBe(project.id);
	});

	it('picks up projects migrated from localStorage on first use', async () => {
		// Seed as the pre-HP-105 build would have, then resolve for the first time.
		const legacy = { ...createProject('From localStorage'), id: 'legacy-1' };
		storage.setItem('floorplan_projects', JSON.stringify({ 'legacy-1': JSON.stringify(legacy) }));
		await loadDatastore();

		const listed = await datastore.projectStore.list();

		expect(listed.map((e) => e.name)).toEqual(['From localStorage']);
	});
});
