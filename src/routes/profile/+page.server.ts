import { fail, redirect, type Actions } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { requireUser } from '$lib/server/auth';
import { requireOwnedUser } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { currency as parseCurrency, nonNegativeInteger } from '$lib/server/validation';
import type { PageServerLoad } from './$types';

function validTimezone(tz: string) {
	return DateTime.local().setZone(tz).isValid;
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
		ntfyNotifications: boolean;
		defaultCurrency: string;
		temperatureUnit: string;
		timeFormat: string;
	}
) {
	requireOwnedUser(userId);
	if (!i.displayName) throw new Error('Display name is required');
	if (!validTimezone(i.timezone)) throw new Error('Invalid timezone');
	if (!nonNegativeInteger(i.flightCheckinLeadHours))
		throw new Error('Flight check-in lead must be a non-negative integer');
	if (!nonNegativeInteger(i.documentExpiryLeadDays))
		throw new Error('Document expiry lead must be a non-negative integer');
	if (i.temperatureUnit !== 'c' && i.temperatureUnit !== 'f')
		throw new Error('Temperature unit must be °C or °F');
	if (i.timeFormat !== '12h' && i.timeFormat !== '24h')
		throw new Error('Time format must be 12h or 24h');
	const defaultCurrency = parseCurrency(i.defaultCurrency, 'Default currency');
	if (!defaultCurrency.ok) throw new Error(defaultCurrency.error);
	usersRepo.updateUser(userId, {
		display_name: i.displayName,
		timezone: i.timezone,
		flight_checkin_lead_hours: BigInt(i.flightCheckinLeadHours),
		document_expiry_lead_days: BigInt(i.documentExpiryLeadDays),
		email_notifications: i.emailNotifications,
		webhook_notifications: i.webhookNotifications,
		ntfy_notifications: i.ntfyNotifications,
		default_currency: defaultCurrency.value,
		temperature_unit: i.temperatureUnit,
		time_format: i.timeFormat
	});
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
			documentExpiryLeadDays: u.documentExpiryLeadDays,
			emailNotifications: u.emailNotifications,
			webhookNotifications: u.webhookNotifications,
			ntfyNotifications: u.ntfyNotifications,
			themeId: u.themeId,
			defaultCurrency: u.defaultCurrency,
			temperatureUnit: u.temperatureUnit,
			timeFormat: u.timeFormat
		}
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
		const ntfyNotifications = f.get('ntfyNotifications') === 'on';
		const defaultCurrency = String(f.get('defaultCurrency') ?? u.defaultCurrency);
		const temperatureUnit = String(f.get('temperatureUnit') ?? u.temperatureUnit ?? 'c');
		const timeFormat = String(f.get('timeFormat') ?? u.timeFormat ?? '24h');
		try {
			_updateProfile(u.id, {
				displayName,
				timezone,
				flightCheckinLeadHours,
				documentExpiryLeadDays,
				emailNotifications,
				webhookNotifications,
				ntfyNotifications,
				defaultCurrency,
				temperatureUnit,
				timeFormat
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
		logAudit(u.id, 'profile_update', 'user', u.id);
		setFlash(cookies, 'Profile updated.');
		throw redirect(303, '/profile');
	}
};
