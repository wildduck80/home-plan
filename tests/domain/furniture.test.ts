import { describe, it, expect } from 'vitest';
import {
	resolveFurnitureDimensions,
	resolveBaseDimensions,
	furnitureHalfExtents,
	FALLBACK_FURNITURE_DIMENSIONS
} from '$lib/domain/furniture';
import type { FurnitureItem } from '$lib/models/types';

/**
 * HP-203 — per-item physical dimensions must be authoritative in every subsystem.
 *
 * The baseline resolved this ad hoc in five places and got it wrong in `hitTesting.ts`,
 * which sized furniture from the catalog only. A resized wardrobe was therefore drawn at its
 * real width but remained selectable only at its catalog width.
 */

const catalogDef = { id: 'wardrobe', width: 100, depth: 60, height: 200 };

function item(overrides: Partial<FurnitureItem> = {}): FurnitureItem {
	return {
		id: 'f1',
		catalogId: 'wardrobe',
		position: { x: 0, y: 0 },
		rotation: 0,
		scale: { x: 1, y: 1, z: 1 },
		...overrides
	};
}

describe('resolveFurnitureDimensions', () => {
	it('uses catalog dimensions when the item has no overrides', () => {
		expect(resolveFurnitureDimensions(item(), catalogDef)).toEqual({
			width: 100,
			depth: 60,
			height: 200
		});
	});

	it('prefers per-item overrides over catalog values', () => {
		const resized = item({ width: 240, depth: 65, height: 260 });

		expect(resolveFurnitureDimensions(resized, catalogDef)).toEqual({
			width: 240,
			depth: 65,
			height: 260
		});
	});

	it('applies overrides independently per axis', () => {
		const partial = item({ width: 240 });

		expect(resolveFurnitureDimensions(partial, catalogDef)).toEqual({
			width: 240,
			depth: 60,
			height: 200
		});
	});

	it('multiplies by the item scale', () => {
		const scaled = item({ scale: { x: 2, y: 0.5, z: 3 } });

		expect(resolveFurnitureDimensions(scaled, catalogDef)).toEqual({
			width: 200,
			depth: 30,
			height: 600
		});
	});

	it('combines overrides and scale', () => {
		const both = item({ width: 240, scale: { x: 0.5, y: 1, z: 1 } });

		expect(resolveFurnitureDimensions(both, catalogDef).width).toBe(120);
	});

	it('treats a negative scale as a mirror, not a negative size', () => {
		const mirrored = item({ scale: { x: -1, y: -2, z: 1 } });
		const resolved = resolveFurnitureDimensions(mirrored, catalogDef);

		expect(resolved.width).toBe(100);
		expect(resolved.depth).toBe(120);
	});

	it('defaults a missing scale to 1', () => {
		const noScale = { ...item(), scale: undefined } as unknown as FurnitureItem;

		expect(resolveFurnitureDimensions(noScale, catalogDef).width).toBe(100);
	});

	it('falls back to safe defaults when the catalog entry is missing', () => {
		const resolved = resolveFurnitureDimensions(item(), undefined);

		expect(resolved).toEqual(FALLBACK_FURNITURE_DIMENSIONS);
	});

	it('still honours overrides when the catalog entry is missing', () => {
		const resolved = resolveFurnitureDimensions(item({ width: 240 }), undefined);

		expect(resolved.width).toBe(240);
		expect(resolved.depth).toBe(FALLBACK_FURNITURE_DIMENSIONS.depth);
	});

	it.each([
		['zero', 0],
		['negative', -50],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY]
	])('ignores a %s override and uses the catalog value instead', (_label, bad) => {
		const resolved = resolveFurnitureDimensions(item({ width: bad }), catalogDef);

		// A non-positive or non-finite size would produce degenerate bounds downstream,
		// making an item unselectable or infinitely large (HP-205).
		expect(resolved.width).toBe(100);
	});

	it('never returns a non-finite or non-positive dimension', () => {
		const nasty = item({
			width: Number.NaN,
			depth: 0,
			height: -1,
			scale: { x: Number.NaN, y: 0, z: -0 }
		});
		const resolved = resolveFurnitureDimensions(nasty, catalogDef);

		for (const value of Object.values(resolved)) {
			expect(Number.isFinite(value)).toBe(true);
			expect(value).toBeGreaterThan(0);
		}
	});
});

describe('resolveBaseDimensions', () => {
	it('applies overrides but ignores scale', () => {
		const scaledAndResized = item({ width: 240, scale: { x: 3, y: 3, z: 3 } });

		// The 3D viewer scales the Object3D itself; folding scale in here would double it.
		expect(resolveBaseDimensions(scaledAndResized, catalogDef)).toEqual({
			width: 240,
			depth: 60,
			height: 200
		});
	});

	it('matches resolveFurnitureDimensions when scale is 1', () => {
		const plain = item({ width: 240, depth: 65 });

		expect(resolveBaseDimensions(plain, catalogDef)).toEqual(
			resolveFurnitureDimensions(plain, catalogDef)
		);
	});

	it('falls back safely with no catalog entry', () => {
		expect(resolveBaseDimensions(item(), undefined)).toEqual(FALLBACK_FURNITURE_DIMENSIONS);
	});
});

describe('furnitureHalfExtents', () => {
	it('returns half the resolved footprint', () => {
		expect(furnitureHalfExtents(item({ width: 240, depth: 60 }), catalogDef)).toEqual({
			halfWidth: 120,
			halfDepth: 30
		});
	});

	it('reflects per-item overrides — the hit-testing regression', () => {
		// A 240 cm wardrobe from a 100 cm catalog default: the selectable half-width must be
		// 120, not 50. This is the exact bug HP-203 was raised for.
		expect(furnitureHalfExtents(item({ width: 240 }), catalogDef).halfWidth).toBe(120);
	});
});
