import type { Room } from '$lib/models/types';

/**
 * Room identity across geometry recalculation (HP-202).
 *
 * Rooms are *derived* data — `detectRooms` recomputes them from walls on every edit — but the
 * name, floor texture, colour, type and label offset a user attaches to a room are not
 * derived, they are authored. Losing them on a wall nudge means the user re-types "Kitchen"
 * every time they adjust the plan, so recalculation has to carry authored data forward.
 *
 * Identity is matched on the **set of wall ids bounding the room**. That needs no extra
 * persisted state and no access to the pre-edit geometry, and it survives the common case:
 * moving a wall changes its coordinates, not its id, so the wall set is untouched.
 *
 * The previous implementation lived inline in `FloorPlanCanvas.svelte`, required *exact*
 * wall-set equality, carried only id/name/floorTexture, and mutated the detected rooms in
 * place. This module replaces it.
 */

/**
 * Fields owned by the user, carried across recalculation.
 *
 * Geometry fields (`walls`, `area`) are deliberately absent — those always come from fresh
 * detection. Adding an authored field to `Room` means adding it here.
 */
export const ROOM_METADATA_KEYS = [
	'name',
	'floorTexture',
	'color',
	'roomType',
	'labelOffset'
] as const satisfies readonly (keyof Room)[];

/**
 * Minimum wall-set overlap (Jaccard index) for two rooms to be considered the same room.
 *
 * 0.5 is chosen so that replacing one wall of a four-wall room — delete and redraw, giving
 * the wall a new id — still counts as the same room (3 shared of 5 union = 0.6), while a room
 * sharing only an incidental wall or two with a neighbour does not.
 */
export const MIN_ROOM_MATCH_SIMILARITY = 0.5;

/**
 * Largest area ratio tolerated between a candidate and a detected room.
 *
 * Adjacent rooms in a grid necessarily share walls, so wall overlap alone can suggest a match
 * between a closet and a hall. Requiring areas to be within 4x guards the worst
 * mis-assignments without rejecting legitimate resizes.
 */
export const MAX_ROOM_MATCH_AREA_RATIO = 4;

/** Distinct wall ids, sorted — the canonical form of a room's boundary identity. */
function normalizedWalls(walls: readonly string[]): string[] {
	return [...new Set(walls)].sort();
}

/** djb2. Small, stable, and dependency-free — this is an identity key, not a security hash. */
function hashString(value: string): string {
	let hash = 5381;
	for (let i = 0; i < value.length; i++) {
		hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
	}
	// Unsigned, base-36 for a short readable suffix.
	return (hash >>> 0).toString(36);
}

/**
 * A deterministic id for a room with the given boundary.
 *
 * Replaces `room-${index}-${Date.now()}`, which changed on every call and made identity
 * depend on wall iteration order and the clock. Deriving from the wall set means re-detecting
 * an unchanged room yields the same id even with no reconciliation at all.
 */
export function deriveRoomId(walls: readonly string[]): string {
	return `room-${hashString(normalizedWalls(walls).join('|'))}`;
}

/**
 * Jaccard index of two wall sets: shared walls / total distinct walls.
 * 1 means identical boundaries, 0 means no walls in common.
 */
export function wallSetSimilarity(a: readonly string[], b: readonly string[]): number {
	const setA = new Set(a);
	const setB = new Set(b);
	if (setA.size === 0 || setB.size === 0) return 0;

	let shared = 0;
	for (const wall of setA) {
		if (setB.has(wall)) shared++;
	}

	return shared / (setA.size + setB.size - shared);
}

/** Areas are compatible if neither is more than `MAX_ROOM_MATCH_AREA_RATIO` times the other. */
function areasCompatible(a: number, b: number): boolean {
	// A zero or missing area carries no information, so it cannot disqualify a match.
	if (!(a > 0) || !(b > 0)) return true;

	return Math.max(a, b) / Math.min(a, b) <= MAX_ROOM_MATCH_AREA_RATIO;
}

/** Copy only the authored fields, skipping ones the candidate never had. */
function carryMetadata(detected: Room, candidate: Room): Room {
	const carried: Partial<Room> = {};
	for (const key of ROOM_METADATA_KEYS) {
		if (candidate[key] !== undefined) {
			carried[key] = candidate[key] as never;
		}
	}

	return { ...detected, ...carried, id: candidate.id };
}

interface Pairing {
	detectedIndex: number;
	candidateIndex: number;
	similarity: number;
	areaDelta: number;
}

/**
 * Reattach authored metadata and stable ids to freshly detected rooms.
 *
 * Matching is greedy best-first over all viable (detected, candidate) pairs: strongest wall
 * overlap wins, with the smaller area difference breaking ties, and each candidate is claimed
 * at most once. Best-first ordering matters — it lets every unchanged room claim its own
 * previous self at similarity 1.0 before any changed room competes for what is left, which is
 * what stops a deleted room's name migrating to a neighbour that merely shares walls.
 *
 * Detected rooms with no viable candidate keep a deterministic id from `deriveRoomId`.
 * Candidates with no match are dropped: their room no longer exists.
 *
 * Pure — inputs are never mutated.
 *
 * @param detected freshly detected rooms, straight from `detectRooms`
 * @param previous rooms from the live session (most authoritative)
 * @param saved rooms persisted on the floor, used when there is no live match
 */
export function reconcileDetectedRooms(
	detected: readonly Room[],
	previous: readonly Room[],
	saved: readonly Room[] = []
): Room[] {
	if (detected.length === 0) return [];

	// Live rooms first so they win ties; de-duplicate so a room present in both lists is
	// considered once.
	const candidates: Room[] = [];
	const seenIds = new Set<string>();
	for (const candidate of [...previous, ...saved]) {
		if (seenIds.has(candidate.id)) continue;
		seenIds.add(candidate.id);
		candidates.push(candidate);
	}

	const pairings: Pairing[] = [];
	for (let d = 0; d < detected.length; d++) {
		for (let c = 0; c < candidates.length; c++) {
			const similarity = wallSetSimilarity(detected[d].walls, candidates[c].walls);
			if (similarity < MIN_ROOM_MATCH_SIMILARITY) continue;
			if (!areasCompatible(detected[d].area, candidates[c].area)) continue;

			pairings.push({
				detectedIndex: d,
				candidateIndex: c,
				similarity,
				areaDelta: Math.abs(detected[d].area - candidates[c].area)
			});
		}
	}

	// Strongest overlap first; then closest area; then candidate order, so live rooms beat
	// saved ones and the result is fully deterministic.
	pairings.sort(
		(a, b) =>
			b.similarity - a.similarity ||
			a.areaDelta - b.areaDelta ||
			a.candidateIndex - b.candidateIndex ||
			a.detectedIndex - b.detectedIndex
	);

	const matchedCandidate = new Map<number, number>();
	const claimedDetected = new Set<number>();
	const claimedCandidates = new Set<number>();

	for (const pairing of pairings) {
		if (claimedDetected.has(pairing.detectedIndex)) continue;
		if (claimedCandidates.has(pairing.candidateIndex)) continue;
		claimedDetected.add(pairing.detectedIndex);
		claimedCandidates.add(pairing.candidateIndex);
		matchedCandidate.set(pairing.detectedIndex, pairing.candidateIndex);
	}

	return detected.map((room, index) => {
		const candidateIndex = matchedCandidate.get(index);
		if (candidateIndex === undefined) {
			return { ...room, id: deriveRoomId(room.walls) };
		}

		return carryMetadata(room, candidates[candidateIndex]);
	});
}
