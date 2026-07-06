import { test, expect, vi, beforeEach, afterAll } from 'vitest';
import type { Insert } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(
	() =>
		({
			kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
			close: null as unknown as () => void
		} as {
			kit: import('@visorcraft/mongreldb-kit').KitDatabase;
			close: () => void;
		})
);
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

import {
	createPasswordResetToken,
	validatePasswordResetToken,
	consumePasswordResetToken
} from './passwordReset';
import { users, passwordResetTokens } from './db/mongrelSchema';
import { verifyPassword, createSession } from './auth';
import { sessions } from './db/mongrelSchema';

type UserInsert = {
	email?: string;
	password_hash?: string;
	display_name?: string;
	role?: 'admin' | 'user';
	disabled?: boolean;
	timezone?: string;
	flight_checkin_lead_hours?: bigint;
	document_expiry_lead_days?: bigint;
	email_notifications?: boolean;
	webhook_notifications?: boolean;
	theme_id?: string;
	default_currency?: string;
	calendar_token?: string | null;
	calendar_token_expires_at?: string | null;
};

function makeKitUser(over: UserInsert = {}) {
	const n = Math.random().toString(36).slice(2);
	const row = {
		email: over.email ?? `u${n}@x.c`,
		password_hash: over.password_hash ?? 'x',
		display_name: over.display_name ?? `U${n}`,
		role: over.role ?? 'user',
		disabled: over.disabled ?? false,
		timezone: over.timezone ?? 'UTC',
		flight_checkin_lead_hours: over.flight_checkin_lead_hours ?? 24n,
		document_expiry_lead_days: over.document_expiry_lead_days ?? 90n,
		email_notifications: over.email_notifications ?? true,
		webhook_notifications: over.webhook_notifications ?? true,
		theme_id: over.theme_id ?? 'system',
		default_currency: over.default_currency ?? 'USD',
		calendar_token: over.calendar_token ?? null,
		calendar_token_expires_at: over.calendar_token_expires_at ?? null
	};
	return ctx.kit.insertInto(users).values(row as Insert<typeof users>).executeSync();
}

function resetKitTables() {
	ctx.kit.deleteFrom(passwordResetTokens).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
}

beforeEach(() => {
	resetKitTables();
});

afterAll(() => {
	ctx.close();
});

test('raw token is not stored; validate returns row', () => {
	const u = makeKitUser({ email: 'a@b.c' });
	const token = createPasswordResetToken(Number(u.id));
	const row = ctx.kit.selectFrom(passwordResetTokens).executeSync()[0];
	expect(row!.token_hash).not.toBe(token);
	expect(validatePasswordResetToken(token)?.user_id).toBe(u.id);
});

test('expired token is rejected and removed', () => {
	const u = makeKitUser({ email: 'a@b.c' });
	const token = createPasswordResetToken(Number(u.id));
	ctx.kit.updateTable(passwordResetTokens).set({ expires_at: '2000-01-01T00:00:00.000Z' }).executeSync();
	expect(validatePasswordResetToken(token)).toBeNull();
	expect(ctx.kit.selectFrom(passwordResetTokens).executeSync()).toHaveLength(0);
});

test('consume updates password and deletes tokens', async () => {
	const u = makeKitUser({ email: 'a@b.c' });
	const token = createPasswordResetToken(Number(u.id));
	const ok = await consumePasswordResetToken(token, 'newpassword');
	expect(ok).toBe(true);
	const updated = ctx.kit.selectFrom(users).executeSync()[0];
	expect(await verifyPassword(updated!.password_hash, 'newpassword')).toBe(true);
	expect(ctx.kit.selectFrom(passwordResetTokens).executeSync()).toHaveLength(0);
});

test('consume rejects invalid token', async () => {
	const ok = await consumePasswordResetToken('not-a-token', 'newpassword');
	expect(ok).toBe(false);
});

test('consume invalidates existing sessions', async () => {
	const u = makeKitUser({ email: 'a@b.c' });
	createSession(Number(u.id));
	createSession(Number(u.id));
	expect(ctx.kit.selectFrom(sessions).executeSync()).toHaveLength(2);

	const token = createPasswordResetToken(Number(u.id));
	const ok = await consumePasswordResetToken(token, 'newpassword');
	expect(ok).toBe(true);
	expect(ctx.kit.selectFrom(sessions).executeSync()).toHaveLength(0);
});
