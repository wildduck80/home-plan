/**
 * A project in the shape the openPlan3D 0.9.0 build persisted.
 *
 * Deliberately incomplete: no `schemaVersion`, and the floor supplies only `walls` and
 * `doors`, omitting the other ten collections. That is exactly what the load pipeline has to
 * cope with (HP-102/HP-103), so the fixture must not be tidied up.
 *
 * Geometry is a 400x300 cm rectangle, matching the `simple-room` golden fixture, so the
 * expected detected area of 12 m² is shared between the unit and E2E suites.
 */
export function legacyProject(id = 'legacyproj', name = 'Legacy Bungalow') {
	return {
		id,
		name,
		description: 'Saved before schemaVersion existed.',
		activeFloorId: 'floorgnd',
		createdAt: '2026-01-15T09:30:00.000Z',
		updatedAt: '2026-02-02T18:45:12.000Z',
		floors: [
			{
				id: 'floorgnd',
				name: 'Ground Floor',
				level: 0,
				walls: [
					wall('w-n', 0, 0, 400, 0),
					wall('w-e', 400, 0, 400, 300),
					wall('w-s', 400, 300, 0, 300),
					wall('w-w', 0, 300, 0, 0)
				],
				doors: [
					{
						id: 'd1',
						wallId: 'w-s',
						position: 0.5,
						width: 90,
						height: 210,
						type: 'single',
						swingDirection: 'left',
						flipSide: false
					}
				]
				// rooms, windows, furniture, stairs, columns, guides, measurements,
				// annotations, textAnnotations and groups are intentionally absent.
			}
		]
	};
}

function wall(id: string, x1: number, y1: number, x2: number, y2: number) {
	return {
		id,
		start: { x: x1, y: y1 },
		end: { x: x2, y: y2 },
		thickness: 15,
		height: 280,
		color: '#444444'
	};
}

/** Wall centreline area of the fixture, in m² — what room detection should report. */
export const LEGACY_PROJECT_ROOM_AREA_M2 = 12;
