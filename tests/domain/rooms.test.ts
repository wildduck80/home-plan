import { describe, it, expect } from 'vitest';
import {
	deriveRoomId,
	wallSetSimilarity,
	reconcileDetectedRooms,
	ROOM_METADATA_KEYS,
	MIN_ROOM_MATCH_SIMILARITY
} from '$lib/domain/rooms';
import type { Room } from '$lib/models/types';

/**
 * HP-202 (identity half) — a room's id and the metadata the user attached to it must survive
 * geometry recalculation whenever the boundary is materially unchanged.
 */

function room(id: string, walls: string[], overrides: Partial<Room> = {}): Room {
	return {
		id,
		name: `Room ${id}`,
		walls,
		floorTexture: 'hardwood',
		area: 12,
		...overrides
	};
}

describe('deriveRoomId', () => {
	it('is deterministic for the same wall set', () => {
		expect(deriveRoomId(['a', 'b', 'c'])).toBe(deriveRoomId(['a', 'b', 'c']));
	});

	it('ignores wall order', () => {
		expect(deriveRoomId(['a', 'b', 'c'])).toBe(deriveRoomId(['c', 'a', 'b']));
	});

	it('ignores duplicate wall ids', () => {
		expect(deriveRoomId(['a', 'b', 'a'])).toBe(deriveRoomId(['a', 'b']));
	});

	it('differs for different wall sets', () => {
		expect(deriveRoomId(['a', 'b', 'c'])).not.toBe(deriveRoomId(['a', 'b', 'd']));
	});

	it('does not depend on the clock', async () => {
		const first = deriveRoomId(['a', 'b', 'c']);
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(deriveRoomId(['a', 'b', 'c'])).toBe(first);
	});

	it('produces a stable, recognisable id shape', () => {
		expect(deriveRoomId(['a', 'b'])).toMatch(/^room-[0-9a-z]+$/);
	});

	it('handles an empty wall set without throwing', () => {
		expect(typeof deriveRoomId([])).toBe('string');
	});
});

