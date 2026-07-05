import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.ROAMARR_E2E_URL || 'http://127.0.0.1:3002';

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'setup',
			testMatch: /auth\.setup\.ts/
		},
		{
			name: 'e2e',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'tests/e2e/.auth/user.json'
			}
		}
	]
});
