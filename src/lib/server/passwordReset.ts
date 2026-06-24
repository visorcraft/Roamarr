import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from './db';
import { users, passwordResetTokens } from './db/schema';
import { hashPassword } from './auth';

const th = (t: string) => createHash('sha256').update(t).digest('hex');
const TOKEN_TTL_MINUTES = 60;

export function createPasswordResetToken(userId: number) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = DateTime.utc().plus({ minutes: TOKEN_TTL_MINUTES }).toISO()!;
	db.insert(passwordResetTokens)
		.values({ tokenHash: th(token), userId, expiresAt })
		.run();
	return token;
}

export function validatePasswordResetToken(token: string) {
	const row = db
		.select()
		.from(passwordResetTokens)
		.where(eq(passwordResetTokens.tokenHash, th(token)))
		.get();
	if (!row) return null;
	if (row.expiresAt < DateTime.utc().toISO()!) {
		db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, row.id)).run();
		return null;
	}
	return row;
}

export async function consumePasswordResetToken(token: string, newPassword: string) {
	const row = validatePasswordResetToken(token);
	if (!row) return false;
	await db
		.update(users)
		.set({ passwordHash: await hashPassword(newPassword), mustResetPassword: false })
		.where(eq(users.id, row.userId))
		.run();
	db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.userId)).run();
	return true;
}
