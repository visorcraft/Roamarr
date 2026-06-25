import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { hashPassword, invalidateOtherSessions, requireUser, verifyPassword } from '$lib/server/auth';
import { requireOwnedUser } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';
import { db } from '$lib/server/db';
import { users, sessions } from '$lib/server/db/schema';
import { THEMES, isThemeId, normalizeThemeId } from '$lib/themes';
import type { PageServerLoad } from './$types';

function tokenHash(token: string) {
	return createHash('sha256').update(token).digest('hex');
}

function validTimezone(tz: string) {
	return DateTime.local().setZone(tz).isValid;
}

function validLead(n: number) {
	return Number.isInteger(n) && n >= 0;
}

export function _updateProfile(
	userId: number,
	i: {
		displayName: string;
		timezone: string;
		flightCheckinLeadHours: number;
		documentExpiryLeadDays: number;
		emailNotifications: boolean;
		webhookNotifications: boolean;
		themeId: string;
	}
) {
	requireOwnedUser(userId);
	if (!i.displayName) throw new Error('Display name is required');
	if (!validTimezone(i.timezone)) throw new Error('Invalid timezone');
	if (!validLead(i.flightCheckinLeadHours)) throw new Error('Flight check-in lead must be a non-negative integer');
	if (!validLead(i.documentExpiryLeadDays)) throw new Error('Document expiry lead must be a non-negative integer');
	if (!isThemeId(i.themeId)) throw new Error('Invalid theme');
	db.update(users)
		.set({
			displayName: i.displayName,
			timezone: i.timezone,
			flightCheckinLeadHours: i.flightCheckinLeadHours,
			documentExpiryLeadDays: i.documentExpiryLeadDays,
			emailNotifications: i.emailNotifications,
			webhookNotifications: i.webhookNotifications,
			themeId: i.themeId
		})
		.where(eq(users.id, userId))
		.run();
}

export async function _updatePassword(
	userId: number,
	currentToken: string,
	i: { oldPassword: string; newPassword: string; confirmPassword: string }
) {
	const u = requireOwnedUser(userId);
	if (!(await verifyPassword(u.passwordHash, i.oldPassword)))
		throw new Error('Current password is incorrect');
	if (i.newPassword !== i.confirmPassword) throw new Error('New passwords do not match');
	db.update(users)
		.set({ passwordHash: await hashPassword(i.newPassword) })
		.where(eq(users.id, userId))
		.run();
	invalidateOtherSessions(userId, currentToken);
	logAudit(userId, 'password_change', 'user', userId);
}

export const load: PageServerLoad = ({ locals, cookies }) => {
	const u = requireUser(locals);
	const currentToken = cookies.get('session');
	const currentHash = currentToken ? tokenHash(currentToken) : null;
	const sessionRows = db
		.select({ id: sessions.id, tokenHash: sessions.tokenHash, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt, lastIp: sessions.lastIp, userAgent: sessions.userAgent })
		.from(sessions)
		.where(eq(sessions.userId, u.id))
		.all();
	const userSessions = sessionRows
		.filter((s) => s.expiresAt >= DateTime.utc().toISO()!)
		.map((s) => ({ ...s, current: s.tokenHash === currentHash }));
	return {
		user: {
			email: u.email,
			displayName: u.displayName,
			role: u.role,
			timezone: u.timezone,
			flightCheckinLeadHours: u.flightCheckinLeadHours,
			documentExpiryLeadDays: u.documentExpiryLeadDays,
			emailNotifications: u.emailNotifications,
			webhookNotifications: u.webhookNotifications,
			themeId: normalizeThemeId(u.themeId)
		},
		themes: THEMES,
		sessions: userSessions
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const displayName = String(f.get('displayName') ?? '');
		const timezone = String(f.get('timezone') ?? 'UTC');
		const flightCheckinLeadHours = Number(f.get('flightCheckinLeadHours') ?? 24);
		const documentExpiryLeadDays = Number(f.get('documentExpiryLeadDays') ?? 90);
		const emailNotifications = f.get('emailNotifications') === 'on';
		const webhookNotifications = f.get('webhookNotifications') === 'on';
		const themeId = String(f.get('themeId') ?? u.themeId);
		try {
			_updateProfile(u.id, {
				displayName,
				timezone,
				flightCheckinLeadHours,
				documentExpiryLeadDays,
				emailNotifications,
				webhookNotifications,
				themeId
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
		setFlash(cookies, 'Profile updated.');
		throw redirect(303, '/profile');
	},
	revokeSession: async ({ cookies, request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Invalid session' });
		const currentToken = cookies.get('session');
		const currentHash = currentToken ? tokenHash(currentToken) : null;
		db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, u.id))).run();
		if (currentHash) {
			const removed = db.select().from(sessions).where(eq(sessions.tokenHash, currentHash)).get();
			if (!removed) {
				cookies.delete('session', { path: '/' });
				throw redirect(303, '/login');
			}
		}
		setFlash(cookies, 'Session revoked.');
		throw redirect(303, '/profile');
	},
	updatePassword: async ({ cookies, request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const oldPassword = String(f.get('oldPassword') ?? '');
		const newPassword = String(f.get('newPassword') ?? '');
		const confirmPassword = String(f.get('confirmPassword') ?? '');
		const token = cookies.get('session');
		if (!token) throw redirect(302, '/login');
		try {
			await _updatePassword(u.id, token, { oldPassword, newPassword, confirmPassword });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Password update failed' });
		}
		setFlash(cookies, 'Password changed.');
		throw redirect(303, '/profile');
	}
};
