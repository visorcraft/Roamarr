import { test as baseTest } from '@playwright/test';

export const test = baseTest.extend({
	storageState: 'tests/e2e/.auth/user.json'
});

export const testNoAuth = baseTest.extend({
	storageState: { cookies: [], origins: [] }
});

export { expect } from '@playwright/test';
