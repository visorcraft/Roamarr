import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import * as usersRepo from './repositories/usersRepo';
import { db } from './db';
import { users } from './db/schema';
import { hashPassword } from './auth';
import { nowIso } from './tz';

const th = (t: string) => createHash('sha256').update(t).digest('hex');
const TOKEN_TTL_MINUTES = 60;

export function createPasswordResetToken(userId: number) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = DateTime.utc().plus({ minutes: TOKEN_TTL_MINUTES }).toISO()!;
	usersRepo.createPasswordResetToken({
		token_hash: th(token),
		user_id: BigInt(userId),
		expires_at: expiresAt
	});
	return token;
}

export function validatePasswordResetToken(token: string) {
	const row = usersRepo.getPasswordResetByTokenHash(th(token));
	if (!row) return null;
	if (row.expires_at < nowIso()) {
		usersRepo.deletePasswordResetToken(Number(row.id));
		return null;
	}
	return row;
}

export async function consumePasswordResetToken(token: string, newPassword: string) {
	const row = validatePasswordResetToken(token);
	if (!row) return false;
	const userId = Number(row.user_id);
	const passwordHash = await hashPassword(newPassword);
	usersRepo.updateUser(userId, {
		password_hash: passwordHash,
		must_reset_password: false
	});
	// Keep legacy Drizzle users table in sync during transition.
	db.update(users).set({ passwordHash, mustResetPassword: false }).where(eq(users.id, userId)).run();
	usersRepo.deletePasswordResetTokensByUserId(userId);
	return true;
}
