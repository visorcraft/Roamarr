import { test, expect, vi } from 'vitest';

vi.mock('./reminders', () => ({ runDueReminders: vi.fn(async () => {}) }));
vi.mock('./fareproviders', () => ({ runFareChecks: vi.fn(async () => {}) }));
vi.mock('./auth', () => ({ purgeExpiredSessions: vi.fn() }));

import { startScheduler } from './scheduler';

test('starts only once', () => {
	const spy = vi.spyOn(globalThis, 'setInterval');
	startScheduler();
	startScheduler();
	expect(spy).toHaveBeenCalledTimes(1);
	spy.mockRestore();
});
