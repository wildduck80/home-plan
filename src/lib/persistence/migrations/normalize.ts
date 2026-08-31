import type { Floor, Project } from '$lib/models/types';
import { createFloor, defaultFloorName, FLOOR_COLLECTION_KEYS } from '$lib/domain/factories';
import { uid } from '$lib/domain/ids';
import { CURRENT_PROJECT_SCHEMA_VERSION, ProjectLoadError } from '../schema';

export type RawRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is RawRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Revive a persisted date.
 *
 * JSON has no date type, so saved projects carry ISO strings. Anything unparseable is
 * replaced with `fallback` rather than allowed to become an `Invalid Date` that would
 * silently poison sorting and "last edited" displays downstream.
 */
export function reviveDate(value: unknown, fallback: Date): Date {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? fallback : value;
	}

	if (typeof value === 'string' || typeof value === 'number') {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}

	return fallback;
}

/**
 * Produce a complete `Floor` from raw persisted data.
 *
 * Unknown fields are preserved: a migration must never silently discard data written by
 * a feature this build does not know about (PRD 9.5). Known collections are guaranteed to
 * be arrays; a corrupt non-array value is replaced with an empty one so a single bad
 * field cannot make the whole house unopenable.
 */
export function normalizeFloor(raw: unknown, index: number): Floor {
	if (!isRecord(raw)) {
		throw new ProjectLoadError('missing-fields', `Floor at index ${index} is not an object.`);
	}

	const level = typeof raw.level === 'number' && Number.isFinite(raw.level) ? raw.level : index;
	const base = createFloor({
		id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
		name: typeof raw.name === 'string' && raw.name ? raw.name : defaultFloorName(level),
		level
	});

	const collections: Partial<Record<(typeof FLOOR_COLLECTION_KEYS)[number], unknown[]>> = {};
	for (const key of FLOOR_COLLECTION_KEYS) {
		collections[key] = Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [];
	}

	return {
		...raw,
		...base,
		...collections
	} as Floor;
}

/**
 * Normalize a whole project: complete floors, revived dates, and a resolvable
 * `activeFloorId`. Assumes migrations have already run, so it stamps the current version.
 */
export function normalizeProject(raw: RawRecord): Project {
	if (!Array.isArray(raw.floors)) {
		throw new ProjectLoadError('missing-fields', 'Project has no "floors" array.');
	}

	// Drop entries that are not objects — a corrupt slot should cost one floor, not the file.
	const floors = raw.floors.filter(isRecord).map(normalizeFloor);

	if (floors.length === 0) {
		throw new ProjectLoadError('no-floors', 'Project contains no usable floors.');
	}

	const createdAt = reviveDate(raw.createdAt, new Date());
	const activeFloorId = resolveActiveFloorId(raw.activeFloorId, floors);

	return {
		...raw,
		schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
		id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
		name: typeof raw.name === 'string' && raw.name ? raw.name : 'Untitled Project',
		floors,
		activeFloorId,
		createdAt,
		// A project saved without an update time has only ever been created.
		updatedAt: reviveDate(raw.updatedAt, createdAt)
	} as Project;
}

/**
 * Keep the stored active floor when it still exists, otherwise fall back to the lowest
 * storey. A dangling id would otherwise open the editor onto nothing.
 */
function resolveActiveFloorId(stored: unknown, floors: Floor[]): string {
	if (typeof stored === 'string' && floors.some((floor) => floor.id === stored)) {
		return stored;
	}

	const lowest = floors.reduce((a, b) => (b.level < a.level ? b : a), floors[0]);
	return lowest.id;
}
