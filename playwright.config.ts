import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config.
 *
 * Specs live in `e2e/` with a `.spec.ts` suffix, deliberately outside the `tests/**` +
 * `*.test.ts` patterns Vitest matches, so `npm test` and `npm run test:e2e` never collect
 * each other's files.
 *
 * Playwright starts its own dev server on a dedicated port so it cannot collide with a
 * dev server the developer already has running on the default 5173.
 */

const PORT = 5178;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.spec.ts',

	// Storage tests assert on a single shared origin's IndexedDB, and Playwright gives each
	// test a fresh context anyway — but serial execution keeps failures readable and avoids
	// competing dev-server compiles on a cold start.
	fullyParallel: false,
	workers: 1,

	// A flake here would mean the storage assertions cannot be trusted, so surface it rather
	// than paper over it locally. CI retries once to absorb genuine infrastructure noise.
	retries: process.env.CI ? 1 : 0,
	forbidOnly: !!process.env.CI,

	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],

	webServer: {
		command: `npm run dev -- --port ${PORT} --strictPort`,
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		// A cold Vite start plus first compile is slow on CI.
		timeout: 120_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
