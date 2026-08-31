import type { Floor, Project } from '$lib/models/types';
import { CURRENT_PROJECT_SCHEMA_VERSION } from '$lib/persistence/schema';
import { uid } from './ids';

/**
 * Every array-valued field on `Floor`.
 *
 * A single list of these keys is what lets the loader guarantee that a runtime `Floor`
 * always has valid collections, so domain code never needs `if (!floor.columns)` guards
 * (HP-103). Adding a collection to `Floor` means adding it here — the factory tests
 * assert the factory populates every key in this list.
 */
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
] as const satisfies readonly (keyof Floor)[];

export type FloorCollectionKey = (typeof FLOOR_COLLECTION_KEYS)[number];

export interface CreateFloorOptions {
	id?: string;
	name?: string;
	level?: number;
}

/** Default display name for a storey at the given level. */
export function defaultFloorName(level: number): string {
	return level === 0 ? 'Ground Floor' : `Floor ${level}`;
}

/**
 * The one place a `Floor` is constructed.
 *
 * Returns fresh array instances per call — sharing them across floors would let an edit
 * on one storey leak into another.
 */
export function createFloor(options: CreateFloorOptions = {}): Floor {
	const level = options.level ?? 0;

	return {
		id: options.id ?? uid(),
		name: options.name ?? defaultFloorName(level),
		level,
		walls: [],
		rooms: [],
		doors: [],
		windows: [],
		furniture: [],
		stairs: [],
		columns: [],
		guides: [],
		measurements: [],
		annotations: [],
		textAnnotations: [],
		groups: []
	};
}

/** The one place a `Project` is constructed. Always stamped with the current schema version. */
export function createProject(name = 'Untitled Project'): Project {
	const floor = createFloor();
	const now = new Date();

	return {
		schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
		id: uid(),
		name,
		floors: [floor],
		activeFloorId: floor.id,
		createdAt: now,
		updatedAt: now
	};
}
