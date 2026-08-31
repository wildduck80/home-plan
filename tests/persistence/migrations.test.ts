import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deserializeProject, parseProjectJson } from '$lib/persistence/projectIo';
import {
	CURRENT_PROJECT_SCHEMA_VERSION,
	ProjectLoadError
} from '$lib/persistence/schema';
import { detectSchemaVersion } from '$lib/persistence/migrations';
import { FLOOR_COLLECTION_KEYS } from '$lib/domain/factories';

const legacyV1Json = readFileSync(
	fileURLToPath(new URL('../fixtures/legacy/v1-minimal-project.json', import.meta.url)),
	'utf-8'
);

/** Smallest structurally valid project payload, used as a base for targeted mutations. */
function minimalRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'p1',
		name: 'Minimal',
		activeFloorId: 'f1',
		floors: [{ id: 'f1', name: 'Ground Floor', level: 0 }],
		...overrides
	};
}

describe('detectSchemaVersion', () => {
	it('treats a missing schemaVersion as v1 (pre-versioning baseline)', () => {
		expect(detectSchemaVersion(minimalRaw())).toBe(1);
	});

	it('reads an explicit schemaVersion', () => {
		expect(detectSchemaVersion(minimalRaw({ schemaVersion: 2 }))).toBe(2);
	});

	it('rejects a non-integer schemaVersion rather than guessing', () => {
		expect(() => detectSchemaVersion(minimalRaw({ schemaVersion: 'two' }))).toThrow(
			ProjectLoadError
		);
		expect(() => detectSchemaVersion(minimalRaw({ schemaVersion: 1.5 }))).toThrow(
			ProjectLoadError
		);
	});
});

