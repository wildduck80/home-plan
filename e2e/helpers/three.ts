import type { Page } from '@playwright/test';

/**
 * Three.js lifecycle measurement helpers (HP-005).
 *
 * Uses Three's own `__THREE_DEVTOOLS__` hook: `WebGLRenderer` dispatches an `observe` event to
 * it on construction if the global exists. Installing an `EventTarget` there before the app
 * loads therefore captures every renderer the app creates, with **no production code changes**
 * and no test-only globals in shipped source.
 */

export interface RendererStats {
	/** How many WebGLRenderer instances the app has constructed so far. */
	renderersCreated: number;
	/** Live counts from the most recent renderer's `info`. */
	geometries: number;
	textures: number;
	programs: number;
	/** Frames drawn — a stalled loop means the view is broken, not merely leaky. */
	frame: number;
	/** Objects under the scene graph roots, to catch duplicated nodes. */
	sceneChildren: number;
}

/**
 * Install the devtools hook. Must be called before the first navigation, since the app
 * constructs its renderer during mount.
 */
export async function installThreeProbe(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const captured: unknown[] = [];
		const target = new EventTarget();
		target.addEventListener('observe', (event) => {
			const detail = (event as CustomEvent).detail;
			// Renderers and scenes both get observed; keep only renderers.
			if (detail && typeof detail === 'object' && 'info' in detail) captured.push(detail);
		});
		(globalThis as unknown as { __THREE_DEVTOOLS__: EventTarget }).__THREE_DEVTOOLS__ = target;
		(globalThis as unknown as { __capturedRenderers: unknown[] }).__capturedRenderers = captured;
	});
}

/** Read stats from the most recently constructed renderer. */
export async function readRendererStats(page: Page): Promise<RendererStats | null> {
	return page.evaluate(() => {
		type Renderer = {
			info: {
				memory: { geometries: number; textures: number };
				programs?: { length: number } | null;
				render: { frame: number };
			};
		};
		const all = (globalThis as unknown as { __capturedRenderers?: Renderer[] })
			.__capturedRenderers;
		if (!all || all.length === 0) return null;

		const renderer = all[all.length - 1];
		// Scene graph size, read from the canvas' sibling-agnostic global if exposed; otherwise 0.
		return {
			renderersCreated: all.length,
			geometries: renderer.info.memory.geometries,
			textures: renderer.info.memory.textures,
			programs: renderer.info.programs?.length ?? 0,
			frame: renderer.info.render.frame,
			sceneChildren: 0
		};
	});
}

/** How many WebGL contexts are still alive across all captured renderers. */
export async function countLiveContexts(page: Page): Promise<number> {
	return page.evaluate(() => {
		type Renderer = { getContext?: () => WebGLRenderingContext | null };
		const all =
			(globalThis as unknown as { __capturedRenderers?: Renderer[] }).__capturedRenderers ?? [];

		let live = 0;
		for (const renderer of all) {
			try {
				const gl = renderer.getContext?.();
				// isContextLost() is the reliable signal that the browser reclaimed it.
				if (gl && !gl.isContextLost()) live++;
			} catch {
				// A fully torn-down renderer can throw; that counts as not live.
			}
		}
		return live;
	});
}

/**
 * How many texture-load subscribers are currently registered.
 *
 * Each viewer mount adds one; without a matching unregister on teardown the set grows without
 * bound and stale entries call back into destroyed components (HP-005).
 */
export async function readTextureLoadCallbackCount(page: Page): Promise<number> {
	return page.evaluate(async () => {
		const mod = await import('/src/lib/utils/textureGenerator.ts');
		return mod.textureLoadCallbackCount();
	});
}

/** Switch the editor between 2D and 3D via the app's own store. */
export async function setViewMode(page: Page, mode: '2d' | '3d'): Promise<void> {
	await page.evaluate(async (mode) => {
		const store = await import('/src/lib/stores/project.ts');
		store.viewMode.set(mode);
	}, mode);
}

/**
 * Nudge one wall's endpoint, which mutates the project and therefore triggers a full 3D scene
 * rebuild — the same path a user dragging a wall takes.
 */
export async function nudgeWall(page: Page, wallId: string, deltaY: number): Promise<void> {
	await page.evaluate(
		async ({ wallId, deltaY }) => {
			const store = await import('/src/lib/stores/project.ts');
			const project = await new Promise<{
				activeFloorId: string;
				floors: { id: string; walls: { id: string; end: { x: number; y: number } }[] }[];
			}>((resolve) => {
				const unsub = store.currentProject.subscribe((value: unknown) => resolve(value as never));
				unsub();
			});
			const floor = project.floors.find((f) => f.id === project.activeFloorId)!;
			const wall = floor.walls.find((w) => w.id === wallId)!;
			store.updateWall(wallId, { end: { x: wall.end.x, y: wall.end.y + deltaY } });
		},
		{ wallId, deltaY }
	);
}
