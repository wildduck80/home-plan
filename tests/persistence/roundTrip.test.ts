import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFloor, createProject } from '$lib/domain/factories';
import { deserializeProject, parseProjectJson, serializeProject } from '$lib/persistence/projectIo';
import { CURRENT_PROJECT_SCHEMA_VERSION } from '$lib/persistence/schema';
import type { Project } from '$lib/models/types';

const legacyV1Json = readFileSync(
	fileURLToPath(new URL('../fixtures/legacy/v1-minimal-project.json', import.meta.url)),
	'utf-8'
);

/** One save/load cycle through the real serializer and loader. */
function roundTrip(project: Project): Project {
	return parseProjectJson(serializeProject(project));
}

/**
 * HP-104 — `deserialize(serialize(project))` must preserve every meaningful field.
 * Dates are compared by epoch because JSON carries them as ISO strings.
 */
function expectPreserved(original: Project, restored: Project): void {
	expect(restored.id).toBe(original.id);
	expect(restored.name).toBe(original.name);
	expect(restored.description).toBe(original.description);
	expect(restored.activeFloorId).toBe(original.activeFloorId);
	expect(restored.createdAt.getTime()).toBe(original.createdAt.getTime());
	expect(restored.updatedAt.getTime()).toBe(original.updatedAt.getTime());
	expect(restored.floors).toEqual(original.floors);
}

