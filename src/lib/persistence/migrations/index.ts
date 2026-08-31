import {
	CURRENT_PROJECT_SCHEMA_VERSION,
	OLDEST_SUPPORTED_SCHEMA_VERSION,
	ProjectLoadError,
	UNVERSIONED_SCHEMA_VERSION
} from '../schema';
import type { RawRecord } from './normalize';
import { migrateV1ToV2 } from './v1-to-v2';

export { normalizeFloor, normalizeProject, reviveDate, isRecord } from './normalize';
export type { RawRecord } from './normalize';

/**
 * Ordered migration steps, keyed by the version each step upgrades *from*.
 *
 * Adding v3 means adding `2: migrateV2ToV3` here and bumping
 * `CURRENT_PROJECT_SCHEMA_VERSION`. Every step must be pure and deterministic so that
 * loading the same file twice always produces the same project.
 */
const MIGRATIONS: Readonly<Record<number, (raw: RawRecord) => RawRecord>> = {
	1: migrateV1ToV2
};

/**
 * Determine which schema version a raw document was written with.
 *
 * A missing `schemaVersion` means the file predates versioning and is v1. A *present but
 * malformed* value is an error: guessing could route the document through the wrong
 * migrations and mangle it.
 */
export function detectSchemaVersion(raw: RawRecord): number {
	const version = raw.schemaVersion;

	if (version === undefined || version === null) {
		return UNVERSIONED_SCHEMA_VERSION;
	}

	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		throw new ProjectLoadError(
			'invalid-schema-version',
			`Project has an invalid schemaVersion (${JSON.stringify(version)}). Expected a positive integer.`
		);
	}

	return version;
}

/**
 * Apply every migration needed to bring `raw` from `fromVersion` up to current.
 *
 * Returns a new object; `raw` is never mutated.
 */
export function runMigrations(raw: RawRecord, fromVersion: number): RawRecord {
	if (fromVersion > CURRENT_PROJECT_SCHEMA_VERSION) {
		throw new ProjectLoadError(
			'unsupported-future-version',
			`This project was saved with schema version ${fromVersion}, but this version of the app ` +
				`only supports up to ${CURRENT_PROJECT_SCHEMA_VERSION}. Update the app to open it. ` +
				`Your file has not been modified.`
		);
	}

	if (fromVersion < OLDEST_SUPPORTED_SCHEMA_VERSION) {
		throw new ProjectLoadError(
			'invalid-schema-version',
			`Schema version ${fromVersion} is older than the oldest supported version ` +
				`(${OLDEST_SUPPORTED_SCHEMA_VERSION}).`
		);
	}

	let migrated = raw;
	for (let version = fromVersion; version < CURRENT_PROJECT_SCHEMA_VERSION; version++) {
		const step = MIGRATIONS[version];
		if (!step) {
			throw new ProjectLoadError(
				'invalid-schema-version',
				`No migration registered from schema version ${version} to ${version + 1}.`
			);
		}
		migrated = step(migrated);
	}

	return migrated;
}
