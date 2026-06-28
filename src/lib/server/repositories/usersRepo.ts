import { eq as kitEq, and, ne, lt, asc } from '@mongreldb/kit';
import { kit } from '$lib/server/db';
import { users, sessions, passwordResetTokens } from '$lib/server/db/mongrelSchema';
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

export function getUserByEmail(email: string): KitUser | null {
	const rows = kit.selectFrom(users).where(kitEq(users.email, email)).executeSync();
	return rows[0] ?? null;
}

export function getUserByCalendarToken(token: string): KitUser | null {
	const rows = kit.selectFrom(users).where(kitEq(users.calendar_token, token)).executeSync();
	return rows[0] ?? null;
}

export function listAllUsers(): KitUser[] {
	return kit.selectFrom(users).orderBy(asc(users.email)).executeSync();
}

export function getUserById(id: number): KitUser | null {
	const rows = kit.selectFrom(users).where(kitEq(users.id, toBigInt(id))).executeSync();
	return rows[0] ?? null;
}

export function createUser(input: CreateUserInput): KitUser {
	return kit.insertInto(users).values(input as Insert<typeof users>).executeSync();
}

export function updateUser(id: number, patch: UpdateUserInput): KitUser | null {
	const updated = kit
		.updateTable(users)
		.set(patch)
		.where(kitEq(users.id, toBigInt(id)))
		.executeSync();
	return updated[0] ?? null;
}

export function deleteUser(id: number): bigint {
	return kit.deleteFrom(users).where(kitEq(users.id, toBigInt(id))).executeSync();
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

export function listSessionsForUser(userId: number): KitSession[] {
	return kit
		.selectFrom(sessions)
		.where(kitEq(sessions.user_id, toBigInt(userId)))
		.orderBy(asc(sessions.created_at))
		.executeSync();
}

export function deleteSessionByIdAndUserId(id: number, userId: number): bigint {
	return kit
		.deleteFrom(sessions)
		.where(and(kitEq(sessions.id, toBigInt(id)), kitEq(sessions.user_id, toBigInt(userId))))
		.executeSync();
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