function complexProject(): Project {
	const base = createProject('Complex House');
	const ground = createFloor({ id: 'ground', name: 'Ground Floor', level: 0 });
	const upper = createFloor({ id: 'upper', name: 'Floor 1', level: 1 });

	return {
		...base,
		description: 'Two storeys with openings, stairs, columns and furniture.',
		activeFloorId: ground.id,
		floors: [
			{
				...ground,
				walls: [
					{
						id: 'w1',
						start: { x: 0, y: 0 },
						end: { x: 600, y: 0 },
						thickness: 20,
						height: 280,
						color: '#333333',
						interiorColor: '#f5f5f5',
						exteriorTexture: 'brick'
					},
					{
						id: 'w2',
						start: { x: 600, y: 0 },
						end: { x: 600, y: 450 },
						thickness: 20,
						height: 280,
						color: '#333333',
						curvePoint: { x: 640, y: 225 }
					}
				],
				rooms: [
					{
						id: 'r1',
						name: 'Living Room',
						walls: ['w1', 'w2'],
						floorTexture: 'hardwood',
						area: 27,
						roomType: 'indoor',
						labelOffset: { x: 12, y: -8 }
					}
				],
				doors: [
					{
						id: 'd1',
						wallId: 'w1',
						position: 0.35,
						width: 90,
						height: 210,
						type: 'sliding',
						swingDirection: 'right',
						flipSide: true
					}
				],
				windows: [
					{
						id: 'win1',
						wallId: 'w2',
						position: 0.5,
						width: 140,
						height: 120,
						sillHeight: 90,
						type: 'casement'
					}
				],
				furniture: [
					{
						id: 'fur1',
						catalogId: 'bed-double',
						position: { x: 200, y: 200 },
						rotation: 90,
						scale: { x: 1, y: 1, z: 1 },
						// Per-item physical overrides — must survive verbatim (PRD 14.4).
						width: 176,
						depth: 209,
						height: 100,
						color: '#8b7355',
						material: 'oak',
						locked: true
					}
				],
				stairs: [
					{
						id: 's1',
						position: { x: 500, y: 400 },
						rotation: 180,
						width: 100,
						depth: 300,
						riserCount: 14,
						direction: 'up',
						stairType: 'l-shaped'
					}
				],
				columns: [
					{
						id: 'c1',
						position: { x: 300, y: 225 },
						rotation: 0,
						shape: 'round',
						diameter: 30,
						height: 280,
						color: '#cccccc'
					}
				],
				guides: [{ id: 'g1', orientation: 'vertical', position: 300 }],
				measurements: [{ id: 'm1', x1: 0, y1: 0, x2: 600, y2: 0 }],
				annotations: [
					{ id: 'a1', x1: 0, y1: 0, x2: 600, y2: 0, label: '6.00 m', offset: 40 }
				],
				textAnnotations: [
					{ id: 't1', x: 300, y: 150, text: 'Verify beam', fontSize: 14, color: '#ff0000', rotation: 0 }
				],
				groups: [{ id: 'grp1', elementIds: ['fur1', 'c1'] }],
				entourage: [
					{ id: 'e1', defId: 'person-standing', position: { x: 150, y: 300 }, width: 50, rotation: 0, opacity: 0.8 }
				],
				backgroundImage: {
					dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
					position: { x: -50, y: -50 },
					scale: 2.5,
					opacity: 0.45,
					rotation: 1.5,
					locked: true
				}
			},
			upper
		],
		customEntourage: [
			{ id: 'ce1', name: 'Our Car', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', aspect: 0.45 }
		]
	};
}

describe('round-trip: newly created project', () => {
	it('survives a save/load cycle unchanged', () => {
		const original = createProject('Fresh');

		expectPreserved(original, roundTrip(original));
	});

	it('carries the schema version through the exported JSON', () => {
		const json = JSON.parse(serializeProject(createProject('Fresh')));

		expect(json.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
	});
});

describe('round-trip: complex multi-floor project', () => {
	it('preserves all meaningful fields', () => {
		const original = complexProject();

		expectPreserved(original, roundTrip(original));
	});

	it('preserves per-item furniture dimension overrides exactly', () => {
		const restored = roundTrip(complexProject());
		const [bed] = restored.floors[0].furniture;

		expect(bed.width).toBe(176);
		expect(bed.depth).toBe(209);
		expect(bed.height).toBe(100);
		expect(bed.locked).toBe(true);
	});

	it('preserves the background reference image and its transform', () => {
		const restored = roundTrip(complexProject());
		const background = restored.floors[0].backgroundImage;

		expect(background).toBeDefined();
		expect(background?.scale).toBe(2.5);
		expect(background?.opacity).toBe(0.45);
		expect(background?.rotation).toBe(1.5);
		expect(background?.locked).toBe(true);
		expect(background?.position).toEqual({ x: -50, y: -50 });
	});

	it('preserves stairs and columns', () => {
		const restored = roundTrip(complexProject());

		expect(restored.floors[0].stairs).toHaveLength(1);
		expect(restored.floors[0].stairs[0].stairType).toBe('l-shaped');
		expect(restored.floors[0].columns).toHaveLength(1);
		expect(restored.floors[0].columns[0].diameter).toBe(30);
	});

	it('preserves curved-wall control points and per-face materials', () => {
		const restored = roundTrip(complexProject());
		const [w1, w2] = restored.floors[0].walls;

		expect(w1.interiorColor).toBe('#f5f5f5');
		expect(w1.exteriorTexture).toBe('brick');
		expect(w2.curvePoint).toEqual({ x: 640, y: 225 });
	});

	it('preserves project-level custom entourage definitions', () => {
		const restored = roundTrip(complexProject());

		expect(restored.customEntourage).toHaveLength(1);
		expect(restored.customEntourage?.[0].name).toBe('Our Car');
	});

	it('keeps both floors and their levels', () => {
		const restored = roundTrip(complexProject());

		expect(restored.floors.map((f) => f.level)).toEqual([0, 1]);
	});

	it('is stable across repeated cycles', () => {
		const once = roundTrip(complexProject());
		const twice = roundTrip(once);

		expect(serializeProject(twice)).toBe(serializeProject(once));
	});
});

describe('round-trip: legacy v1 project', () => {
	it('migrates then round-trips without further change', () => {
		const migrated = parseProjectJson(legacyV1Json);
		const restored = roundTrip(migrated);

		expectPreserved(migrated, restored);
		expect(restored.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
	});

	it('does not alter geometry when re-saved', () => {
		const migrated = parseProjectJson(legacyV1Json);
		const restored = roundTrip(migrated);

		expect(restored.floors[0].walls).toEqual(migrated.floors[0].walls);
	});
});

describe('round-trip: export then import', () => {
	it('reproduces the project from an exported document', () => {
		const original = complexProject();
		const exported = serializeProject(original);
		const imported = deserializeProject(JSON.parse(exported));

		expectPreserved(original, imported);
	});

	it('produces human-diffable indented JSON', () => {
		expect(serializeProject(createProject('Fresh'))).toContain('\n  ');
	});
});
