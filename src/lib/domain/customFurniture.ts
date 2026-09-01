import type { FurnitureDef } from '$lib/utils/furnitureCatalog';
import { uid } from './ids';

/**
 * Furniture defined by dimensions alone (HP-504 / HP-505).
 *
 * The built-in catalog holds generic approximations — "Wardrobe, 120x60". Planning a real house
 * means the actual wardrobe you own or are considering, and that needs nothing more than a name
 * and three numbers. No 3D model, no product database: HP-504 explicitly allows a plain box.
 *
 * Definitions live outside any project (see `services/customFurnitureStore`), so deleting one
 * project cannot destroy furniture used in another.
 */

/** Marks an id as a user definition rather than a built-in catalog entry. */
export const CUSTOM_FURNITURE_PREFIX = 'custom:';

/** Largest dimension accepted, in cm. A typo of 24000 for 240 would otherwise be accepted. */
const MAX_DIMENSION_CM = 2000;
const DEFAULT_CATEGORY = 'Custom';
const DEFAULT_COLOR = '#64748b';
const DEFAULT_ICON = '📦';

export interface CustomFurnitureDef {
	id: string;
	name: string;
	category: string;
	/** Centimetres. */
	width: number;
	depth: number;
	height: number;
	color: string;
	/** ISO timestamp. */
	createdAt: string;
}

export interface CustomFurnitureInput {
	name: string;
	category: string;
	width: number;
	depth: number;
	height: number;
	color?: string;
}

export interface CustomFurnitureForm {
	name: string;
	category: string;
	width: string;
	depth: string;
	height: string;
	color?: string;
}

export type FormErrors = Partial<Record<'name' | 'category' | 'width' | 'depth' | 'height', string>>;

export type ParseResult =
	| { ok: true; value: CustomFurnitureInput }
	| { ok: false; errors: FormErrors };

/** Parse a dimension, accepting a comma decimal separator as European notation. */
function parseDimension(raw: string): number | null {
	const text = raw.trim().replace(',', '.');
	if (text === '') return null;

	const value = Number(text);
	if (!Number.isFinite(value) || value <= 0 || value > MAX_DIMENSION_CM) return null;

	return value;
}

/**
 * Validate a form, reporting **every** invalid field rather than the first.
 *
 * Fixing one field at a time is a miserable way to fill in a form, and this one has four.
 */
export function parseCustomFurnitureForm(form: CustomFurnitureForm): ParseResult {
	const errors: FormErrors = {};

	const name = form.name.trim();
	if (name === '') errors.name = 'Give it a name so you can find it again.';

	const dimensions: Record<'width' | 'depth' | 'height', number> = { width: 0, depth: 0, height: 0 };
	for (const field of ['width', 'depth', 'height'] as const) {
		const value = parseDimension(form[field]);
		if (value === null) {
			errors[field] = `Enter a ${field} in cm, between 1 and ${MAX_DIMENSION_CM}.`;
		} else {
			dimensions[field] = value;
		}
	}

	if (Object.keys(errors).length > 0) return { ok: false, errors };

	return {
		ok: true,
		value: {
			name,
			// An empty category is not worth rejecting the form over.
			category: form.category.trim() || DEFAULT_CATEGORY,
			...dimensions,
			...(form.color ? { color: form.color } : {})
		}
	};
}

/** Create a definition from validated input. */
export function makeCustomFurnitureDef(input: CustomFurnitureInput): CustomFurnitureDef {
	return {
		id: `${CUSTOM_FURNITURE_PREFIX}${uid()}`,
		name: input.name,
		category: input.category,
		width: input.width,
		depth: input.depth,
		height: input.height,
		color: input.color ?? DEFAULT_COLOR,
		createdAt: new Date().toISOString()
	};
}

export function isCustomFurnitureId(catalogId: string): boolean {
	return catalogId.startsWith(CUSTOM_FURNITURE_PREFIX);
}

/**
 * Present a definition in the shape the catalog returns.
 *
 * Keeping one shape means hit testing, collision, clearance, the 2D renderer and the 3D viewer
 * all handle custom furniture without knowing it exists.
 */
export function toFurnitureDef(def: CustomFurnitureDef): FurnitureDef {
	return {
		id: def.id,
		name: def.name,
		category: def.category,
		icon: DEFAULT_ICON,
		color: def.color,
		width: def.width,
		depth: def.depth,
		height: def.height
	};
}
