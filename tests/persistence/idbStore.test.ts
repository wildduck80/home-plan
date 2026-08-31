import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { installFakeLocalStorage, type FakeLocalStorage } from './fakeLocalStorage';
import { createProject } from '$lib/domain/factories';
import type { Project } from '$lib/models/types';

/**
 * HP-105 — IndexedDB is the primary project store.
 *
 * localStorage capped the whole origin at a few megabytes, and background images are inline
 * data URLs, so a single traced plan could exhaust it. IndexedDB's budget is a share of free
 * disk instead, which removes the practical wall.
 */

let storage: FakeLocalStorage;
let idbStore: typeof import('$lib/services/idbStore').idbStore;
let migrateLocalStorageProjects: typeof import('$lib/services/idbStore').migrateLocalStorageProjects;
let isIndexedDbAvailable: typeof import('$lib/services/idbStore').isIndexedDbAvailable;

async function freshModules() {
	vi.resetModules();
	const mod = await import('$lib/services/idbStore');
	idbStore = mod.idbStore;
	migrateLocalStorageProjects = mod.migrateLocalStorageProjects;
	isIndexedDbAvailable = mod.isIndexedDbAvailable;
}

beforeEach(async () => {
	// A brand-new factory per test, so no database state leaks between them.
	Object.defineProperty(globalThis, 'indexedDB', {
		value: new IDBFactory(),
		configurable: true,
		writable: true
	});
	storage = installFakeLocalStorage();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	await freshModules();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('idbStore — DataStore contract', () => {
	it('saves and loads a project', async () => {
		const project = createProject('House');

		await idbStore.save(project);
		const loaded = await idbStore.load(project.id);

		expect(loaded?.id).toBe(project.id);
		expect(loaded?.name).toBe('House');
	});

	it('returns null for an unknown id', async () => {
		expect(await idbStore.load('nope')).toBeNull();
	});

	it('revives dates through the shared load pipeline', async () => {
		const project = createProject('House');
		await idbStore.save(project);

		const loaded = await idbStore.load(project.id);

		expect(loaded?.createdAt).toBeInstanceOf(Date);
		expect(loaded?.updatedAt).toBeInstanceOf(Date);
	});

	it('overwrites an existing project rather than duplicating it', async () => {
		const project = createProject('First');
		await idbStore.save(project);
		await idbStore.save({ ...project, name: 'Renamed' });

		const listed = await idbStore.list();

		expect(listed).toHaveLength(1);
		expect(listed[0].name).toBe('Renamed');
	});

	it('lists project summaries without loading whole projects', async () => {
		await idbStore.save(createProject('One'));
		await idbStore.save(createProject('Two'));

		const names = (await idbStore.list()).map((entry) => entry.name).sort();

		expect(names).toEqual(['One', 'Two']);
	});

	it('deletes a project and its thumbnail', async () => {
		const project = createProject('Doomed');
		await idbStore.save(project);
		await idbStore.saveThumbnail(project.id, 'data:image/jpeg;base64,AAA');

		await idbStore.delete(project.id);

		expect(await idbStore.load(project.id)).toBeNull();
		expect(await idbStore.getThumbnail(project.id)).toBeNull();
	});

	it('duplicates a project under a new id, keeping the original', async () => {
		const project = createProject('Original');
		await idbStore.save(project);
		await idbStore.saveThumbnail(project.id, 'data:image/jpeg;base64,AAA');

		const copy = await idbStore.duplicate(project.id);

		expect(copy).not.toBeNull();
		expect(copy!.id).not.toBe(project.id);
		expect(copy!.name).toBe('Original (Copy)');
		expect(await idbStore.load(project.id)).not.toBeNull();
		// The thumbnail should follow the copy so the project list is not blank.
		expect(await idbStore.getThumbnail(copy!.id)).toBe('data:image/jpeg;base64,AAA');
	});

	it('returns null when duplicating an unknown project', async () => {
		expect(await idbStore.duplicate('nope')).toBeNull();
	});

	it('stores and reads thumbnails', async () => {
		await idbStore.saveThumbnail('p1', 'data:image/jpeg;base64,AAA');

		expect(await idbStore.getThumbnail('p1')).toBe('data:image/jpeg;base64,AAA');
	});

	it('returns null for a missing thumbnail', async () => {
		expect(await idbStore.getThumbnail('never-saved')).toBeNull();
	});
});

describe('idbStore — capacity', () => {
	it('stores a project far larger than the localStorage budget', async () => {
		// ~6 MB of inline image data: comfortably past a 5 MB localStorage origin cap.
		const bigDataUrl = 'data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024);
		const base = createProject('Traced Plan');
		const floor = base.floors[0];
		const project: Project = {
			...base,
			floors: [
				{
					...floor,
					backgroundImage: {
						dataUrl: bigDataUrl,
						position: { x: 0, y: 0 },
						scale: 1,
						opacity: 0.5,
						rotation: 0,
						locked: true
					}
				}
			]
		};

		await idbStore.save(project);
		const loaded = await idbStore.load(project.id);

		expect(loaded?.floors[0].backgroundImage?.dataUrl).toHaveLength(bigDataUrl.length);
	});

	it('keeps other projects intact when one is very large', async () => {
		const small = createProject('Small');
		await idbStore.save(small);
		await idbStore.save({
			...createProject('Large'),
			description: 'x'.repeat(2 * 1024 * 1024)
		});

		expect(await idbStore.load(small.id)).not.toBeNull();
		expect(await idbStore.list()).toHaveLength(2);
	});
});

describe('migrateLocalStorageProjects', () => {
	/** Seed localStorage the way the pre-HP-105 build would have. */
	async function seedLegacyLocalStorage(projects: Project[]): Promise<void> {
		const map: Record<string, string> = {};
		for (const project of projects) {
			map[project.id] = JSON.stringify(project);
			storage.setItem(`floorplan_thumb_${project.id}`, `thumb-for-${project.id}`);
		}
		storage.setItem('floorplan_projects', JSON.stringify(map));
	}

	it('copies existing localStorage projects into IndexedDB', async () => {
		const a = { ...createProject('Legacy A'), id: 'legacy-a' };
		const b = { ...createProject('Legacy B'), id: 'legacy-b' };
		await seedLegacyLocalStorage([a, b]);

		const result = await migrateLocalStorageProjects();

		expect(result.migrated).toBe(2);
		const names = (await idbStore.list()).map((e) => e.name).sort();
		expect(names).toEqual(['Legacy A', 'Legacy B']);
	});

	it('carries thumbnails across', async () => {
		const a = { ...createProject('Legacy A'), id: 'legacy-a' };
		await seedLegacyLocalStorage([a]);

		await migrateLocalStorageProjects();

		expect(await idbStore.getThumbnail('legacy-a')).toBe('thumb-for-legacy-a');
	});

	it('does not delete anything from localStorage', async () => {
		const a = { ...createProject('Legacy A'), id: 'legacy-a' };
		await seedLegacyLocalStorage([a]);

		await migrateLocalStorageProjects();

		// The old copy is the user's safety net if IndexedDB later misbehaves.
		expect(storage.getItem('floorplan_projects')).not.toBeNull();
		expect(storage.getItem('floorplan_thumb_legacy-a')).toBe('thumb-for-legacy-a');
	});

	it('runs only once', async () => {
		await seedLegacyLocalStorage([{ ...createProject('Legacy A'), id: 'legacy-a' }]);

		const first = await migrateLocalStorageProjects();
		const second = await migrateLocalStorageProjects();

		expect(first.migrated).toBe(1);
		expect(second.migrated).toBe(0);
		expect(second.alreadyDone).toBe(true);
	});

	it('never overwrites a project already in IndexedDB', async () => {
		const existing = { ...createProject('IDB version'), id: 'shared-id' };
		await idbStore.save(existing);
		await seedLegacyLocalStorage([{ ...createProject('localStorage version'), id: 'shared-id' }]);

		await migrateLocalStorageProjects();

		expect((await idbStore.load('shared-id'))?.name).toBe('IDB version');
	});

	it('skips unreadable legacy entries and migrates the rest', async () => {
		const good = { ...createProject('Good'), id: 'good' };
		await seedLegacyLocalStorage([good]);
		const map = JSON.parse(storage.getItem('floorplan_projects')!);
		map['broken'] = '{ not json';
		storage.setItem('floorplan_projects', JSON.stringify(map));

		const result = await migrateLocalStorageProjects();

		expect(result.migrated).toBe(1);
		expect(result.failed).toBe(1);
		expect((await idbStore.list()).map((e) => e.id)).toEqual(['good']);
	});

	it('is a no-op when there is nothing to migrate', async () => {
		const result = await migrateLocalStorageProjects();

		expect(result.migrated).toBe(0);
		expect(result.failed).toBe(0);
	});
});

describe('isIndexedDbAvailable', () => {
	it('is true when indexedDB is present', () => {
		expect(isIndexedDbAvailable()).toBe(true);
	});

	it('is false when indexedDB is absent', async () => {
		Object.defineProperty(globalThis, 'indexedDB', {
			value: undefined,
			configurable: true,
			writable: true
		});
		await freshModules();

		expect(isIndexedDbAvailable()).toBe(false);
	});
});
