import type {
	Column,
	Door,
	Floor,
	FurnitureItem,
	Point,
	Project,
	Stair,
	Wall,
	Window
} from '$lib/models/types';
import { createFloor, createProject } from '$lib/domain/factories';
import { CURRENT_PROJECT_SCHEMA_VERSION } from '$lib/persistence/schema';

/**
 * Builders for the golden fixture suite (HP-004).
 *
 * Every id here is an explicit, stable string rather than a generated one: fixtures are
 * regression baselines, so two runs must produce byte-identical projects. That is also why
 * `fixtureProject` overwrites the factory's random id and clock-based timestamps.
 *
 * All coordinates are wall **centrelines** in centimetres, matching what `detectRooms`
 * consumes. Origin is top-left, y increases downwards (screen coordinates).
 */

export const DEFAULT_WALL_THICKNESS = 15;
export const DEFAULT_WALL_HEIGHT = 280;

/** Fixed timestamp so fixtures never depend on the current date. */
const FIXTURE_EPOCH = new Date('2026-01-01T00:00:00.000Z');

export function wall(id: string, start: Point, end: Point, overrides: Partial<Wall> = {}): Wall {
	return {
		id,
		start,
		end,
		thickness: DEFAULT_WALL_THICKNESS,
		height: DEFAULT_WALL_HEIGHT,
		color: '#444444',
		...overrides
	};
}

/**
 * Four walls tracing a rectangle clockwise from the top-left corner.
 * Wall ids are `${prefix}-n`, `-e`, `-s`, `-w`.
 */
export function rectWalls(
	prefix: string,
	x: number,
	y: number,
	width: number,
	height: number,
	overrides: Partial<Wall> = {}
): Wall[] {
	const topLeft = { x, y };
	const topRight = { x: x + width, y };
	const bottomRight = { x: x + width, y: y + height };
	const bottomLeft = { x, y: y + height };

	return [
		wall(`${prefix}-n`, topLeft, topRight, overrides),
		wall(`${prefix}-e`, topRight, bottomRight, overrides),
		wall(`${prefix}-s`, bottomRight, bottomLeft, overrides),
		wall(`${prefix}-w`, bottomLeft, topLeft, overrides)
	];
}

/** A vertical interior wall — used to divide a span into adjacent rooms. */
export function verticalWall(id: string, x: number, yStart: number, yEnd: number): Wall {
	return wall(id, { x, y: yStart }, { x, y: yEnd });
}

/** A horizontal interior wall — used to divide a span into stacked rooms. */
export function horizontalWall(id: string, y: number, xStart: number, xEnd: number): Wall {
	return wall(id, { x: xStart, y }, { x: xEnd, y });
}

export function door(id: string, wallId: string, position: number, overrides: Partial<Door> = {}): Door {
	return {
		id,
		wallId,
		position,
		width: 90,
		height: 210,
		type: 'single',
		swingDirection: 'left',
		flipSide: false,
		...overrides
	};
}

export function window(
	id: string,
	wallId: string,
	position: number,
	overrides: Partial<Window> = {}
): Window {
	return {
		id,
		wallId,
		position,
		width: 120,
		height: 140,
		sillHeight: 90,
		type: 'standard',
		...overrides
	};
}

export function furniture(
	id: string,
	catalogId: string,
	position: Point,
	overrides: Partial<FurnitureItem> = {}
): FurnitureItem {
	return {
		id,
		catalogId,
		position,
		rotation: 0,
		scale: { x: 1, y: 1, z: 1 },
		...overrides
	};
}

export function stair(id: string, position: Point, overrides: Partial<Stair> = {}): Stair {
	return {
		id,
		position,
		rotation: 0,
		width: 100,
		depth: 300,
		riserCount: 14,
		direction: 'up',
		stairType: 'straight',
		...overrides
	};
}

export function column(id: string, position: Point, overrides: Partial<Column> = {}): Column {
	return {
		id,
		position,
		rotation: 0,
		shape: 'square',
		diameter: 30,
		height: DEFAULT_WALL_HEIGHT,
		color: '#cccccc',
		...overrides
	};
}

/** A complete `Floor` with a fixed id, built through the canonical factory. */
export function fixtureFloor(id: string, level: number, parts: Partial<Floor> = {}): Floor {
	return { ...createFloor({ id, level }), ...parts };
}

/** A complete `Project` with fixed id and timestamps, built through the canonical factory. */
export function fixtureProject(id: string, name: string, floors: Floor[]): Project {
	return {
		...createProject(name),
		schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
		id,
		floors,
		activeFloorId: floors[0].id,
		createdAt: FIXTURE_EPOCH,
		updatedAt: FIXTURE_EPOCH
	};
}

/** Convert a centreline area in cm² to m², rounded the same way `detectRooms` rounds. */
export function toSquareMetres(areaInSquareCm: number): number {
	return Math.round((areaInSquareCm / 10000) * 100) / 100;
}
