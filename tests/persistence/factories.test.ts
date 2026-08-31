import { describe, it, expect } from 'vitest';
import { createFloor, createProject, FLOOR_COLLECTION_KEYS } from '$lib/domain/factories';
import { CURRENT_PROJECT_SCHEMA_VERSION } from '$lib/persistence/schema';

/**
 * HP-103 — every runtime `Floor` must always carry valid collections, so no
 * downstream code needs defensive `if (!floor.columns)` checks.
 * HP-101 — newly created projects must carry a schema version.
 */
describe('createFloor', () => {
	it('populates every collection field with an empty array', () => {
		const floor = createFloor();

		for (const key of FLOOR_COLLECTION_KEYS) {
			expect(Array.isArray(floor[key]), `${key} should be an array`).toBe(true);
			expect(floor[key]).toHaveLength(0);
		}
	});

	it('names level 0 "Ground Floor" and higher levels by number', () => {
		expect(createFloor().name).toBe('Ground Floor');
		expect(createFloor({ level: 0 }).name).toBe('Ground Floor');
		expect(createFloor({ level: 2 }).name).toBe('Floor 2');
	});

	it('honours explicit id, name and level overrides', () => {
		const floor = createFloor({ id: 'fixed-id', name: 'Attic', level: 3 });

		expect(floor.id).toBe('fixed-id');
		expect(floor.name).toBe('Attic');
		expect(floor.level).toBe(3);
	});

	it('generates a distinct id per call', () => {
		expect(createFloor().id).not.toBe(createFloor().id);
	});

	it('does not share collection array instances between floors', () => {
		const first = createFloor();
		const second = createFloor();

		// Aliased arrays would let an edit on one floor leak into another.
		for (const key of FLOOR_COLLECTION_KEYS) {
			expect(first[key]).not.toBe(second[key]);
		}
	});
});

describe('createProject', () => {
	it('stamps the current schema version', () => {
		expect(createProject().schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
	});

	it('starts with a single ground floor that is also the active floor', () => {
		const project = createProject();

		expect(project.floors).toHaveLength(1);
		expect(project.floors[0].level).toBe(0);
		expect(project.activeFloorId).toBe(project.floors[0].id);
	});

	it('defaults the name and accepts an override', () => {
		expect(createProject().name).toBe('Untitled Project');
		expect(createProject('Our House').name).toBe('Our House');
	});

	it('sets createdAt and updatedAt to Date instances', () => {
		const project = createProject();

		expect(project.createdAt).toBeInstanceOf(Date);
		expect(project.updatedAt).toBeInstanceOf(Date);
	});
});
