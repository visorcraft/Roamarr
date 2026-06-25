import { eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import {
	hashPassword,
	invalidateAllSessions,
	invalidateOtherSessions
} from './auth';
import { logAudit } from './audit';
import { db } from './db';
import { users } from './db/schema';
import { createPasswordResetToken } from './passwordReset';
import { deliver } from './notify';

export function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

function countAdmins() {
	return db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.role, 'admin')).get()!.c;
}

function assertCanChangeAdminAccess(
	target: typeof users.$inferSelect,
	patch: { role?: 'admin' | 'user'; disabled?: boolean },
	actorId: number
) {
	const demoting = patch.role === 'user' && target.role === 'admin';
	const disabling = patch.disabled === true && !target.disabled;
	const affectsSelf = target.id === actorId;
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

	const duplicate = db.select().from(users).where(eq(users.email, email)).get();
	if (duplicate) throw new Error('That email is already in use.');

	const role = input.role === 'admin' ? 'admin' : 'user';
	const temporaryPassword = randomBytes(16).toString('base64url');
	const passwordHash = await hashPassword(temporaryPassword);

	const created = db
		.insert(users)
		.values({
			email,
			passwordHash,
			displayName,
			role,
			mustResetPassword: true
		})
		.returning()
		.get();

	logAudit(actorId, 'user_create', 'user', created.id, { role });
	return { user: created, temporaryPassword };
}

export async function adminDeleteUser(actorId: number, userId: number) {
	const target = db.select().from(users).where(eq(users.id, userId)).get();
	if (!target) throw new Error('User not found.');

	if (target.role === 'admin' && countAdmins() <= 1) {
		throw new Error('Cannot delete the last admin.');
	}

	db.delete(users).where(eq(users.id, userId)).run();
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
	const target = db.select().from(users).where(eq(users.id, userId)).get();
	if (!target) throw new Error('User not found.');

	const displayName = input.displayName.trim();
	const email = normalizeEmail(input.email);
	if (!displayName) throw new Error('Display name is required.');
	if (!email || !email.includes('@')) throw new Error('A valid email is required.');

	const duplicate = db.select().from(users).where(eq(users.email, email)).get();
	if (duplicate && duplicate.id !== userId) throw new Error('That email is already in use.');

	assertCanChangeAdminAccess(target, { role: input.role, disabled: input.disabled }, actorId);

	const patch: Partial<typeof users.$inferInsert> = {
		displayName,
		email,
		role: input.role,
		disabled: input.disabled,
		mustResetPassword: input.mustResetPassword
	};

	const newPassword = input.newPassword?.trim() ?? '';
	const confirmPassword = input.confirmPassword?.trim() ?? '';
	if (newPassword || confirmPassword) {
		if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
		if (newPassword !== confirmPassword) throw new Error('New passwords do not match.');
		patch.passwordHash = await hashPassword(newPassword);
		if (!input.mustResetPassword) patch.mustResetPassword = false;
	}

	db.update(users).set(patch).where(eq(users.id, userId)).run();

	if (patch.passwordHash) invalidateAllSessions(userId);

	logAudit(actorId, 'user_update', 'user', userId, {
		changed: Object.keys(patch),
		role: input.role,
		disabled: input.disabled,
		mustResetPassword: input.mustResetPassword
	});
}

export async function adminSendPasswordReset(userId: number, origin: string) {
	const target = db.select().from(users).where(eq(users.id, userId)).get();
	if (!target) throw new Error('User not found.');
	if (target.disabled) throw new Error('Cannot reset password for a disabled account.');

	const token = createPasswordResetToken(userId);
	const link = `${origin}/reset-password/${token}`;
	await deliver(userId, {
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
	const u = db.select().from(users).where(eq(users.id, userId)).get();
	if (!u?.mustResetPassword) throw new Error('Password change is not required.');
	if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.');
	if (newPassword !== confirmPassword) throw new Error('Passwords do not match.');

	db.update(users)
		.set({ passwordHash: await hashPassword(newPassword), mustResetPassword: false })
		.where(eq(users.id, userId))
		.run();
	invalidateOtherSessions(userId, sessionToken);
	logAudit(userId, 'password_change', 'user', userId, { forced: true });
}