describe('wallSetSimilarity', () => {
	it('is 1 for identical sets', () => {
		expect(wallSetSimilarity(['a', 'b', 'c'], ['c', 'b', 'a'])).toBe(1);
	});

	it('is 0 for disjoint sets', () => {
		expect(wallSetSimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
	});

	it('is the Jaccard index for partial overlap', () => {
		// {a,b,c} vs {a,b,d}: intersection 2, union 4
		expect(wallSetSimilarity(['a', 'b', 'c'], ['a', 'b', 'd'])).toBeCloseTo(0.5);
	});

	it('is 0 when either set is empty', () => {
		expect(wallSetSimilarity([], ['a'])).toBe(0);
		expect(wallSetSimilarity([], [])).toBe(0);
	});
});

describe('reconcileDetectedRooms — unchanged geometry', () => {
	it('preserves the id when the wall set is identical', () => {
		const previous = [room('kitchen-id', ['n', 'e', 's', 'w'], { name: 'Kitchen' })];
		const detected = [room('fresh-id', ['n', 'e', 's', 'w'])];

		const [result] = reconcileDetectedRooms(detected, previous);

		expect(result.id).toBe('kitchen-id');
		expect(result.name).toBe('Kitchen');
	});

	it('preserves every piece of user metadata, not just name and texture', () => {
		const previous = [
			room('r1', ['n', 'e', 's', 'w'], {
				name: 'Living Room',
				floorTexture: 'oak',
				color: '#ff8800',
				roomType: 'outdoor',
				labelOffset: { x: 12, y: -8 }
			})
		];
		const detected = [room('fresh', ['n', 'e', 's', 'w'], { area: 12 })];

		const [result] = reconcileDetectedRooms(detected, previous);

		expect(result.name).toBe('Living Room');
		expect(result.floorTexture).toBe('oak');
		expect(result.color).toBe('#ff8800');
		expect(result.roomType).toBe('outdoor');
		expect(result.labelOffset).toEqual({ x: 12, y: -8 });
	});

	it('takes freshly computed geometry from the detected room', () => {
		const previous = [room('r1', ['n', 'e', 's', 'w'], { area: 12 })];
		// The wall moved: same walls, new area.
		const detected = [room('fresh', ['n', 'e', 's', 'w'], { area: 18 })];

		const [result] = reconcileDetectedRooms(detected, previous);

		expect(result.id).toBe('r1');
		expect(result.area).toBe(18);
		expect(result.walls).toEqual(['n', 'e', 's', 'w']);
	});

	it('is idempotent — reconciling its own output changes nothing', () => {
		const previous = [room('r1', ['n', 'e', 's', 'w'], { name: 'Study' })];
		const detected = [room('fresh', ['n', 'e', 's', 'w'])];

		const once = reconcileDetectedRooms(detected, previous);
		const twice = reconcileDetectedRooms(once, once);

		expect(twice).toEqual(once);
	});

	it('does not mutate its inputs', () => {
		const previous = [room('r1', ['n', 'e', 's', 'w'], { name: 'Study' })];
		const detected = [room('fresh', ['n', 'e', 's', 'w'])];
		const previousSnapshot = JSON.stringify(previous);
		const detectedSnapshot = JSON.stringify(detected);

		reconcileDetectedRooms(detected, previous);

		expect(JSON.stringify(previous)).toBe(previousSnapshot);
		expect(JSON.stringify(detected)).toBe(detectedSnapshot);
	});
});

describe('reconcileDetectedRooms — changed geometry', () => {
	it('preserves identity when one boundary wall is replaced', () => {
		// User deleted the west wall and redrew it, so it has a new id.
		const previous = [room('r1', ['n', 'e', 's', 'w'], { name: 'Bedroom' })];
		const detected = [room('fresh', ['n', 'e', 's', 'w2'])];

		const [result] = reconcileDetectedRooms(detected, previous);

		// 3 of 5 walls shared = 0.6 similarity, above the threshold.
		expect(result.id).toBe('r1');
		expect(result.name).toBe('Bedroom');
	});

	it('assigns a new id when the boundary is materially different', () => {
		const previous = [room('r1', ['n', 'e', 's', 'w'], { name: 'Bedroom' })];
		const detected = [room('fresh', ['p', 'q', 'r', 't'])];

		const [result] = reconcileDetectedRooms(detected, previous);

		expect(result.id).not.toBe('r1');
		expect(result.name).not.toBe('Bedroom');
	});

	it('gives a genuinely new room a deterministic id derived from its walls', () => {
		const detected = [room('fresh', ['p', 'q', 'r'])];

		const [result] = reconcileDetectedRooms(detected, []);

		expect(result.id).toBe(deriveRoomId(['p', 'q', 'r']));
	});

	it('claims each previous room at most once', () => {
		const previous = [room('r1', ['n', 'e', 's', 'w'], { name: 'Original' })];
		// A divider splits the room in two; both halves share 3 of the original walls.
		const detected = [
			room('a', ['n', 'divider', 's', 'w'], { area: 6 }),
			room('b', ['n', 'e', 's', 'divider'], { area: 6 })
		];

		const results = reconcileDetectedRooms(detected, previous);
		const inheritors = results.filter((r) => r.id === 'r1');

		expect(inheritors).toHaveLength(1);
		// The other half must get its own fresh identity, not a duplicate.
		expect(new Set(results.map((r) => r.id)).size).toBe(2);
	});

	it('gives the closest-in-area half the original identity on an uneven split', () => {
		const previous = [room('r1', ['n', 'e', 's', 'w'], { name: 'Great Room', area: 20 })];
		const detected = [
			room('small', ['n', 'divider', 's', 'w'], { area: 4 }),
			room('large', ['n', 'e', 's', 'divider'], { area: 16 })
		];

		const results = reconcileDetectedRooms(detected, previous);
		const inheritor = results.find((r) => r.id === 'r1');

		expect(inheritor?.area).toBe(16);
		expect(inheritor?.name).toBe('Great Room');
	});

	it('rejects a match whose area is wildly different despite shared walls', () => {
		// Shares 3 of 5 walls, but 100x the area — almost certainly not the same room.
		const previous = [room('r1', ['n', 'e', 's', 'w'], { name: 'Closet', area: 1 })];
		const detected = [room('fresh', ['n', 'e', 's', 'w2'], { area: 100 })];

		const [result] = reconcileDetectedRooms(detected, previous);

		expect(result.id).not.toBe('r1');
	});

	it('drops previous rooms that no longer exist', () => {
		const previous = [room('gone', ['x', 'y', 'z']), room('kept', ['n', 'e', 's', 'w'])];
		const detected = [room('fresh', ['n', 'e', 's', 'w'])];

		const results = reconcileDetectedRooms(detected, previous);

		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('kept');
	});

	it('returns an empty list when nothing is detected', () => {
		expect(reconcileDetectedRooms([], [room('r1', ['n', 'e', 's', 'w'])])).toEqual([]);
	});
});

describe('reconcileDetectedRooms — candidate precedence', () => {
	it('prefers live session rooms over persisted rooms on an exact tie', () => {
		const live = [room('live-id', ['n', 'e', 's', 'w'], { name: 'Live Name' })];
		const saved = [room('saved-id', ['n', 'e', 's', 'w'], { name: 'Saved Name' })];
		const detected = [room('fresh', ['n', 'e', 's', 'w'])];

		const [result] = reconcileDetectedRooms(detected, live, saved);

		expect(result.id).toBe('live-id');
		expect(result.name).toBe('Live Name');
	});

	it('falls back to persisted rooms when there is no live match', () => {
		// The situation right after loading a project: nothing live yet.
		const saved = [room('saved-id', ['n', 'e', 's', 'w'], { name: 'From Disk' })];
		const detected = [room('fresh', ['n', 'e', 's', 'w'])];

		const [result] = reconcileDetectedRooms(detected, [], saved);

		expect(result.id).toBe('saved-id');
		expect(result.name).toBe('From Disk');
	});

	it('ignores a duplicate candidate id appearing in both lists', () => {
		const shared = room('same-id', ['n', 'e', 's', 'w'], { name: 'Canonical' });
		const detected = [room('fresh', ['n', 'e', 's', 'w'])];

		const results = reconcileDetectedRooms(detected, [shared], [shared]);

		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Canonical');
	});
});

describe('room metadata contract', () => {
	it('lists exactly the user-owned fields carried across recalculation', () => {
		// Geometry fields (walls, area) must NOT be here — they always come from detection.
		expect([...ROOM_METADATA_KEYS].sort()).toEqual(
			['color', 'floorTexture', 'labelOffset', 'name', 'roomType'].sort()
		);
	});

	it('uses a similarity threshold that tolerates one replaced wall', () => {
		// {n,e,s,w} vs {n,e,s,w2} = 0.6, which must qualify.
		expect(MIN_ROOM_MATCH_SIMILARITY).toBeLessThanOrEqual(0.6);
		// But a single shared wall out of seven (0.14) must not.
		expect(MIN_ROOM_MATCH_SIMILARITY).toBeGreaterThan(0.15);
	});
});
