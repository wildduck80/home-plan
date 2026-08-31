import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit/integration test config.
 *
 * Deliberately does NOT load the `sveltekit()` plugin: the suites this project needs
 * most (geometry, room detection, schema migrations, persistence round-trips) are pure
 * TypeScript and must be runnable without a renderer or a SvelteKit server — see
 * technical guardrail 9 in PRD_openPlan3D_home_planner.md. The `$lib` alias is wired up
 * manually so those modules import exactly as they do in the app.
 */
export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
		coverage: {
			reporter: ['text', 'lcov'],
			include: ['src/lib/persistence/**', 'src/lib/domain/**', 'src/lib/utils/**']
		}
	}
});
