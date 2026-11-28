import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		// Compiler options live in project.inlang/paraglide.config.js (shared with `npm run i18n:compile`).
		paraglideVitePlugin({ project: './project.inlang' }),
		sveltekit({
			adapter: adapter(),
			preprocess: vitePreprocess(),
			// hooks.server.ts enforces CSRF except for OAuth token clients.
			csrf: { trustedOrigins: ['*'] },
			// Setting only 'script-src' enables SvelteKit's per-request script nonces on
			// rendered HTML; it does not add style nonces, which would disable
			// style-src 'unsafe-inline' needed by Tailwind and inline styles.
			csp: {
				mode: 'nonce',
				directives: {
					'script-src': ['self']
				}
			}
		})
	],
	resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	server: {
		watch: {
			ignored: ['test-results/**', 'data/**', 'build/**', 'roamarr-test-db/**']
		}
	},
	ssr: {
		external: [
			'@visorcraft/mongreldb',
			'@visorcraft/mongreldb-kit',
			'@huggingface/transformers',
			'onnxruntime-node'
		]
	},
	build: {
		// License data and map/globe libraries are legitimately large; raise the
		// warning threshold so the build output stays focused on real problems.
		chunkSizeWarningLimit: 1500,
		rollupOptions: {
			external: [
				'@visorcraft/mongreldb',
				'@visorcraft/mongreldb-kit',
				'@huggingface/transformers',
				'onnxruntime-node'
			],
			// Rolldown emits plugin-timing advisories by default; they're not warnings
			// and don't affect the build, so silence them to keep output focused.
			checks: { pluginTimings: false }
		} as any
	},
	test: {
		// Native database durability waits serialize across workers.
		maxWorkers: 4,
		setupFiles: ['./vitest.setup.ts'],
		testTimeout: 15_000,
		include: ['src/**/*.test.ts', 'src/**/(*.)+test.ts', 'scripts/**/*.test.mjs']
	}
});
