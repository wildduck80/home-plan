import { describe, it, expect } from 'vitest';
import { goldenFixtures } from '../fixtures/golden';
import { parseProjectJson, serializeProject } from '$lib/persistence/projectIo';
import { FLOOR_COLLECTION_KEYS } from '$lib/domain/factories';
import { CURRENT_PROJECT_SCHEMA_VERSION } from '$lib/persistence/schema';

/**
 * HP-004 + HP-104 — the golden fixtures double as persistence baselines. Every fixture
 * must survive a save/load cycle byte-for-byte, so a future schema change that quietly
 * alters real house geometry fails here.
 */
describe.each(goldenFixtures.map((f) => [f.name, f] as const))(
	'golden fixture round-trip: %s',
	(_name, fixture) => {
		it('is deterministic — building it twice yields identical JSON', () => {
			expect(serializeProject(fixture.project)).toBe(serializeProject(fixture.project));
		});

		it('survives save/load byte-for-byte', () => {
			const saved = serializeProject(fixture.project);
			const reloaded = serializeProject(parseProjectJson(saved));

			expect(reloaded).toBe(saved);
		});

		it('carries the current schema version', () => {
			expect(fixture.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
		});

		it('has complete collections on every floor', () => {
			for (const floor of fixture.project.floors) {
				for (const key of FLOOR_COLLECTION_KEYS) {
					expect(Array.isArray(floor[key]), `${floor.id}.${key}`).toBe(true);
				}
			}
		});

		it('has an activeFloorId that resolves to a real floor', () => {
			const ids = fixture.project.floors.map((f) => f.id);

			expect(ids).toContain(fixture.project.activeFloorId);
		});

		it('references only walls that exist, from every opening', () => {
			for (const floor of fixture.project.floors) {
				const wallIds = new Set(floor.walls.map((w) => w.id));

				for (const opening of [...floor.doors, ...floor.windows]) {
					expect(wallIds, `${opening.id} -> ${opening.wallId}`).toContain(opening.wallId);
				}
			}
		});

		it('uses unique element ids within each floor', () => {
			for (const floor of fixture.project.floors) {
				const ids = [
					...floor.walls,
					...floor.doors,
					...floor.windows,
					...floor.furniture,
					...floor.stairs,
					...floor.columns
				].map((element) => element.id);

				expect(new Set(ids).size, `duplicate ids on ${floor.id}`).toBe(ids.length);
			}
		});
	}
);

describe('golden fixture suite', () => {
	it('has a unique name per fixture', () => {
		const names = goldenFixtures.map((f) => f.name);

		expect(new Set(names).size).toBe(names.length);
	});

	it('declares expectations consistent with its own room count', () => {
		for (const fixture of goldenFixtures) {
			expect(fixture.expected.roomAreas, fixture.name).toHaveLength(
				fixture.expected.roomCount
			);
			// Areas must be pre-sorted ascending so comparisons are order-independent.
			expect(fixture.expected.roomAreas, fixture.name).toEqual(
				[...fixture.expected.roomAreas].sort((a, b) => a - b)
			);
		}
	});

	it('covers every topology the implementation plan lists for HP-004', () => {
		const required = [
			'simple-room',
			'adjacent-two-room',
			'l-shaped-house',
			'hallway-apartment',
			'ten-room-grid',
			'two-floor-house',
			'stairs-columns',
			'openings-heavy',
			'furniture-heavy'
		];

		for (const name of required) {
			expect(goldenFixtures.map((f) => f.name)).toContain(name);
		}
	});
});
