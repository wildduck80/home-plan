import type { Project } from '$lib/models/types';
import { ProjectLoadError } from './schema';
import { detectSchemaVersion, isRecord, normalizeProject, runMigrations } from './migrations';

/**
 * Load a project from an already-parsed JSON value.
 *
 * The single entry point every caller should use — localStorage, IndexedDB, file import
 * and RoomPlan import all funnel through here so migration and normalization can never be
 * skipped by one code path:
 *
 * ```text
 * validate shape -> detect version -> migrate sequentially -> normalize -> Project
 * ```
 *
 * @throws {ProjectLoadError} when the document cannot be loaded safely.
 */
export function deserializeProject(raw: unknown): Project {
	if (!isRecord(raw)) {
		throw new ProjectLoadError(
			'not-an-object',
			'This file does not contain a project. Expected a JSON object.'
		);
	}

	const version = detectSchemaVersion(raw);
	const migrated = runMigrations(raw, version);

	return normalizeProject(migrated);
}

/**
 * Load a project from raw JSON text, reporting parse failures as `ProjectLoadError` so
 * callers only ever have one error type to handle.
 *
 * @throws {ProjectLoadError}
 */
export function parseProjectJson(text: string): Project {
	let parsed: unknown;

	try {
		parsed = JSON.parse(text);
	} catch (error: unknown) {
		const detail = error instanceof Error ? error.message : 'Unknown parse error';
		throw new ProjectLoadError('malformed-json', `Could not read the project file: ${detail}`);
	}

	return deserializeProject(parsed);
}

/**
 * Serialize a project for export or storage.
 *
 * Indented so exported backups stay human-readable and diffable — these files are the
 * user's recovery path, and are small relative to the assets they reference.
 */
export function serializeProject(project: Project): string {
	return JSON.stringify(project, null, 2);
}

/** Compact serialization for hot paths (autosave, undo snapshots) where size matters. */
export function serializeProjectCompact(project: Project): string {
	return JSON.stringify(project);
}