describe('deserializeProject — v1 to v2 migration', () => {
	it('upgrades an unversioned project to the current schema version', () => {
		const project = deserializeProject(JSON.parse(legacyV1Json));

		expect(project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
	});

	it('backfills every collection missing from a legacy floor', () => {
		const project = deserializeProject(JSON.parse(legacyV1Json));
		const floor = project.floors[0];

		for (const key of FLOOR_COLLECTION_KEYS) {
			expect(Array.isArray(floor[key]), `${key} should be an array`).toBe(true);
		}
		// The fixture only supplied walls and doors; the rest must be backfilled empty.
		expect(floor.walls).toHaveLength(4);
		expect(floor.doors).toHaveLength(1);
		expect(floor.rooms).toHaveLength(0);
		expect(floor.windows).toHaveLength(0);
		expect(floor.furniture).toHaveLength(0);
		expect(floor.stairs).toHaveLength(0);
		expect(floor.columns).toHaveLength(0);
		expect(floor.guides).toHaveLength(0);
		expect(floor.measurements).toHaveLength(0);
		expect(floor.annotations).toHaveLength(0);
		expect(floor.textAnnotations).toHaveLength(0);
		expect(floor.groups).toHaveLength(0);
	});

	it('preserves legacy geometry values exactly', () => {
		const project = deserializeProject(JSON.parse(legacyV1Json));
		const [northWall] = project.floors[0].walls;

		expect(northWall.id).toBe('wall-n');
		expect(northWall.start).toEqual({ x: 0, y: 0 });
		expect(northWall.end).toEqual({ x: 400, y: 0 });
		expect(northWall.thickness).toBe(15);
		expect(northWall.height).toBe(280);
	});

	it('keeps door wallId references pointing at the original walls', () => {
		const project = deserializeProject(JSON.parse(legacyV1Json));
		const wallIds = project.floors[0].walls.map((w) => w.id);

		for (const door of project.floors[0].doors) {
			expect(wallIds).toContain(door.wallId);
		}
	});

	it('revives ISO date strings into Date instances centrally', () => {
		const project = deserializeProject(JSON.parse(legacyV1Json));

		expect(project.createdAt).toBeInstanceOf(Date);
		expect(project.updatedAt).toBeInstanceOf(Date);
		expect(project.createdAt.toISOString()).toBe('2026-01-15T09:30:00.000Z');
		expect(project.updatedAt.toISOString()).toBe('2026-02-02T18:45:12.000Z');
	});

	it('substitutes valid dates when they are absent or unparseable', () => {
		const noDates = deserializeProject(minimalRaw());
		const badDates = deserializeProject(minimalRaw({ createdAt: 'not-a-date' }));

		expect(noDates.createdAt).toBeInstanceOf(Date);
		expect(Number.isNaN(noDates.createdAt.getTime())).toBe(false);
		expect(Number.isNaN(badDates.createdAt.getTime())).toBe(false);
	});

	it('is deterministic — migrating the same input twice yields equal output', () => {
		const first = deserializeProject(JSON.parse(legacyV1Json));
		const second = deserializeProject(JSON.parse(legacyV1Json));

		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	});

	it('is idempotent — re-migrating an already-migrated project changes nothing', () => {
		const once = deserializeProject(JSON.parse(legacyV1Json));
		const twice = deserializeProject(JSON.parse(JSON.stringify(once)));

		expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
	});

	it('does not mutate the raw input object', () => {
		const raw = JSON.parse(legacyV1Json);
		const before = JSON.stringify(raw);

		deserializeProject(raw);

		expect(JSON.stringify(raw)).toBe(before);
	});
});

describe('deserializeProject — activeFloorId repair', () => {
	it('keeps a valid activeFloorId', () => {
		const project = deserializeProject(JSON.parse(legacyV1Json));

		expect(project.activeFloorId).toBe('floorgnd');
	});

	it('falls back to the lowest floor when activeFloorId dangles', () => {
		const project = deserializeProject(
			minimalRaw({
				activeFloorId: 'does-not-exist',
				floors: [
					{ id: 'upper', name: 'Floor 1', level: 1 },
					{ id: 'ground', name: 'Ground Floor', level: 0 }
				]
			})
		);

		expect(project.activeFloorId).toBe('ground');
	});
});

describe('deserializeProject — validation', () => {
	it.each([
		['null', null],
		['a string', 'not a project'],
		['a number', 42],
		['an array', []]
	])('rejects %s', (_label, input) => {
		expect(() => deserializeProject(input)).toThrow(ProjectLoadError);
	});

	it('rejects a project with no floors array', () => {
		expect(() => deserializeProject({ id: 'p', name: 'n', activeFloorId: 'f' })).toThrow(
			ProjectLoadError
		);
	});

	it('rejects a project whose floors array is empty', () => {
		expect(() => deserializeProject(minimalRaw({ floors: [] }))).toThrow(ProjectLoadError);
	});

	it('rejects a future schema version with an actionable message', () => {
		const future = CURRENT_PROJECT_SCHEMA_VERSION + 1;

		try {
			deserializeProject(minimalRaw({ schemaVersion: future }));
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(ProjectLoadError);
			const loadError = error as ProjectLoadError;
			expect(loadError.code).toBe('unsupported-future-version');
			// The message must tell the user what to do, not just that it failed.
			expect(loadError.message).toContain(String(future));
			expect(loadError.message).toContain(String(CURRENT_PROJECT_SCHEMA_VERSION));
		}
	});

	it('drops floor entries that are not objects rather than crashing', () => {
		const project = deserializeProject(
			minimalRaw({ floors: [null, { id: 'f1', name: 'Ground Floor', level: 0 }, 7] })
		);

		expect(project.floors).toHaveLength(1);
		expect(project.floors[0].id).toBe('f1');
	});

	it('replaces a non-array floor collection with an empty array', () => {
		const project = deserializeProject(
			minimalRaw({
				floors: [{ id: 'f1', name: 'Ground Floor', level: 0, walls: 'corrupt', rooms: 5 }]
			})
		);

		expect(project.floors[0].walls).toEqual([]);
		expect(project.floors[0].rooms).toEqual([]);
	});
});

describe('parseProjectJson', () => {
	it('parses a valid project document', () => {
		expect(parseProjectJson(legacyV1Json).name).toBe('Legacy Baseline House');
	});

	it('reports malformed JSON as a ProjectLoadError, not a raw SyntaxError', () => {
		try {
			parseProjectJson('{ this is not json');
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(ProjectLoadError);
			expect((error as ProjectLoadError).code).toBe('malformed-json');
		}
	});
});
