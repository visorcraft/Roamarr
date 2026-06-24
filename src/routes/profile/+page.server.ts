import { fail, redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { hashPassword, requireUser, verifyPassword } from '$lib/server/auth';
import { requireOwnedUser } from '$lib/server/ownership';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

function validTimezone(tz: string) {
	return DateTime.local().setZone(tz).isValid;
}

export function _updateProfile(userId: number, i: { displayName: string; timezone: string }) {
	requireOwnedUser(userId);
	if (!i.displayName) throw new Error('Display name is required');
	if (!validTimezone(i.timezone)) throw new Error('Invalid timezone');
	db.update(users)
		.set({ displayName: i.displayName, timezone: i.timezone })
		.where(eq(users.id, userId))
		.run();
}

export async function _updatePassword(
	userId: number,
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
}

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return {
		user: {
			email: u.email,
			displayName: u.displayName,
			role: u.role,
			timezone: u.timezone
		}
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const displayName = String(f.get('displayName') ?? '');
		const timezone = String(f.get('timezone') ?? 'UTC');
		try {
			_updateProfile(u.id, { displayName, timezone });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
		throw redirect(303, '/profile');
	},
	updatePassword: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const oldPassword = String(f.get('oldPassword') ?? '');
		const newPassword = String(f.get('newPassword') ?? '');
		const confirmPassword = String(f.get('confirmPassword') ?? '');
		try {
			await _updatePassword(u.id, { oldPassword, newPassword, confirmPassword });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Password update failed' });
		}
		throw redirect(303, '/profile');
	}
};
