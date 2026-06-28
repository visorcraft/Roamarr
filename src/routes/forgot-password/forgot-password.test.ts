import { test, expect, vi, beforeEach } from 'vitest';
import { eq } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
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
import { users as kitUsers, passwordResetTokens } from '$lib/server/db/mongrelSchema';
import { users } from '$lib/server/db/schema';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';
import { makeKitUser } from '../../../tests/kitHelpers';

const origin = 'https://example.com';

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from password_reset_tokens; delete from users;'
	);
	// Cascading delete on kit users removes sessions and reset tokens too.
	(ctx as any).kit.deleteFrom(kitUsers).executeSync();
	delivered.length = 0;
});

test('sends reset email for existing active user', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeKitUser({ email: 'a@b.c', password_hash: 'x', display_name: 'A' });
	await _requestReset('A@B.c', origin);
	const row = (ctx as any).kit.selectFrom(passwordResetTokens).executeSync()[0];
	expect(row.user_id).toBe(u.id);
	expect(delivered).toHaveLength(1);
	expect(delivered[0].uid).toBe(Number(u.id));
	expect(delivered[0].m.link).toMatch(new RegExp(`^${origin}/reset-password/`));
});

test('does not send email for unknown or disabled user', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	makeKitUser({ email: 'd@b.c', password_hash: 'x', display_name: 'D', disabled: true });
	await _requestReset('unknown@b.c', origin);
	await _requestReset('d@b.c', origin);
	expect(db.select().from(users).get()).toBeDefined();
	expect((ctx as any).kit.selectFrom(passwordResetTokens).executeSync()).toHaveLength(0);
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
