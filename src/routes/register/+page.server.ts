import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { getSettings } from '$lib/server/settings';
import { hashPassword, createSession, sessionCookieOptions } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { normalizeEmail } from '$lib/server/users';
import * as usersRepo from '$lib/server/repositories/usersRepo';

function gate() {
	const s = getSettings();
	if (!s.setupComplete || !s.allowRegistration) throw error(404, 'Not found');
}

export const load: PageServerLoad = () => {
	gate();
	return {};
};

export async function _registerUser(email: string, password: string, displayName: string) {
	const defaults = getSettings();
	const u = db
		.insert(users)
		.values({
			email: normalizeEmail(email),
			passwordHash: await hashPassword(password),
			displayName,
			role: 'user',
			timezone: defaults.defaultTimezone,
			flightCheckinLeadHours: defaults.defaultFlightCheckinLeadHours,
			documentExpiryLeadDays: defaults.defaultDocumentExpiryLeadDays
		})
		.returning()
		.get();
	// Mirror the new user into the kit users table so the kit auth/session flow
	// can resolve the session.
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
		const limit = checkRateLimit(getClientAddress(), 'register');
		if (!limit.allowed)
			return fail(429, {
				error: 'Too many attempts. Try again later.',
				retryAfter: limit.retryAfter
			});
		gate();
		const f = await request.formData();
		const email = String(f.get('email') ?? ''),
			password = String(f.get('password') ?? ''),
			displayName = String(f.get('displayName') ?? '');
		if (!email || password.length < 8 || !displayName)
			return fail(400, { error: 'All fields required; password ≥ 8 chars.' });
		let u;
		try {
			u = await _registerUser(email, password, displayName);
		} catch (e) {
			if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
				return fail(409, { error: 'Email already registered.' });
			}
			throw e;
		}
		cookies.set('session', createSession(u.id), sessionCookieOptions());
		throw redirect(303, '/');
	}
};
