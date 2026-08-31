import type { RawRecord } from './normalize';

/**
 * v1 → v2.
 *
 * v1 is the openPlan3D 0.9.0 baseline: no `schemaVersion`, and floors free to omit any
 * collection. v2 adds the version field and the guarantee that loaded floors are complete.
 *
 * The completeness guarantee is delivered by `normalizeProject`, which runs after every
 * migration for every version, so this step only has to stamp the version. It stays as an
 * explicit, separately testable function because the pipeline applies migrations in
 * sequence and v2 → v3 will need a real body.
 *
 * Must remain pure — no mutation of `raw`.
 */
export function migrateV1ToV2(raw: RawRecord): RawRecord {
	return { ...raw, schemaVersion: 2 };
}
