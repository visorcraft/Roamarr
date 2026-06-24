import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _createAdmin as createAdmin, actions } from './+page.server';
import { users } from '$lib/server/db/schema';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';

test('creates exactly one admin; second attempt rejected', () => {
	createAdmin({
		email: 'Admin@X.com ',
		password: 'correcthorse',
		displayName: 'Admin',
		instanceName: 'R',
		timezone: 'UTC'
	});
	const all = (ctx as any).db.select().from(users).all();
	expect(all.length).toBe(1);
	expect(all[0].role).toBe('admin');
	expect(all[0].email).toBe('admin@x.com');
	expect(all[0].flightCheckinLeadHours).toBe(24);
	expect(all[0].documentExpiryLeadDays).toBe(90);
	expect(() =>
		createAdmin({
			email: 'b@x.com',
			password: 'correcthorse',
			displayName: 'B',
			instanceName: 'R',
			timezone: 'UTC'
		})
	).toThrow(/already/i);
});

test('setup action returns 429 when rate limited', async () => {
	resetRateLimit();
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'setup');
	const result = (await actions.default({
		request: { formData: async () => new Map() },
		getClientAddress: () => ip,
		cookies: { set: vi.fn() }
	} as any)) as { status: number; data: { error: string; retryAfter?: number } };
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});
