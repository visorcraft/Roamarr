import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _registerUser as registerUser, actions } from './+page.server';
import { updateSettings } from '$lib/server/settings';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';

test('registers a normal user with normalized email and default leads; rejects dupes', async () => {
	updateSettings({
		setupComplete: true,
		allowRegistration: true,
		defaultTimezone: 'America/New_York',
		defaultFlightCheckinLeadHours: 48,
		defaultDocumentExpiryLeadDays: 60
	});
	const u = await registerUser('New@User.com', 'correcthorse', 'New');
	expect(u.role).toBe('user');
	expect(u.email).toBe('new@user.com');
	expect(u.timezone).toBe('America/New_York');
	expect(u.flightCheckinLeadHours).toBe(48);
	expect(u.documentExpiryLeadDays).toBe(60);
	await expect(registerUser('new@user.com', 'correcthorse', 'Dup')).rejects.toThrow();
});

test('register action returns 429 when rate limited', async () => {
	resetRateLimit();
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'register');
	const result = (await actions.default({
		request: { formData: async () => new Map() },
		getClientAddress: () => ip,
		cookies: { set: vi.fn() }
	} as any)) as { status: number; data: { error: string; retryAfter?: number } };
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});
