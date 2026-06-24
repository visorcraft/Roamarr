import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _authenticate as authenticate, actions } from './+page.server';
import { users } from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';

test('authenticate returns user on correct creds, null otherwise', async () => {
	(ctx as any).db
		.insert(users)
		.values({ email: 'a@b.c', passwordHash: await hashPassword('correcthorse'), displayName: 'A' })
		.run();
	expect((await authenticate('A@B.c', 'correcthorse'))?.email).toBe('a@b.c');
	expect(await authenticate('a@b.c', 'wrong')).toBeNull();
});

test('authenticate rejects disabled users', async () => {
	(ctx as any).db
		.insert(users)
		.values({
			email: 'disabled@b.c',
			passwordHash: await hashPassword('correcthorse'),
			displayName: 'D',
			disabled: true
		})
		.run();
	expect(await authenticate('disabled@b.c', 'correcthorse')).toBeNull();
});

test('login action returns 429 when rate limited', async () => {
	resetRateLimit();
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'login');
	const result = (await actions.default({
		request: { formData: async () => new Map() },
		getClientAddress: () => ip,
		cookies: { set: vi.fn() }
	} as any)) as { status: number; data: { error: string; retryAfter?: number } };
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});
