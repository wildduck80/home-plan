import { openDB, type IDBPDatabase } from 'idb';
import type { Project } from '$lib/models/types';
import type { DataStore, ProjectSummary } from './datastore';
import { deserializeProject } from '$lib/persistence/projectIo';
import { uid } from '$lib/domain/ids';

/**
 * IndexedDB project store (HP-105).
 *
 * localStorage caps the entire origin at roughly 5 MB, and background reference images are
 * persisted as inline data URLs, so a single traced architect plan could exhaust it — at which
 * point saving failed outright. IndexedDB is budgeted against free disk instead, which removes
 * the practical wall, and it stores structured values so projects need no JSON round-trip on
 * the way in.
 *
 * Implements the same `DataStore` interface as the localStorage store, so callers do not know
 * which backend they are talking to. `resolveDataStore` in `./datastore` picks.
 *
 * ## Layout
 *
 * ```text
 * projects        keyPath 'id'   — the project record, plus an `updatedAt` index for listing
 * thumbnails      keyPath 'id'   — { id, dataUrl }; derived data, safe to lose
 * meta            keyPath 'key'  — migration bookkeeping
 * customFurniture keyPath 'id'   — user furniture definitions, deliberately outside any project
 * ```
 *
 * Assets (background images, custom entourage PNGs) still live inline inside the project
 * record. Extracting them into their own blob store is the remaining part of HP-105 and needs
 * a schema version bump; IndexedDB's capacity makes it an optimisation rather than a fix.
 */

const DB_NAME = 'openplan3d';
// Bumped to 2 to add the custom-furniture store (HP-505). The upgrade below is additive and
// guarded, so an existing database gains the store without touching its projects.
const DB_VERSION = 2;

const PROJECTS_STORE = 'projects';
const THUMBNAILS_STORE = 'thumbnails';
const META_STORE = 'meta';
export const CUSTOM_FURNITURE_STORE = 'customFurniture';

const MIGRATION_FLAG_KEY = 'localStorageMigrated';

/** Keys used by the legacy localStorage store, read during migration. */
const LEGACY_PROJECTS_KEY = 'floorplan_projects';
const LEGACY_THUMB_PREFIX = 'floorplan_thumb_';

/** Open the app database. Exported so sibling stores share one connection and one upgrade path. */
export function openAppDatabase(): Promise<IDBPDatabase> {
	return getDb();
}

/** True when this environment can use IndexedDB at all (absent in SSR and some private modes). */
export function isIndexedDbAvailable(): boolean {
	try {
		return typeof indexedDB !== 'undefined' && indexedDB !== null;
	} catch {
		return false;
	}
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
					const projects = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
					// Listing sorts by recency, so index it rather than reading every record.
					projects.createIndex('updatedAt', 'updatedAt');
				}
				if (!db.objectStoreNames.contains(THUMBNAILS_STORE)) {
					db.createObjectStore(THUMBNAILS_STORE, { keyPath: 'id' });
				}
				if (!db.objectStoreNames.contains(META_STORE)) {
					db.createObjectStore(META_STORE, { keyPath: 'key' });
				}
				// Deliberately its own store, not part of a project: deleting a project must not
				// destroy furniture definitions used in another one (HP-505).
				if (!db.objectStoreNames.contains(CUSTOM_FURNITURE_STORE)) {
					db.createObjectStore(CUSTOM_FURNITURE_STORE, { keyPath: 'id' });
				}
			}
		});
	}

	return dbPromise;
}

/**
 * Stored project shape.
 *
 * Dates are persisted as ISO strings rather than `Date` objects: although IndexedDB can store
 * `Date` natively, keeping the record identical to the exported JSON means one load pipeline
 * serves both backends and file import.
 */
interface StoredProject {
	id: string;
	name: string;
	updatedAt: string;
	/** The full project, in the same shape as an exported JSON document. */
	data: Record<string, unknown>;
}

function toStored(project: Project): StoredProject {
	// Round-trip through JSON so Dates become ISO strings and no non-cloneable value (a class
	// instance, a function) can reach IndexedDB's structured clone and throw.
	const data = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;

	return {
		id: project.id,
		name: project.name,
		updatedAt: new Date(project.updatedAt).toISOString(),
		data
	};
}

