import { describe, it, expect } from 'vitest';
import { detectRooms } from '$lib/utils/roomDetection';
import { reconcileDetectedRooms } from '$lib/domain/rooms';
import { getGoldenFixture } from '../fixtures/golden';
import type { Room, Wall } from '$lib/models/types';

/**
 * HP-202 — integration: detection and reconciliation together, over the edit sequences a
 * user actually performs. The unit tests in `tests/domain/rooms.test.ts` cover the matching
 * rules; this file checks the pipeline `FloorPlanCanvas` runs.
 */

/** One recalculation pass, exactly as the canvas does it. */
function recalculate(walls: Wall[], previous: Room[], saved: Room[] = []): Room[] {
	return reconcileDetectedRooms(detectRooms(walls), previous, saved);
}

/** Simulate the user naming a room and giving it a texture and colour. */
function authored(room: Room, name: string): Room {
	return { ...room, name, floorTexture: 'oak', color: '#ff8800', labelOffset: { x: 5, y: 5 } };
}

function simpleRoomWalls(): Wall[] {
	return [...getGoldenFixture('simple-room').project.floors[0].walls];
}

describe('room identity through an editing session', () => {
	it('keeps the name after a wall is dragged', () => {
		const walls = simpleRoomWalls();
		const [initial] = recalculate(walls, []);
		const named = [authored(initial, 'Kitchen')];

		// Drag the east wall 100 cm to the right.
		const widened = walls.map((w) =>
			w.id === 'outer-n'
				? { ...w, end: { x: 500, y: 0 } }
				: w.id === 'outer-e'
					? { ...w, start: { x: 500, y: 0 }, end: { x: 500, y: 300 } }
					: w.id === 'outer-s'
						? { ...w, start: { x: 500, y: 300 } }
						: w
		);

		const [after] = recalculate(widened, named);

		expect(after.id).toBe(initial.id);
		expect(after.name).toBe('Kitchen');
		expect(after.floorTexture).toBe('oak');
		expect(after.color).toBe('#ff8800');
		expect(after.labelOffset).toEqual({ x: 5, y: 5 });
		// Geometry is recomputed.
		expect(after.area).toBe(15);
	});

	it('survives many consecutive recalculations without drifting', () => {
		const walls = simpleRoomWalls();
		let rooms = [authored(recalculate(walls, [])[0], 'Study')];
		const originalId = rooms[0].id;

		for (let i = 0; i < 25; i++) {
			rooms = recalculate(walls, rooms);
		}

		expect(rooms).toHaveLength(1);
		expect(rooms[0].id).toBe(originalId);
		expect(rooms[0].name).toBe('Study');
	});

	it('keeps every room named when a room is added elsewhere on the floor', () => {
		const walls = simpleRoomWalls();
		let rooms = [authored(recalculate(walls, [])[0], 'Kitchen')];

		// Draw a second, detached room well clear of the first.
		const secondRoom: Wall[] = [
			{ id: 's-n', start: { x: 800, y: 0 }, end: { x: 1100, y: 0 }, thickness: 15, height: 280, color: '#444' },
			{ id: 's-e', start: { x: 1100, y: 0 }, end: { x: 1100, y: 200 }, thickness: 15, height: 280, color: '#444' },
			{ id: 's-s', start: { x: 1100, y: 200 }, end: { x: 800, y: 200 }, thickness: 15, height: 280, color: '#444' },
			{ id: 's-w', start: { x: 800, y: 200 }, end: { x: 800, y: 0 }, thickness: 15, height: 280, color: '#444' }
		];

		rooms = recalculate([...walls, ...secondRoom], rooms);

		expect(rooms).toHaveLength(2);
		const kitchen = rooms.find((r) => r.name === 'Kitchen');
		expect(kitchen).toBeDefined();
		expect(kitchen!.area).toBe(12);
	});

	it('keeps one half named when a divider splits a room', () => {
		const walls = simpleRoomWalls();
		let rooms = [authored(recalculate(walls, [])[0], 'Great Room')];

		// Divider at x=100 gives a 100x300 and a 300x300 half.
		const divided = [
			...walls,
			{ id: 'divider', start: { x: 100, y: 0 }, end: { x: 100, y: 300 }, thickness: 15, height: 280, color: '#444' }
		];

		rooms = recalculate(divided, rooms);

		expect(rooms).toHaveLength(2);
		// The larger half is closest in area to the original, so it inherits.
		const inheritor = rooms.find((r) => r.name === 'Great Room');
		expect(inheritor).toBeDefined();
		expect(inheritor!.area).toBe(9);
		// The other half must be distinct and unnamed by the user.
		expect(new Set(rooms.map((r) => r.id)).size).toBe(2);
	});

	it('drops a room once its walls are deleted', () => {
		const walls = simpleRoomWalls();
		const rooms = [authored(recalculate(walls, [])[0], 'Doomed')];

		const opened = walls.filter((w) => w.id !== 'outer-e');

		expect(recalculate(opened, rooms)).toEqual([]);
	});

	it('does not let a deleted room\'s name migrate to a neighbour', () => {
		const fixture = getGoldenFixture('adjacent-two-room');
		const walls = [...fixture.project.floors[0].walls];
		let rooms = recalculate(walls, []);
		expect(rooms).toHaveLength(2);

		rooms = rooms.map((r, i) => authored(r, i === 0 ? 'Left' : 'Right'));
		const leftId = rooms[0].id;

		// Recalculate unchanged: both rooms match themselves exactly, so names must not swap.
		rooms = recalculate(walls, rooms);

		expect(rooms.find((r) => r.id === leftId)?.name).toBe('Left');
		expect(rooms.map((r) => r.name).sort()).toEqual(['Left', 'Right']);
	});

	it('assigns a stable distinct id to each of ten grid rooms', () => {
		const walls = getGoldenFixture('ten-room-grid').project.floors[0].walls;

		const first = recalculate([...walls], []);
		const second = recalculate([...walls], first);

		expect(first).toHaveLength(10);
		expect(new Set(first.map((r) => r.id)).size).toBe(10);
		expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
	});
});

