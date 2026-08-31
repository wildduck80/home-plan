import * as THREE from 'three';

/**
 * Three.js resource disposal (HP-005).
 *
 * ## Why this exists
 *
 * Three.js does not free GPU resources when an object leaves the scene graph — each geometry,
 * material and **texture** must be disposed explicitly. The trap is that
 * `material.dispose()` does *not* dispose the textures assigned to that material, so code that
 * looks like it cleans up thoroughly still leaks every texture it created.
 *
 * That was measured in this project: rebuilding the scene leaked ~12.5 textures per rebuild,
 * growing linearly and without bound (32 → 182 → 332 over 24 rebuilds) while geometry counts
 * stayed flat. Since the 3D scene rebuilds on *every* project mutation, dragging a wall for a
 * few seconds was enough to leak hundreds of GPU textures.
 *
 * ## The pattern
 *
 * Anything that removes objects from a scene must route through `clearGroup` or
 * `disposeObject3D`. Anything that tears down a renderer must use `disposeRenderer`, which
 * releases the WebGL context — `renderer.dispose()` alone does not, and browsers only allow
 * ~16 live contexts before the 3D view stops working entirely.
 */

/** Every texture-valued property on a material, whatever its name. */
function disposeMaterialTextures(material: THREE.Material): void {
	// Iterating properties rather than listing `map`, `normalMap`, … keeps this correct when a
	// material type carries a map this code has never heard of.
	for (const value of Object.values(material as unknown as Record<string, unknown>)) {
		if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) {
			(value as THREE.Texture).dispose();
		}
	}
}

/** Dispose a material and every texture it references. */
export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
	const materials = Array.isArray(material) ? material : [material];
	for (const entry of materials) {
		if (!entry) continue;
		disposeMaterialTextures(entry);
		entry.dispose();
	}
}

/**
 * Dispose every geometry, material and texture under `object`, inclusive.
 *
 * Does not detach `object` from its parent — callers that need that should use `clearGroup`.
 */
export function disposeObject3D(object: THREE.Object3D): void {
	object.traverse((child) => {
		const mesh = child as THREE.Mesh;
		if (mesh.geometry) mesh.geometry.dispose();
		if (mesh.material) disposeMaterial(mesh.material);
	});
}

/** Remove and fully dispose every child of `group`, leaving it empty and reusable. */
export function clearGroup(group: THREE.Object3D): void {
	for (let i = group.children.length - 1; i >= 0; i--) {
		const child = group.children[i];
		disposeObject3D(child);
		group.remove(child);
	}
}

/**
 * Fully tear down a scene: dispose all descendants, plus the scene's own background and
 * environment textures, which are not part of the object graph and so are missed by traversal.
 */
export function disposeScene(scene: THREE.Scene): void {
	clearGroup(scene);

	if (scene.background && (scene.background as THREE.Texture).isTexture) {
		(scene.background as THREE.Texture).dispose();
	}
	if (scene.environment) scene.environment.dispose();

	scene.background = null;
	scene.environment = null;
}

/**
 * Release a renderer and its WebGL context.
 *
 * `renderer.dispose()` frees Three's own caches but leaves the WebGL context alive, and a
 * browser permits only a limited number (commonly ~16) before it starts refusing or
 * force-losing them. A component that creates a renderer on every mount therefore breaks the
 * 3D view after enough mount cycles unless the context is explicitly released, which is what
 * `forceContextLoss()` does.
 *
 * Detaching the canvas lets it be collected rather than pinned by the DOM.
 */
export function disposeRenderer(renderer: THREE.WebGLRenderer): void {
	const canvas = renderer.domElement;

	renderer.dispose();

	try {
		renderer.forceContextLoss();
	} catch {
		// Already lost, or the platform refuses — nothing further to do, and this must never
		// throw out of a component teardown.
	}

	canvas.parentNode?.removeChild(canvas);
}