export const idbStore: DataStore = {
	async save(project: Project): Promise<void> {
		const db = await getDb();
		await db.put(PROJECTS_STORE, toStored(project));
	},

	async load(id: string): Promise<Project | null> {
		const db = await getDb();
		const record = (await db.get(PROJECTS_STORE, id)) as StoredProject | undefined;
		if (!record) return null;

		// Same migration/normalization path as every other loader (HP-102).
		return deserializeProject(record.data);
	},

	async list(): Promise<ProjectSummary[]> {
		const db = await getDb();
		const records = (await db.getAll(PROJECTS_STORE)) as StoredProject[];

		return records.map((record) => ({
			id: record.id,
			name: record.name ?? 'Untitled Project',
			updatedAt: record.updatedAt
		}));
	},

	async delete(id: string): Promise<void> {
		const db = await getDb();
		const tx = db.transaction([PROJECTS_STORE, THUMBNAILS_STORE], 'readwrite');
		await Promise.all([
			tx.objectStore(PROJECTS_STORE).delete(id),
			tx.objectStore(THUMBNAILS_STORE).delete(id),
			tx.done
		]);
	},

	async duplicate(id: string): Promise<Project | null> {
		const original = await this.load(id);
		if (!original) return null;

		const now = new Date();
		const copy: Project = {
			...original,
			id: uid(),
			name: `${original.name} (Copy)`,
			createdAt: now,
			updatedAt: now
		};

		await this.save(copy);

		// Carry the thumbnail so the duplicate is not blank in the project list.
		const thumbnail = await this.getThumbnail(id);
		if (thumbnail) await this.saveThumbnail(copy.id, thumbnail);

		return copy;
	},

	async saveThumbnail(id: string, dataUrl: string): Promise<void> {
		// Derived data: a thumbnail that fails to cache must never break a save.
		try {
			const db = await getDb();
			await db.put(THUMBNAILS_STORE, { id, dataUrl });
		} catch (e: unknown) {
			console.warn('[IdbStore] Could not cache thumbnail', e);
		}
	},

	async getThumbnail(id: string): Promise<string | null> {
		try {
			const db = await getDb();
			const record = (await db.get(THUMBNAILS_STORE, id)) as
				| { id: string; dataUrl: string }
				| undefined;
			return record?.dataUrl ?? null;
		} catch (e: unknown) {
			console.warn('[IdbStore] Could not read thumbnail', e);
			return null;
		}
	}
};

export interface MigrationResult {
	migrated: number;
	failed: number;
	/** True when the migration had already run and was skipped. */
	alreadyDone: boolean;
}

function readLegacyProjectMap(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(LEGACY_PROJECTS_KEY) || '{}');
	} catch {
		return {};
	}
}

/**
 * Copy projects saved by the localStorage build into IndexedDB. Runs at most once.
 *
 * Deliberately **non-destructive**: nothing is removed from localStorage. The old copy is the
 * user's safety net if IndexedDB turns out to be unavailable or corrupt on their browser, and
 * the space it occupies is no longer the binding constraint. Existing IndexedDB records always
 * win, so re-running can never clobber newer work.
 */
export async function migrateLocalStorageProjects(): Promise<MigrationResult> {
	const result: MigrationResult = { migrated: 0, failed: 0, alreadyDone: false };

	if (!isIndexedDbAvailable() || typeof localStorage === 'undefined') {
		return result;
	}

	const db = await getDb();

	const flag = await db.get(META_STORE, MIGRATION_FLAG_KEY);
	if (flag) {
		result.alreadyDone = true;
		return result;
	}

	const legacy = readLegacyProjectMap();

	for (const [key, raw] of Object.entries(legacy)) {
		try {
			const parsed = JSON.parse(raw);
			const project = deserializeProject(parsed);

			// Never overwrite something already in IndexedDB — it is newer by definition.
			if (await db.get(PROJECTS_STORE, project.id)) continue;

			await db.put(PROJECTS_STORE, toStored(project));

			const thumbnail = localStorage.getItem(`${LEGACY_THUMB_PREFIX}${project.id}`);
			if (thumbnail) {
				await db.put(THUMBNAILS_STORE, { id: project.id, dataUrl: thumbnail });
			}

			result.migrated++;
		} catch (e: unknown) {
			// One unreadable legacy entry must not abort the whole migration.
			console.warn(`[IdbStore] Could not migrate legacy project "${key}"`, e);
			result.failed++;
		}
	}

	await db.put(META_STORE, { key: MIGRATION_FLAG_KEY, value: true, at: new Date().toISOString() });

	if (result.migrated > 0 || result.failed > 0) {
		console.info(
			`[IdbStore] Migrated ${result.migrated} project(s) from localStorage` +
				(result.failed > 0 ? `, ${result.failed} could not be read` : '')
		);
	}

	return result;
}
