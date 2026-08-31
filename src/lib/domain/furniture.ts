import type { FurnitureItem } from '$lib/models/types';

/**
 * Resolving a placed furniture item's real physical size.
 *
 * PRD 14.4 makes per-item dimensions authoritative: if a placed item overrides
 * width/depth/height, then the 2D footprint, hit testing, snapping, collision detection,
 * clearance measurement, 3D scaling, selection bounds and exports must all agree.
 *
 * They did not. The 2D renderer, 3D viewer, alignment tools and distance overlay each
 * re-derived `item.width ?? cat.width` inline, while `hitTesting.ts` used `cat.width` alone —
 * so a resized item was drawn at its real size but selectable only at its catalog size.
 * This module is the single source of truth those five call sites now share (HP-203).
 */

export interface PhysicalDimensions {
	/** Along the item's local X axis, in cm. */
	width: number;
	/** Along the item's local Y axis, in cm. */
	depth: number;
	/** Vertical, in cm. */
	height: number;
}

/** Minimal shape needed from a catalog entry — keeps this module independent of the catalog. */
export interface CatalogDimensions {
	width: number;
	depth: number;
	height: number;
}

/**
 * Used when an item references a catalog id that no longer exists (a renamed built-in, or a
 * project from a build with a different catalog). Better a visible, selectable box of
 * plausible size than a zero-sized item the user cannot click to fix.
 */
export const FALLBACK_FURNITURE_DIMENSIONS: PhysicalDimensions = {
	width: 50,
	depth: 50,
	height: 50
};

/** A dimension is usable only if it is a positive, finite number. */
function isUsableDimension(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Scale factor along one axis. Negative values mirror the item rather than shrinking it, so
 * only the magnitude affects size; zero and non-finite values would collapse the footprint,
 * so they fall back to 1.
 */
function axisScale(value: unknown): number {
	if (!isUsableDimension(value) && !(typeof value === 'number' && Number.isFinite(value))) {
		return 1;
	}

	const magnitude = Math.abs(value as number);
	return magnitude > 0 ? magnitude : 1;
}

function resolveAxis(override: unknown, catalogValue: unknown, fallback: number, scale: number): number {
	const base = isUsableDimension(override)
		? override
		: isUsableDimension(catalogValue)
			? catalogValue
			: fallback;

	return base * scale;
}

/**
 * Dimensions with per-item overrides applied but **not** the item's scale.
 *
 * For consumers that apply scale themselves — the 3D viewer scales the `Object3D` directly,
 * so folding scale in here as well would apply it twice. Everything reasoning in world
 * coordinates wants `resolveFurnitureDimensions` instead.
 */
export function resolveBaseDimensions(
	item: FurnitureItem,
	catalogDef: CatalogDimensions | undefined
): PhysicalDimensions {
	return {
		width: resolveAxis(item.width, catalogDef?.width, FALLBACK_FURNITURE_DIMENSIONS.width, 1),
		depth: resolveAxis(item.depth, catalogDef?.depth, FALLBACK_FURNITURE_DIMENSIONS.depth, 1),
		height: resolveAxis(item.height, catalogDef?.height, FALLBACK_FURNITURE_DIMENSIONS.height, 1)
	};
}

/**
 * The authoritative physical dimensions of a placed item, in world centimetres.
 *
 * Per-item override wins over the catalog value, then the item's scale is applied. The result
 * is always positive and finite, so callers can divide by it and build bounds from it without
 * guarding.
 *
 * @param item  the placed furniture item
 * @param catalogDef the catalog entry for `item.catalogId`, or `undefined` if unknown
 */
export function resolveFurnitureDimensions(
	item: FurnitureItem,
	catalogDef: CatalogDimensions | undefined
): PhysicalDimensions {
	const base = resolveBaseDimensions(item, catalogDef);

	return {
		width: base.width * axisScale(item.scale?.x),
		depth: base.depth * axisScale(item.scale?.y),
		height: base.height * axisScale(item.scale?.z)
	};
}

/**
 * Half-extents of the item's footprint, the form hit testing and bounds checks want.
 * Kept here so no caller re-derives `width / 2` from a differently-resolved width.
 */
export function furnitureHalfExtents(
	item: FurnitureItem,
	catalogDef: CatalogDimensions | undefined
): { halfWidth: number; halfDepth: number } {
	const { width, depth } = resolveFurnitureDimensions(item, catalogDef);

	return { halfWidth: width / 2, halfDepth: depth / 2 };
}
