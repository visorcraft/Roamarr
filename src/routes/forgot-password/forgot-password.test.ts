import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
const delivered = vi.hoisted(() => [] as Array<{ uid: number; m: any }>);
vi.mock('$lib/server/notify', () => ({
	deliver: async (uid: number, m: any) => delivered.push({ uid, m })
}));

import { _requestReset, actions } from './+page.server';
import { users, passwordResetTokens } from '$lib/server/db/mongrelSchema';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';
import { makeKitUser } from '../../../tests/kitHelpers';

function kitDb(): import('@visorcraft/mongreldb-kit').KitDatabase {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

const origin = 'https://example.com';

beforeEach(() => {
	const kit = kitDb();
	// Cascading delete on kit users removes sessions and reset tokens too.
	kit.deleteFrom(passwordResetTokens).executeSync();
	kit.deleteFrom(users).executeSync();
	delivered.length = 0;
});

test('sends reset email for existing active user', async () => {
	const kit = kitDb();
	const u = makeKitUser({ email: 'a@b.c', password_hash: 'x', display_name: 'A' });
	await _requestReset('A@B.c', origin);
	const row = kit.selectFrom(passwordResetTokens).executeSync()[0];
	expect(row.user_id).toBe(u.id);
	expect(delivered).toHaveLength(1);
	expect(delivered[0].uid).toBe(Number(u.id));
	expect(delivered[0].m.link).toMatch(new RegExp(`^${origin}/reset-password/`));
});

test('does not send email for unknown or disabled user', async () => {
	const kit = kitDb();
	makeKitUser({ email: 'd@b.c', password_hash: 'x', display_name: 'D', disabled: true });
	await _requestReset('unknown@b.c', origin);
	await _requestReset('d@b.c', origin);
	expect(kit.selectFrom(users).executeSync()[0]).toBeDefined();
	expect(kit.selectFrom(passwordResetTokens).executeSync()).toHaveLength(0);
	expect(delivered).toHaveLength(0);
});

test('action always returns success even for unknown email', async () => {
	const result = await actions.default({
		request: { formData: async () => new Map([['email', 'noone@b.c']]) },
		url: new URL('https://example.com/forgot-password'),
		getClientAddress: () => '1.1.1.1'
	} as any);
	expect(result).toEqual({ success: true });
});

test('action returns 429 when rate limited', async () => {
	resetRateLimit();
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'forgot-password');
	const result = (await actions.default({
		request: { formData: async () => new Map() },
		url: new URL('https://example.com/forgot-password'),
		getClientAddress: () => ip
	} as any)) as { status: number; data: { error: string; retryAfter?: number } };
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});
