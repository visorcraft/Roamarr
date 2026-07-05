import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _createAdmin as createAdmin, actions, load } from './+page.server';
import { users } from '$lib/server/db/mongrelSchema';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';

test('creates exactly one admin; second attempt rejected', () => {
	createAdmin({
		email: 'Admin@X.com ',
		password: 'correcthorse',
		displayName: 'Admin',
		instanceName: 'R',
		timezone: 'UTC'
	});
	const all = (ctx as any).kit.selectFrom(users).executeSync();
	expect(all.length).toBe(1);
	expect(all[0].role).toBe('admin');
	expect(all[0].email).toBe('admin@x.com');
	expect(Number(all[0].flight_checkin_lead_hours)).toBe(24);
	expect(Number(all[0].document_expiry_lead_days)).toBe(90);
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
		cookies: { set: vi.fn() },
		locals: {}
	} as any)) as { status: number; data: { error: string; retryAfter?: number } };
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});

test('setup load exposes missing-secret flag and db check', async () => {
	const ok = await (load as any)({ locals: {} });
	expect(ok.missingSecret).toBe(false);
	expect(ok.setupCheck.secretPresent).toBe(true);
	expect(ok.setupCheck.writable).toBe(true);

	const missing = await (load as any)({ locals: { missingSecret: true } });
	expect(missing.missingSecret).toBe(true);
	expect(missing.setupCheck.secretPresent).toBe(true);
});

test('setup action rejects when ROAMARR_SECRET is missing', async () => {
	const result = (await actions.default({
		request: { formData: async () => new Map() },
		getClientAddress: () => '1.2.3.4',
		cookies: { set: vi.fn() },
		locals: { missingSecret: true }
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/ROAMARR_SECRET/);
});
