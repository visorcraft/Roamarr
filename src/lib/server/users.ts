import { eq as kitEq } from '@mongreldb/kit';
import { randomBytes } from 'node:crypto';
import { hashPassword, invalidateAllSessions, invalidateOtherSessions } from './auth';
import { logAudit } from './audit';
import { kit } from './db';
import { users } from './db/mongrelSchema';
import * as usersRepo from './repositories/usersRepo';
import { createPasswordResetToken } from './passwordReset';
import { deliver } from './notify';

export function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

function countAdmins() {
	return kit.selectFrom(users).where(kitEq(users.role, 'admin')).executeSync().length;
}

function assertCanChangeAdminAccess(
	target: usersRepo.KitUser,
	patch: { role?: 'admin' | 'user'; disabled?: boolean },
	actorId: number
) {
	const demoting = patch.role === 'user' && target.role === 'admin';
	const disabling = patch.disabled === true && !target.disabled;
	const affectsSelf = Number(target.id) === actorId;
	if ((demoting || disabling) && affectsSelf && countAdmins() <= 1) {
		throw new Error('Cannot remove the last admin.');
	}
}

interface AdminCreateUserInput {
	displayName: string;
	email: string;
	role?: 'admin' | 'user';
}

export async function adminCreateUser(actorId: number, input: AdminCreateUserInput) {
	const displayName = input.displayName.trim();
	const email = normalizeEmail(input.email);
	if (!displayName) throw new Error('Display name is required.');
	if (!email || !email.includes('@')) throw new Error('A valid email is required.');

	const duplicate = usersRepo.getUserByEmail(email);
	if (duplicate) throw new Error('That email is already in use.');

	const role = input.role === 'admin' ? 'admin' : 'user';
	const temporaryPassword = randomBytes(16).toString('base64url');
	const passwordHash = await hashPassword(temporaryPassword);

	const created = usersRepo.createUser({
		email,
		password_hash: passwordHash,
		display_name: displayName
	} as usersRepo.CreateUserInput);
	if (role === 'admin') {
		usersRepo.updateUser(Number(created.id), { role: 'admin' });
	}

	logAudit(actorId, 'user_create', 'user', Number(created.id), { role });
	return { user: created, temporaryPassword };
}

export async function adminDeleteUser(actorId: number, userId: number) {
	const target = usersRepo.getUserById(userId);
	if (!target) throw new Error('User not found.');

	if (target.role === 'admin' && countAdmins() <= 1) {
		throw new Error('Cannot delete the last admin.');
	}

	usersRepo.deleteUser(userId);
	logAudit(actorId, 'user_delete', 'user', userId, { email: target.email, role: target.role });
}

interface AdminUpdateUserInput {
	displayName: string;
	email: string;
	role: 'admin' | 'user';
	disabled: boolean;
	mustResetPassword: boolean;
	newPassword?: string;
	confirmPassword?: string;
}

export async function adminUpdateUser(
	actorId: number,
	userId: number,
	input: AdminUpdateUserInput
) {
	const target = usersRepo.getUserById(userId);
	if (!target) throw new Error('User not found.');

	const displayName = input.displayName.trim();
	const email = normalizeEmail(input.email);
	if (!displayName) throw new Error('Display name is required.');
	if (!email || !email.includes('@')) throw new Error('A valid email is required.');

	const duplicate = usersRepo.getUserByEmail(email);
	if (duplicate && Number(duplicate.id) !== userId) throw new Error('That email is already in use.');

	assertCanChangeAdminAccess(target, { role: input.role, disabled: input.disabled }, actorId);

	const patch: Partial<usersRepo.KitUser> = {
		display_name: displayName,
		email,
		role: input.role,
		disabled: input.disabled,
		must_reset_password: input.mustResetPassword
	};

	const newPassword = input.newPassword?.trim() ?? '';
	const confirmPassword = input.confirmPassword?.trim() ?? '';
	let passwordChanged = false;
	if (newPassword || confirmPassword) {
		if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
		if (newPassword !== confirmPassword) throw new Error('New passwords do not match.');
		patch.password_hash = await hashPassword(newPassword);
		if (!input.mustResetPassword) patch.must_reset_password = false;
		passwordChanged = true;
	}

	usersRepo.updateUser(userId, patch);

	if (passwordChanged) invalidateAllSessions(userId);

	logAudit(actorId, 'user_update', 'user', userId, {
		changed: Object.keys(patch),
		role: input.role,
		disabled: input.disabled,
		mustResetPassword: input.mustResetPassword
	});
}

export async function adminSendPasswordReset(userId: number, origin: string) {
	const target = usersRepo.getUserById(userId);
	if (!target) throw new Error('User not found.');
	if (target.disabled) throw new Error('Cannot reset password for a disabled account.');

	const token = createPasswordResetToken(Number(target.id));
	const link = `${origin}/reset-password/${token}`;
	await deliver(Number(target.id), {
		title: 'Reset your Roamarr password',
		body: 'An administrator requested a password reset. Click the link below to choose a new password. This link expires in 1 hour.',
		link
	});
}

export async function completeRequiredPasswordChange(
	userId: number,
	sessionToken: string,
	newPassword: string,
	confirmPassword: string
) {
	const u = usersRepo.getUserById(userId);
	if (!u?.must_reset_password) throw new Error('Password change is not required.');
	if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.');
	if (newPassword !== confirmPassword) throw new Error('Passwords do not match.');

	usersRepo.updateUser(userId, {
		password_hash: await hashPassword(newPassword),
		must_reset_password: false
	});
	invalidateOtherSessions(userId, sessionToken);
	logAudit(userId, 'password_change', 'user', userId, { forced: true });
}
