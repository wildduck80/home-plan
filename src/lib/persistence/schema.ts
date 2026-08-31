/**
 * Project schema versioning (HP-101).
 *
 * Saved house projects are user data we cannot afford to corrupt, so every persisted or
 * exported document carries a version and passes through the migration pipeline on load.
 *
 * ## Version history
 *
 * - **v1** — the openPlan3D 0.9.0 baseline. No `schemaVersion` field; floors could omit
 *   collections entirely, and each loader patched the gaps itself.
 * - **v2** — adds `schemaVersion`, and guarantees that a loaded `Floor` always has every
 *   collection present and that dates are revived centrally.
 */
export const CURRENT_PROJECT_SCHEMA_VERSION = 2;

/** The oldest version the migration pipeline can still read. */
export const OLDEST_SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Version assumed when a document has no `schemaVersion` field, i.e. it predates
 * versioning. Absence is meaningful — it is not an error.
 */
export const UNVERSIONED_SCHEMA_VERSION = 1;

export type ProjectLoadErrorCode =
	/** Input was not a JSON object (null, array, string, number). */
	| 'not-an-object'
	/** Input text was not parseable JSON at all. */
	| 'malformed-json'
	/** `schemaVersion` was present but not a positive integer. */
	| 'invalid-schema-version'
	/** Written by a newer build of the app than this one. */
	| 'unsupported-future-version'
	/** Required top-level fields were missing or unusable. */
	| 'missing-fields'
	/** No usable floor survived normalization. */
	| 'no-floors';

/**
 * Raised when a project document cannot be loaded safely.
 *
 * Carries a machine-readable `code` so UI can react (e.g. offer "update the app" for a
 * future version) while `message` stays human-readable.
 */
export class ProjectLoadError extends Error {
	readonly code: ProjectLoadErrorCode;

	constructor(code: ProjectLoadErrorCode, message: string) {
		super(message);
		this.name = 'ProjectLoadError';
		this.code = code;
	}
}
