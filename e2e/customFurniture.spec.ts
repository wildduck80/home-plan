import { test, expect, type Page } from '@playwright/test';
import { seedLegacyLocalStorage, waitForHydration } from './helpers/storage';
import { legacyProject } from './helpers/legacyProject';

/**
 * Custom furniture (HP-504 / HP-505).
 *
 * The point is modelling real pieces rather than the catalog's generic approximations, and having
 * them available in every project rather than re-created per plan.
 *
 * Note on reading stores from the page: bare specifiers like `svelte/store` are not resolvable in
 * the browser, so these helpers subscribe and immediately unsubscribe rather than using `get`.
 */

async function openEditor(page: Page): Promise<void> {
	await seedLegacyLocalStorage(page, [legacyProject()]);
	await page.goto('/editor?id=legacyproj');
	await waitForHydration(page);
	await expect(page.getByText('1 room')).toBeVisible();
	await page.getByRole('button', { name: /^OBJECTS$/i }).click();
}

async function createDefinition(
	page: Page,
	name: string,
	w: string,
	d: string,
	h: string
): Promise<void> {
	await page.getByRole('button', { name: '+ Add' }).click();
	await page.getByPlaceholder(/Hallway wardrobe/i).fill(name);
	await page.getByLabel('W (cm)').fill(w);
	await page.getByLabel('D (cm)').fill(d);
	await page.getByLabel('H (cm)').fill(h);
	await page.getByRole('button', { name: /Save and place/i }).click();
}

/** Definitions currently in the personal catalog. */
async function readDefinitions(
	page: Page
): Promise<{ id: string; name: string; width: number; depth: number; height: number; color: string }[]> {
	return page.evaluate(async () => {
		const mod = await import('/src/lib/services/customFurnitureStore.ts');
		return new Promise((resolve) => {
			const unsub = mod.customFurniture.subscribe((v: unknown) => resolve(v as never));
			unsub();
		});
	});
}

test.describe('creating custom furniture', () => {
	test('adds a definition from a name and three numbers', async ({ page }) => {
		await openEditor(page);

		await createDefinition(page, 'Hallway wardrobe', '240', '60', '260');

		await expect(page.getByText('Hallway wardrobe')).toBeVisible();
		const defs = await readDefinitions(page);
		expect(defs).toHaveLength(1);
		expect(defs[0]).toMatchObject({ name: 'Hallway wardrobe', width: 240, depth: 60, height: 260 });
	});

	test('shows its dimensions in the list', async ({ page }) => {
		await openEditor(page);
		await createDefinition(page, 'Desk', '140', '70', '75');

		await expect(page.getByText('140×70×75')).toBeVisible();
	});

	test('reports every invalid field at once', async ({ page }) => {
		await openEditor(page);
		await page.getByRole('button', { name: '+ Add' }).click();
		await page.getByLabel('W (cm)').fill('0');

		await page.getByRole('button', { name: /Save and place/i }).click();

		// Fixing one field per attempt would be a miserable form to complete.
		await expect(page.getByText(/Give it a name/i)).toBeVisible();
		await expect(page.getByText(/Enter a width/i)).toBeVisible();
		await expect(page.getByText(/Enter a depth/i)).toBeVisible();
	});

	test('rejects an implausible dimension', async ({ page }) => {
		await openEditor(page);
		await page.getByRole('button', { name: '+ Add' }).click();
		await page.getByPlaceholder(/Hallway wardrobe/i).fill('Typo');
		await page.getByLabel('W (cm)').fill('24000');
		await page.getByLabel('D (cm)').fill('60');
		await page.getByLabel('H (cm)').fill('200');

		await page.getByRole('button', { name: /Save and place/i }).click();

		// 24000 instead of 240 would otherwise create furniture the size of a street.
		await expect(page.getByText(/Enter a width/i)).toBeVisible();
		expect(await readDefinitions(page)).toEqual([]);
	});
});

test.describe('using custom furniture', () => {
	test('arms the new piece for placement immediately', async ({ page }) => {
		await openEditor(page);
		await createDefinition(page, 'Wardrobe', '240', '60', '260');

		// Arming happens after the definition is persisted, so poll rather than read once.
		const readArmed = () =>
			page.evaluate(async () => {
				const store = await import('/src/lib/stores/project.ts');
				return new Promise<string | null>((resolve) => {
					const unsub = store.placingFurnitureId.subscribe((v: unknown) => resolve(v as never));
					unsub();
				});
			});

		await expect.poll(readArmed, { timeout: 10_000 }).toMatch(/^custom:/);
	});

	test('resolves through the ordinary catalog lookup', async ({ page }) => {
		await openEditor(page);
		await createDefinition(page, 'Wardrobe', '240', '60', '260');
		const [def] = await readDefinitions(page);

		// Hit testing, collision, clearance and both renderers all go through getCatalogItem, so
		// resolving there is what makes custom furniture work everywhere without special cases.
		const resolved = await page.evaluate(async (id) => {
			const catalog = await import('/src/lib/utils/furnitureCatalog.ts');
			const entry = catalog.getCatalogItem(id);
			return entry ? { width: entry.width, depth: entry.depth } : null;
		}, def.id);

		expect(resolved).toEqual({ width: 240, depth: 60 });
	});

	test('survives a reload — it is not stored in the project', async ({ page }) => {
		await openEditor(page);
		await createDefinition(page, 'Persistent unit', '100', '50', '180');

		await page.reload();
		await waitForHydration(page);
		await page.getByRole('button', { name: /^OBJECTS$/i }).click();

		await expect(page.getByText('Persistent unit')).toBeVisible({ timeout: 15_000 });
	});

	test('deleting a definition leaves placed furniture at its size', async ({ page }) => {
		await openEditor(page);
		await createDefinition(page, 'Doomed unit', '240', '60', '260');
		const [def] = await readDefinitions(page);

		await page.evaluate(
			async (d) => {
				const store = await import('/src/lib/stores/project.ts');
				store.addFurniture(d.id, { x: 200, y: 150 }, {
					width: d.width,
					depth: d.depth,
					height: d.height,
					color: d.color
				});
			},
			def
		);

		await page.getByRole('button', { name: /^Delete Doomed unit$/ }).click();

		// HP-505: the placement keeps its snapshotted size rather than falling back to a default.
		const size = await page.evaluate(async () => {
			const store = await import('/src/lib/stores/project.ts');
			const floor = await new Promise<{ furniture: { width?: number; depth?: number }[] }>(
				(resolve) => {
					const unsub = store.activeFloor.subscribe((v: unknown) => resolve(v as never));
					unsub();
				}
			);
			const item = floor.furniture[floor.furniture.length - 1];
			return { width: item.width, depth: item.depth };
		});

		expect(size).toEqual({ width: 240, depth: 60 });
	});
});
