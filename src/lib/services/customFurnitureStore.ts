import { writable, get } from 'svelte/store';
import {
	makeCustomFurnitureDef,
	toFurnitureDef,
	type CustomFurnitureDef,
	type CustomFurnitureInput
} from '$lib/domain/customFurniture';
import { registerCustomFurniture } from '$lib/utils/furnitureCatalog';

/**
 * Persistence for user furniture definitions (HP-505).
 *
 * Stored in their **own IndexedDB object store**, not inside a project. HP-505 requires that
 * deleting one project cannot destroy definitions used in another, and putting them in a project
 * would also mean re-creating the same wardrobe for every plan.
 *
 * localStorage is the fallback, matching the project store: editing must not hard-fail because a
 * browser has IndexedDB disabled.
 */

const LOCAL_STORAGE_KEY = 'o3d_custom_furniture';

/** Every user definition. Subscribe for the catalog UI. */
export const customFurniture = writable<CustomFurnitureDef[]>([]);

/** Push the current definitions into the catalog registry so lookups resolve them. */
function syncCatalog(defs: CustomFurnitureDef[]): void {
	registerCustomFurniture(defs.map(toFurnitureDef));
}

function readFromLocalStorage(): CustomFurnitureDef[] {
	try {
		const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
		return raw ? (JSON.parse(raw) as CustomFurnitureDef[]) : [];
	} catch {
		return [];
	}
}

function writeToLocalStorage(defs: CustomFurnitureDef[]): void {
	try {
		localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(defs));
	} catch (e: unknown) {
		console.warn('[CustomFurniture] Could not persist to localStorage', e);
	}
}

async function withIdb<T>(
	work: (db: Awaited<ReturnType<typeof import('./idbStore')['openAppDatabase']>>, storeName: string) => Promise<T>
): Promise<T | null> {
	try {
		const { openAppDatabase, isIndexedDbAvailable, CUSTOM_FURNITURE_STORE } = await import('./idbStore');
		if (!isIndexedDbAvailable()) return null;
		const db = await openAppDatabase();
		return await work(db, CUSTOM_FURNITURE_STORE);
	} catch (e: unknown) {
		// Never fatal: the catalog simply falls back to localStorage.
		console.warn('[CustomFurniture] IndexedDB unavailable; using localStorage', e);
		return null;
	}
}

let loaded = false;

/**
 * Load definitions and register them with the catalog. Safe to call repeatedly.
 *
 * Must complete before a project referencing custom furniture renders, otherwise those items
 * resolve to nothing. In practice placements also carry their own dimensions (see
 * `snapshotDimensions`), so a slow load degrades to a correctly-sized box rather than a gap.
 */
export async function loadCustomFurniture(): Promise<CustomFurnitureDef[]> {
	if (loaded) return get(customFurniture);

	const fromIdb = await withIdb(async (db, storeName) => {
		return (await db.getAll(storeName)) as CustomFurnitureDef[];
	});

	const defs = fromIdb ?? readFromLocalStorage();
	// Newest first: the thing you just made is the thing you want to place.
	defs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

	loaded = true;
	customFurniture.set(defs);
	syncCatalog(defs);

	return defs;
}

/** Create and persist a definition, returning it. */
export async function addCustomFurniture(
	input: CustomFurnitureInput
): Promise<CustomFurnitureDef> {
	const def = makeCustomFurnitureDef(input);

	const next = [def, ...get(customFurniture)];
	customFurniture.set(next);
	syncCatalog(next);

	const stored = await withIdb(async (db, storeName) => {
		await db.put(storeName, def);
		return true;
	});
	// Mirror to localStorage either way, so a definition survives IndexedDB being cleared.
	writeToLocalStorage(next);
	if (!stored) console.info('[CustomFurniture] Saved to localStorage only.');

	return def;
}

/**
 * Delete a definition.
 *
 * Placements referencing it keep working, because placing custom furniture snapshots the
 * dimensions onto the item — so removing a definition tidies the palette without silently
 * resizing furniture already in a plan.
 */
export async function deleteCustomFurniture(id: string): Promise<void> {
	const next = get(customFurniture).filter((def) => def.id !== id);
	customFurniture.set(next);
	syncCatalog(next);

	await withIdb(async (db, storeName) => {
		await db.delete(storeName, id);
		return true;
	});
	writeToLocalStorage(next);
}

/**
 * Dimensions to stamp onto a placement.
 *
 * The plan's HP-505 note asks for "a stable definition ID **or snapshot** strategy". Snapshotting
 * is the safer half: `FurnitureItem` already carries per-item width/depth/height overrides, so
 * writing them at placement time means a project opened on another device — or after the
 * definition was deleted — still shows furniture at the right size rather than a fallback box.
 */
export function snapshotDimensions(def: CustomFurnitureDef): {
	width: number;
	depth: number;
	height: number;
	color: string;
} {
	return { width: def.width, depth: def.depth, height: def.height, color: def.color };
}
