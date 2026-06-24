import { fail, redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { hashPassword, invalidateOtherSessions, requireUser, verifyPassword } from '$lib/server/auth';
import { requireOwnedUser } from '$lib/server/ownership';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

function validTimezone(tz: string) {
	return DateTime.local().setZone(tz).isValid;
}

function validLead(n: number) {
	return Number.isInteger(n) && n >= 0;
}

export function _updateProfile(
	userId: number,
	i: { displayName: string; timezone: string; flightCheckinLeadHours: number; documentExpiryLeadDays: number }
) {
	requireOwnedUser(userId);
	if (!i.displayName) throw new Error('Display name is required');
	if (!validTimezone(i.timezone)) throw new Error('Invalid timezone');
	if (!validLead(i.flightCheckinLeadHours)) throw new Error('Flight check-in lead must be a non-negative integer');
	if (!validLead(i.documentExpiryLeadDays)) throw new Error('Document expiry lead must be a non-negative integer');
	db.update(users)
		.set({
			displayName: i.displayName,
			timezone: i.timezone,
			flightCheckinLeadHours: i.flightCheckinLeadHours,
			documentExpiryLeadDays: i.documentExpiryLeadDays
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
}

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return {
		user: {
			email: u.email,
			displayName: u.displayName,
			role: u.role,
			timezone: u.timezone,
			flightCheckinLeadHours: u.flightCheckinLeadHours,
			documentExpiryLeadDays: u.documentExpiryLeadDays
		}
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const displayName = String(f.get('displayName') ?? '');
		const timezone = String(f.get('timezone') ?? 'UTC');
		const flightCheckinLeadHours = Number(f.get('flightCheckinLeadHours') ?? 24);
		const documentExpiryLeadDays = Number(f.get('documentExpiryLeadDays') ?? 90);
		try {
			_updateProfile(u.id, {
				displayName,
				timezone,
				flightCheckinLeadHours,
				documentExpiryLeadDays
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
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
		throw redirect(303, '/profile');
	}
};
