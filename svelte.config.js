import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// OAuth token clients submit application/x-www-form-urlencoded without an
		// Origin header. hooks.server.ts keeps the same-origin check everywhere
		// except the machine-to-machine token and revocation endpoints.
		csrf: { trustedOrigins: ['*'] }
	}
};

export default config;
