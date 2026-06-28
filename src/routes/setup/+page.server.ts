import { fail, redirect, type Actions } from '@sveltejs/kit';
import { hashPassword, createSession, sessionCookieOptions } from '$lib/server/auth';
import { db, sqlite } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import { getSettings, updateSettings } from '$lib/server/settings';
import { checkRateLimit } from '$lib/server/rateLimit';
import { normalizeEmail } from '$lib/server/users';
import * as usersRepo from '$lib/server/repositories/usersRepo';

export function _createAdmin(
	i: { email: string; password: string; displayName: string; instanceName: string; timezone: string },
	passwordHash?: string
) {
	const email = normalizeEmail(i.email);
	const s = getSettings();
	const tx = sqlite.transaction(() => {
		const n = db.select({ c: sql<number>`count(*)` }).from(users).get()!.c;
		if (s.setupComplete || n > 0) throw new Error('already set up');
		const u = db
			.insert(users)
			.values({
				email,
				passwordHash: passwordHash ?? 'PLACEHOLDER',
				displayName: i.displayName,
				role: 'admin',
				timezone: i.timezone,
				flightCheckinLeadHours: s.defaultFlightCheckinLeadHours,
				documentExpiryLeadDays: s.defaultDocumentExpiryLeadDays
			})
			.returning()
			.get();
		return u;
	});
	const u = tx.immediate();
	updateSettings({ setupComplete: true, instanceName: i.instanceName, defaultTimezone: i.timezone });
	// Mirror the admin into the kit users table so kit auth/session resolution works.
	usersRepo.createUser({
		id: BigInt(u.id),
		email: u.email,
		password_hash: u.passwordHash,
		display_name: u.displayName,
		role: u.role,
		disabled: u.disabled,
		must_reset_password: u.mustResetPassword,
		timezone: u.timezone,
		flight_checkin_lead_hours: BigInt(u.flightCheckinLeadHours),
		document_expiry_lead_days: BigInt(u.documentExpiryLeadDays),
		email_notifications: u.emailNotifications,
		webhook_notifications: u.webhookNotifications,
		theme_id: u.themeId,
		default_currency: u.defaultCurrency,
		calendar_token: u.calendarToken,
		calendar_token_expires_at: u.calendarTokenExpiresAt
	} as any);
	return u;
}

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const limit = checkRateLimit(getClientAddress(), 'setup');
		if (!limit.allowed)
			return fail(429, {
				error: 'Too many attempts. Try again later.',
				retryAfter: limit.retryAfter
			});
		const f = await request.formData();
		const email = String(f.get('email') ?? ''),
			password = String(f.get('password') ?? '');
		const displayName = String(f.get('displayName') ?? ''),
			instanceName = String(f.get('instanceName') ?? 'Roamarr');
		const timezone = String(f.get('timezone') ?? 'UTC');
		if (!email || password.length < 8 || !displayName)
			return fail(400, { error: 'All fields required; password ≥ 8 chars.' });
		let user;
		try {
			user = _createAdmin(
				{ email, password, displayName, instanceName, timezone },
				await hashPassword(password)
			);
		} catch (e) {
			if (e instanceof Error && e.message === 'already set up') {
				return fail(409, { error: 'Setup is already complete.' });
			}
			throw e;
		}
		cookies.set('session', createSession(user.id), sessionCookieOptions());
		throw redirect(303, '/');
	}
};
