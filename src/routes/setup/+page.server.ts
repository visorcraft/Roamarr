import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { hashPassword, createSession, sessionCookieOptions } from '$lib/server/auth';
import { validateSetupDb } from '$lib/server/setupValidation';
import { users } from '$lib/server/db/mongrelSchema';
import { getSettings, updateSettings } from '$lib/server/settings';
import { checkRateLimit } from '$lib/server/rateLimit';
import { normalizeEmail } from '$lib/server/users';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import type { Insert } from '@visorcraft/mongreldb-kit';

export function _createAdmin(
	i: { email: string; password: string; displayName: string; instanceName: string; timezone: string },
	passwordHash?: string
) {
	const email = normalizeEmail(i.email);
	const s = getSettings();
	if (s.setupComplete || usersRepo.countUsers() > 0) throw new Error('already set up');

	const u = usersRepo.createUser({
		email,
		password_hash: passwordHash ?? 'PLACEHOLDER',
		display_name: i.displayName,
		role: 'admin',
		disabled: false,
		must_reset_password: false,
		timezone: i.timezone,
		flight_checkin_lead_hours: BigInt(s.defaultFlightCheckinLeadHours),
		document_expiry_lead_days: BigInt(s.defaultDocumentExpiryLeadDays),
		email_notifications: true,
		webhook_notifications: true,
		theme_id: 'system',
		default_currency: s.defaultCurrency,
		calendar_token: null,
		calendar_token_expires_at: null
	} as Insert<typeof users>);

	updateSettings({ setupComplete: true, instanceName: i.instanceName, defaultTimezone: i.timezone });
	return {
		id: Number(u.id),
		email: u.email,
		displayName: u.display_name ?? '',
		role: u.role
	};
}

export const load: ServerLoad = async ({ locals }) => {
	const setupCheck = await validateSetupDb();
	return {
		missingSecret: locals.missingSecret ?? false,
		bootError: locals.bootError,
		setupCheck
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, locals }) => {
		if (locals.missingSecret || locals.bootError) {
			return fail(400, {
				error:
					'ROAMARR_SECRET or the database is not ready. Fix the issue shown on the setup page before creating the admin account.'
			});
		}

		const limit = checkRateLimit(getClientAddress(), 'setup');
		if (!limit.allowed)
			return fail(429, {
				error: 'Too many attempts. Try again later.',
				retryAfter: limit.retryAfter
			});
		const f = await request.formData();
		const email = String(f.get('email') ?? ''),
			password = String(f.get('password') ?? '');
		const confirmPassword = String(f.get('confirmPassword') ?? '');
		const displayName = String(f.get('displayName') ?? ''),
			instanceName = String(f.get('instanceName') ?? 'Roamarr');
		const timezone = String(f.get('timezone') ?? 'UTC');
		if (!email || password.length < 8 || !displayName)
			return fail(400, { error: 'All fields required; password ≥ 8 chars.' });
		if (password !== confirmPassword)
			return fail(400, { error: 'Passwords do not match.' });
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
