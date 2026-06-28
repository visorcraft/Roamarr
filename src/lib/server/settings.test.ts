import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { getSettings, updateSettings, isSetupComplete } from './settings';

test('defaults then update', () => {
	expect(isSetupComplete()).toBe(false);
	updateSettings({ instanceName: 'Trips', allowRegistration: true });
	expect(getSettings().instanceName).toBe('Trips');
	expect(getSettings().allowRegistration).toBe(true);
});