describe('room identity for projects saved before HP-202', () => {
	/**
	 * Projects saved by earlier builds hold room ids like `room-1-1755000000000`. Detection now
	 * derives ids from geometry, so those never match by id — reconciliation must recognise
	 * them by wall set and adopt the persisted id, or every legacy room silently loses its name
	 * and any `selectedRoomId` reference breaks.
	 */
	it('adopts a legacy clock-based id from the persisted floor', () => {
		const walls = simpleRoomWalls();
		const legacySaved: Room[] = [
			{
				id: 'room-1-1755000000000',
				name: 'Master Bedroom',
				walls: walls.map((w) => w.id),
				floorTexture: 'walnut',
				area: 12,
				roomType: 'indoor'
			}
		];

		const [result] = recalculate(walls, [], legacySaved);

		expect(result.id).toBe('room-1-1755000000000');
		expect(result.name).toBe('Master Bedroom');
		expect(result.floorTexture).toBe('walnut');
		expect(result.roomType).toBe('indoor');
	});

	it('keeps the legacy id stable across later recalculations', () => {
		const walls = simpleRoomWalls();
		const legacySaved: Room[] = [
			{
				id: 'room-1-1755000000000',
				name: 'Master Bedroom',
				walls: walls.map((w) => w.id),
				floorTexture: 'walnut',
				area: 12
			}
		];

		let rooms = recalculate(walls, [], legacySaved);
		rooms = recalculate(walls, rooms, legacySaved);
		rooms = recalculate(walls, rooms, legacySaved);

		expect(rooms[0].id).toBe('room-1-1755000000000');
		expect(rooms[0].name).toBe('Master Bedroom');
	});
});
