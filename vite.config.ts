import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		external: ['@visorcraft/mongreldb', '@visorcraft/mongreldb-kit']
	},
	build: {
		rollupOptions: {
			external: ['@visorcraft/mongreldb', '@visorcraft/mongreldb-kit']
		}
	},
	test: {
		setupFiles: ['./vitest.setup.ts'],
		include: ['src/**/*.test.ts', 'src/**/(*.)+test.ts']
	}
});
