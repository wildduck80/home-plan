/**
 * Canonical id generator for domain entities.
 *
 * Kept deliberately identical to the generator openPlan3D has always used, so ids in
 * existing saved projects and newly created ones stay indistinguishable in shape.
 */
export function uid(): string {
	return Math.random().toString(36).slice(2, 10);
}
