/**
 * A project whose walls and floors all carry textures.
 *
 * Textures are the point: the leak HP-005 found was in texture disposal, and an untextured
 * project would have shown almost nothing. Every wall gets base, interior and exterior
 * textures, and both rooms get floor textures, so a rebuild allocates a realistic number of
 * GPU textures.
 */
export function texturedProject(id = 'texproj', name = 'Textured House') {
	const wall = (wallId: string, x1: number, y1: number, x2: number, y2: number) => ({
		id: wallId,
		start: { x: x1, y: y1 },
		end: { x: x2, y: y2 },
		thickness: 15,
		height: 280,
		color: '#8b5a3c',
		texture: 'red-brick',
		interiorTexture: 'wood-panel',
		exteriorTexture: 'stone'
	});

	return {
		id,
		name,
		activeFloorId: 'f1',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		floors: [
			{
				id: 'f1',
				name: 'Ground Floor',
				level: 0,
				// 600x400 envelope split by a central divider — two rooms, so two floor textures.
				walls: [
					wall('w-n', 0, 0, 600, 0),
					wall('w-e', 600, 0, 600, 400),
					wall('w-s', 600, 400, 0, 400),
					wall('w-w', 0, 400, 0, 0),
					wall('w-mid', 300, 0, 300, 400)
				],
				doors: [],
				windows: [],
				rooms: [
					{
						id: 'r1',
						name: 'Left',
						walls: ['w-n', 'w-mid', 'w-s', 'w-w'],
						floorTexture: 'walnut',
						area: 12
					},
					{
						id: 'r2',
						name: 'Right',
						walls: ['w-n', 'w-e', 'w-s', 'w-mid'],
						floorTexture: 'subway-tile',
						area: 12
					}
				]
			}
		]
	};
}
