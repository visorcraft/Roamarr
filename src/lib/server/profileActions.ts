import { hashPassword, invalidateOtherSessions, verifyPassword } from './auth';
import { requireOwnedUser } from './ownership';
import * as usersRepo from './repositories/usersRepo';
import { logAudit } from './audit';
import { normalizeEmail } from './users';
import { randomBytes } from 'node:crypto';
import { isThemeId } from '$lib/themes';

export function _updateTheme(userId: number, themeId: string) {
	requireOwnedUser(userId);
	if (!isThemeId(themeId)) throw new Error('Invalid theme');
	usersRepo.updateUser(userId, { theme_id: themeId });
	logAudit(userId, 'theme_change', 'user', userId, { themeId });
}

export async function _updatePassword(
	userId: number,
	currentToken: string,
	i: { oldPassword: string; newPassword: string; confirmPassword: string }
) {
	const u = requireOwnedUser(userId);
	if (!(await verifyPassword(u.password_hash, i.oldPassword)))
		throw new Error('Current password is incorrect');
	if (i.newPassword !== i.confirmPassword) throw new Error('New passwords do not match');
	usersRepo.updateUser(userId, { password_hash: await hashPassword(i.newPassword) });
	invalidateOtherSessions(userId, currentToken);
	logAudit(userId, 'password_change', 'user', userId);
}

export async function _changeEmail(
	userId: number,
	i: { currentPassword: string; newEmail: string; confirmEmail?: string }
) {
	const u = requireOwnedUser(userId);
	if (!(await verifyPassword(u.password_hash, i.currentPassword)))
		throw new Error('Current password is incorrect');

	const email = normalizeEmail(i.newEmail);
	if (!email || !email.includes('@')) throw new Error('A valid email is required.');

	if (i.confirmEmail !== undefined && email !== normalizeEmail(i.confirmEmail)) {
		throw new Error('Email addresses do not match.');
	}

	const duplicate = usersRepo.getUserByEmail(email);
	if (duplicate && Number(duplicate.id) !== userId) throw new Error('That email is already in use.');

	const oldEmail = u.email;
	usersRepo.updateUser(userId, { email });
	logAudit(userId, 'email_change', 'user', userId, { oldEmail });
}

export function _regenerateUserCalendarToken(userId: number, expiresAt?: string | null) {
	requireOwnedUser(userId);
	const token = randomBytes(24).toString('base64url');
	usersRepo.updateUser(userId, { calendar_token: token, calendar_token_expires_at: expiresAt ?? null });
	logAudit(userId, 'calendar_token_regenerate', 'user', userId, {
		expiresAt: expiresAt ?? null
	});
	return token;
}
