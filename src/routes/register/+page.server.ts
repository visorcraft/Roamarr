import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { getSettings } from '$lib/server/settings';
import { hashPassword, createSession, sessionCookieOptions } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { normalizeEmail } from '$lib/server/users';

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
	const existing = usersRepo.getUserByEmail(normalizeEmail(email));
	if (existing) throw new Error('Email already registered.');
	const u = usersRepo.createUser({
		email: normalizeEmail(email),
		password_hash: await hashPassword(password),
		display_name: displayName,
		role: 'user',
		disabled: false,
		must_reset_password: false,
		timezone: defaults.defaultTimezone,
		flight_checkin_lead_hours: BigInt(defaults.defaultFlightCheckinLeadHours),
		document_expiry_lead_days: BigInt(defaults.defaultDocumentExpiryLeadDays),
		email_notifications: true,
		webhook_notifications: true,
		theme_id: 'system',
		default_currency: defaults.defaultCurrency,
		calendar_token: null,
		calendar_token_expires_at: null
	} as usersRepo.CreateUserInput);
	return {
		id: Number(u.id),
		email: u.email,
		displayName: u.display_name ?? '',
		role: u.role,
		timezone: u.timezone,
		flightCheckinLeadHours: Number(u.flight_checkin_lead_hours),
		documentExpiryLeadDays: Number(u.document_expiry_lead_days)
	};
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
			if (e instanceof Error && e.message.includes('already registered')) {
				return fail(409, { error: 'Email already registered.' });
			}
			throw e;
		}
		cookies.set('session', createSession(u.id), sessionCookieOptions());
		throw redirect(303, '/');
	}
};
