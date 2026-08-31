import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { installFakeLocalStorage, type FakeLocalStorage } from './fakeLocalStorage';
import { createProject } from '$lib/domain/factories';
import type { Project } from '$lib/models/types';
import type { StorageQuotaError as StorageQuotaErrorType } from '$lib/services/storageErrors';

/**
 * HP-105 / HP-106 — quota handling must never destroy user data.
 *
 * The baseline `save()` deleted every *other* project to make room for the current one and
 * told the user only afterwards. These tests lock in the replacement contract: prune only
 * regenerable data (thumbnails), never projects, and fail loudly if that is not enough.
 */

let storage: FakeLocalStorage;
let localStore: typeof import('$lib/services/datastore').localStore;
/**
 * Resolved from the same module graph as `localStore`.
 *
 * `vi.resetModules()` gives each dynamic import a fresh graph, so a statically imported
 * `StorageQuotaError` would be a *different class object* than the one the store throws and
 * every `instanceof` check would fail.
 */
let StorageQuotaError: typeof import('$lib/services/storageErrors').StorageQuotaError;

/** A project padded to roughly `targetBytes` so quota pressure can be provoked. */
function paddedProject(id: string, name: string, targetBytes: number): Project {
	const base = { ...createProject(name), id };
	const floor = base.floors[0];

	return {
		...base,
		floors: [{ ...floor, textAnnotations: [
			{ id: 'pad', x: 0, y: 0, text: 'x'.repeat(targetBytes), fontSize: 12, color: '#000', rotation: 0 }
		] }]
	};
}

beforeEach(async () => {
	storage = installFakeLocalStorage();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	// Import after the global is installed, and fresh each time so no state leaks.
	vi.resetModules();
	({ localStore } = await import('$lib/services/datastore'));
	({ StorageQuotaError } = await import('$lib/services/storageErrors'));
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('localStore — normal operation', () => {
	it('saves and loads a project', async () => {
		const project = createProject('House');
		await localStore.save(project);

		const loaded = await localStore.load(project.id);

		expect(loaded?.id).toBe(project.id);
		expect(loaded?.name).toBe('House');
	});

	it('returns null for an unknown id', async () => {
		expect(await localStore.load('nope')).toBeNull();
	});

	it('lists saved projects', async () => {
		await localStore.save(createProject('One'));
		await localStore.save(createProject('Two'));

		const names = (await localStore.list()).map((entry) => entry.name).sort();

		expect(names).toEqual(['One', 'Two']);
	});

	it('skips an unreadable entry when listing instead of failing entirely', async () => {
		await localStore.save(createProject('Good'));
		// Corrupt the stored map by hand, as a truncated write would.
		const raw = JSON.parse(storage.getItem('floorplan_projects')!);
		raw['broken'] = '{ not json';
		storage.setItem('floorplan_projects', JSON.stringify(raw));

		const listed = await localStore.list();

		expect(listed.map((e) => e.name)).toEqual(['Good']);
	});

	it('deletes a project and its thumbnail', async () => {
		const project = createProject('Doomed');
		await localStore.save(project);
		await localStore.saveThumbnail(project.id, 'data:image/jpeg;base64,AAA');

		await localStore.delete(project.id);

		expect(await localStore.load(project.id)).toBeNull();
		expect(await localStore.getThumbnail(project.id)).toBeNull();
	});

	it('duplicates a project under a new id', async () => {
		const project = createProject('Original');
		await localStore.save(project);

		const copy = await localStore.duplicate(project.id);

		expect(copy).not.toBeNull();
		expect(copy!.id).not.toBe(project.id);
		expect(copy!.name).toBe('Original (Copy)');
		// Both must still exist.
		expect(await localStore.load(project.id)).not.toBeNull();
		expect(await localStore.load(copy!.id)).not.toBeNull();
	});
});

describe('localStore — quota exhaustion must not destroy data', () => {
	it('never deletes other projects when the quota is exceeded', async () => {
		const keeper = paddedProject('keeper', 'Keeper', 2000);
		const newcomer = paddedProject('newcomer', 'Newcomer', 2000);

		await localStore.save(keeper);
		// Leave no room for the second project.
		storage.setByteLimit(storage.usedBytes() + 100);

		await expect(localStore.save(newcomer)).rejects.toThrow(StorageQuotaError);

		// The pre-existing project must be intact and loadable.
		const survivor = await localStore.load('keeper');
        expect(survivor).not.toBeNull();
		expect(survivor!.name).toBe('Keeper');
	});

	it('throws StorageQuotaError carrying the project id', async () => {
		const project = paddedProject('big', 'Big House', 5000);
		storage.setByteLimit(500);

		try {
			await localStore.save(project);
			expect.unreachable('save should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(StorageQuotaError);
			expect((error as StorageQuotaErrorType).projectId).toBe('big');
			// Message must point at the recovery action, not just state the failure.
			expect((error as StorageQuotaErrorType).message).toMatch(/export/i);
		}
	});

	it('prunes thumbnails — which are regenerable — to make room, and succeeds', async () => {
		const project = paddedProject('p1', 'House', 1500);
		await localStore.save(project);

		// Fill the remaining budget with thumbnails, then demand a larger project write.
		await localStore.saveThumbnail('other-a', 'x'.repeat(3000));
		await localStore.saveThumbnail('other-b', 'x'.repeat(3000));
		const grown = paddedProject('p1', 'House', 4000);
		storage.setByteLimit(storage.usedBytes() + 200);

		await localStore.save(grown);

		// Project saved, thumbnails sacrificed.
		expect((await localStore.load('p1'))!.name).toBe('House');
		expect(await localStore.getThumbnail('other-a')).toBeNull();
		expect(await localStore.getThumbnail('other-b')).toBeNull();
	});

	it('does not corrupt the existing project map when a save fails', async () => {
		const keeper = paddedProject('keeper', 'Keeper', 2000);
		await localStore.save(keeper);
		const before = storage.getItem('floorplan_projects');

		storage.setByteLimit(storage.usedBytes() + 50);
		await localStore.save(paddedProject('newcomer', 'Newcomer', 5000)).catch(() => {});

		expect(storage.getItem('floorplan_projects')).toBe(before);
	});

	it('rethrows non-quota storage errors unchanged', async () => {
		const boom = new Error('disk on fire');
		vi.spyOn(storage, 'setItem').mockImplementation(() => {
			throw boom;
		});

		await expect(localStore.save(createProject('X'))).rejects.toThrow('disk on fire');
	});
});

describe('localStore — thumbnails', () => {
	it('stores and reads a thumbnail', async () => {
		await localStore.saveThumbnail('p1', 'data:image/jpeg;base64,AAA');

		expect(await localStore.getThumbnail('p1')).toBe('data:image/jpeg;base64,AAA');
	});

	it('silently tolerates a thumbnail that will not fit', async () => {
		storage.setByteLimit(10);

		// Thumbnails are derived data: failing to cache one must never surface as an error.
		await expect(localStore.saveThumbnail('p1', 'x'.repeat(1000))).resolves.toBeUndefined();
		expect(await localStore.getThumbnail('p1')).toBeNull();
	});
});
