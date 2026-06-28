import { eq as kitEq, and, ne, lt } from '@mongreldb/kit';
import { eq as drizzleEq } from 'drizzle-orm';
import { db, kit } from '$lib/server/db';
import { users, sessions, passwordResetTokens } from '$lib/server/db/mongrelSchema';
import { users as drizzleUsers } from '$lib/server/db/schema';
import type { Row, Insert, Update } from '@mongreldb/kit';

export type KitUser = Row<typeof users>;
export type KitSession = Row<typeof sessions>;
export type KitPasswordResetToken = Row<typeof passwordResetTokens>;

export type CreateUserInput = Omit<Insert<typeof users>, 'id' | 'created_at'>;
export type UpdateUserInput = Update<typeof users>;
export type CreateSessionInput = Omit<Insert<typeof sessions>, 'id' | 'created_at'>;
export type CreatePasswordResetTokenInput = Omit<Insert<typeof passwordResetTokens>, 'id' | 'created_at'>;

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function kitUserToDrizzleRow(row: KitUser): typeof drizzleUsers.$inferInsert {
	return {
		id: Number(row.id),
		email: row.email,
		passwordHash: row.password_hash,
		displayName: row.display_name,
		role: row.role as 'admin' | 'user',
		disabled: row.disabled,
		mustResetPassword: row.must_reset_password,
		timezone: row.timezone,
		flightCheckinLeadHours: Number(row.flight_checkin_lead_hours),
		documentExpiryLeadDays: Number(row.document_expiry_lead_days),
		emailNotifications: row.email_notifications,
		webhookNotifications: row.webhook_notifications,
		themeId: row.theme_id,
		defaultCurrency: row.default_currency,
		calendarToken: row.calendar_token,
		calendarTokenExpiresAt: row.calendar_token_expires_at,
		createdAt: row.created_at
	};
}

export function getUserByEmail(email: string): KitUser | null {
	const rows = kit.selectFrom(users).where(kitEq(users.email, email)).executeSync();
	return rows[0] ?? null;
}

export function getUserById(id: number): KitUser | null {
	const rows = kit.selectFrom(users).where(kitEq(users.id, toBigInt(id))).executeSync();
	return rows[0] ?? null;
}

export function createUser(input: CreateUserInput): KitUser {
	const created = kit.insertInto(users).values(input as Insert<typeof users>).executeSync();
	// Keep the legacy Drizzle users table in sync during transition so that
	// not-yet-migrated code can still read user rows. When callers already
	// inserted the Drizzle row (e.g. setup/register routes), skip the duplicate.
	db.insert(drizzleUsers)
		.values(kitUserToDrizzleRow(created))
		.onConflictDoNothing({ target: drizzleUsers.id })
		.run();
	return created;
}

export function updateUser(id: number, patch: UpdateUserInput): KitUser | null {
	const updated = kit
		.updateTable(users)
		.set(patch)
		.where(kitEq(users.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (row) {
		db.update(drizzleUsers)
			.set(kitUserToDrizzleRow(row))
			.where(drizzleEq(drizzleUsers.id, Number(row.id)))
			.run();
	}
	return row ?? null;
}

export function deleteUser(id: number): bigint {
	const deleted = kit.deleteFrom(users).where(kitEq(users.id, toBigInt(id))).executeSync();
	db.delete(drizzleUsers).where(drizzleEq(drizzleUsers.id, id)).run();
	return deleted;
}

export function getSessionByTokenHash(tokenHash: string): KitSession | null {
	const rows = kit.selectFrom(sessions).where(kitEq(sessions.token_hash, tokenHash)).executeSync();
	return rows[0] ?? null;
}

export function createSession(input: CreateSessionInput): KitSession {
	return kit.insertInto(sessions).values(input as Insert<typeof sessions>).executeSync();
}

export function updateSessionByTokenHash(
	tokenHash: string,
	patch: Update<typeof sessions>
): KitSession | null {
	const updated = kit
		.updateTable(sessions)
		.set(patch)
		.where(kitEq(sessions.token_hash, tokenHash))
		.executeSync();
	return updated[0] ?? null;
}

export function deleteSession(id: number): bigint {
	return kit.deleteFrom(sessions).where(kitEq(sessions.id, toBigInt(id))).executeSync();
}

export function deleteSessionByTokenHash(tokenHash: string): bigint {
	return kit.deleteFrom(sessions).where(kitEq(sessions.token_hash, tokenHash)).executeSync();
}

export function deleteExpiredSessions(now: string): bigint {
	return kit.deleteFrom(sessions).where(lt(sessions.expires_at, now)).executeSync();
}

export function deleteSessionsByUserId(userId: number): bigint {
	return kit.deleteFrom(sessions).where(kitEq(sessions.user_id, toBigInt(userId))).executeSync();
}

export function deleteSessionsByUserIdExceptTokenHash(userId: number, tokenHash: string): bigint {
	return kit
		.deleteFrom(sessions)
		.where(and(kitEq(sessions.user_id, toBigInt(userId)), ne(sessions.token_hash, tokenHash)))
		.executeSync();
}

export function getPasswordResetByTokenHash(tokenHash: string): KitPasswordResetToken | null {
	const rows = kit
		.selectFrom(passwordResetTokens)
		.where(kitEq(passwordResetTokens.token_hash, tokenHash))
		.executeSync();
	return rows[0] ?? null;
}

export function createPasswordResetToken(input: CreatePasswordResetTokenInput): KitPasswordResetToken {
	return kit.insertInto(passwordResetTokens).values(input as Insert<typeof passwordResetTokens>).executeSync();
}

export function deletePasswordResetToken(id: number): bigint {
	return kit
		.deleteFrom(passwordResetTokens)
		.where(kitEq(passwordResetTokens.id, toBigInt(id)))
		.executeSync();
}

export function deletePasswordResetTokensByUserId(userId: number): bigint {
	return kit
		.deleteFrom(passwordResetTokens)
		.where(kitEq(passwordResetTokens.user_id, toBigInt(userId)))
		.executeSync();
}
