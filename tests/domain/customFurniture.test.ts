import { describe, it, expect } from 'vitest';
import {
	CUSTOM_FURNITURE_PREFIX,
	isCustomFurnitureId,
	makeCustomFurnitureDef,
	parseCustomFurnitureForm,
	toFurnitureDef
} from '$lib/domain/customFurniture';

/**
 * HP-504 / HP-505 — furniture defined by dimensions alone.
 *
 * The built-in catalog holds generic approximations. Planning a real house means the actual
 * wardrobe you own or are considering, which needs nothing more than a name and three numbers —
 * no 3D model, no product database.
 */

describe('parseCustomFurnitureForm', () => {
	const valid = { name: 'Hallway wardrobe', category: 'Bedroom', width: '240', depth: '60', height: '260' };

	it('accepts a complete form', () => {
		const result = parseCustomFurnitureForm(valid);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('expected success');
		expect(result.value).toMatchObject({
			name: 'Hallway wardrobe',
			category: 'Bedroom',
			width: 240,
			depth: 60,
			height: 260
		});
	});

	it('trims the name', () => {
		const result = parseCustomFurnitureForm({ ...valid, name: '  Desk  ' });

		if (!result.ok) throw new Error('expected success');
		expect(result.value.name).toBe('Desk');
	});

	it('accepts a comma decimal separator', () => {
		// Same reasoning as calibration: these are European plans and dimensions.
		const result = parseCustomFurnitureForm({ ...valid, width: '239,5' });

		if (!result.ok) throw new Error('expected success');
		expect(result.value.width).toBeCloseTo(239.5, 6);
	});

	it('rejects an empty name with a reason', () => {
		const result = parseCustomFurnitureForm({ ...valid, name: '   ' });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.errors.name).toBeTruthy();
	});

	it.each(['', '0', '-5', 'abc', 'NaN'])('rejects a width of %s', (width) => {
		const result = parseCustomFurnitureForm({ ...valid, width });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.errors.width).toBeTruthy();
	});

	it('reports every invalid field at once, not just the first', () => {
		const result = parseCustomFurnitureForm({ name: '', category: 'Bedroom', width: '0', depth: '-1', height: 'x' });

		if (result.ok) throw new Error('expected failure');
		// Fixing one field at a time is a miserable way to fill in a form.
		expect(Object.keys(result.errors).sort()).toEqual(['depth', 'height', 'name', 'width']);
	});

	it('rejects implausibly large dimensions', () => {
		// A typo like 24000 instead of 240 would otherwise create furniture the size of a street.
		const result = parseCustomFurnitureForm({ ...valid, width: '250000' });

		expect(result.ok).toBe(false);
	});

	it('defaults the category when none is given', () => {
		const result = parseCustomFurnitureForm({ ...valid, category: '' });

		if (!result.ok) throw new Error('expected success');
		expect(result.value.category).toBeTruthy();
	});
});

describe('makeCustomFurnitureDef', () => {
	const input = { name: 'Wardrobe', category: 'Bedroom', width: 240, depth: 60, height: 260 };

	it('assigns a prefixed id', () => {
		const def = makeCustomFurnitureDef(input);

		expect(def.id.startsWith(CUSTOM_FURNITURE_PREFIX)).toBe(true);
	});

	it('assigns distinct ids', () => {
		expect(makeCustomFurnitureDef(input).id).not.toBe(makeCustomFurnitureDef(input).id);
	});

	it('records when it was created', () => {
		const def = makeCustomFurnitureDef(input);

		expect(Number.isNaN(new Date(def.createdAt).getTime())).toBe(false);
	});

	it('carries the dimensions through', () => {
		const def = makeCustomFurnitureDef(input);

		expect([def.width, def.depth, def.height]).toEqual([240, 60, 260]);
	});

	it('gives a default colour when none is supplied', () => {
		expect(makeCustomFurnitureDef(input).color).toMatch(/^#[0-9a-f]{6}$/i);
	});

	it('keeps a supplied colour', () => {
		expect(makeCustomFurnitureDef({ ...input, color: '#123456' }).color).toBe('#123456');
	});
});

describe('isCustomFurnitureId', () => {
	it('recognises a custom id', () => {
		expect(isCustomFurnitureId(makeCustomFurnitureDef({ name: 'x', category: 'Bedroom', width: 1, depth: 1, height: 1 }).id)).toBe(true);
	});

	it('rejects a built-in catalog id', () => {
		expect(isCustomFurnitureId('bed_queen')).toBe(false);
		expect(isCustomFurnitureId('wardrobe')).toBe(false);
	});
});

describe('toFurnitureDef', () => {
	const def = makeCustomFurnitureDef({ name: 'Tall unit', category: 'Bedroom', width: 100, depth: 40, height: 220 });

	it('produces something the catalog lookup can return', () => {
		const entry = toFurnitureDef(def);

		expect(entry.id).toBe(def.id);
		expect(entry.name).toBe('Tall unit');
		expect(entry.width).toBe(100);
		expect(entry.depth).toBe(40);
		expect(entry.height).toBe(220);
		expect(entry.category).toBe('Bedroom');
	});

	it('marks it as a 2D symbol so the 3D viewer draws a box rather than hunting for a model', () => {
		// HP-504 explicitly allows a plain box to start with.
		expect(toFurnitureDef(def).symbol).toBeUndefined();
		expect(toFurnitureDef(def).icon).toBeTruthy();
	});
});
