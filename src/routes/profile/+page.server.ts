import { createHash, randomBytes } from 'node:crypto';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { hashPassword, invalidateOtherSessions, requireUser, verifyPassword } from '$lib/server/auth';
import { requireOwnedUser } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { currency as parseCurrency, nonNegativeInteger } from '$lib/server/validation';
import {
	listEmergencyContacts,
	createEmergencyContact as addEmergencyContact,
	updateEmergencyContact,
	deleteEmergencyContact
} from '$lib/server/repositories/profileRepo';
import { nowIso } from '$lib/server/tz';
import { THEMES, isThemeId, normalizeThemeId } from '$lib/themes';
import { normalizeEmail } from '$lib/server/users';
import type { PageServerLoad } from './$types';

function tokenHash(token: string) {
	return createHash('sha256').update(token).digest('hex');
}

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
		themeId: string;
		defaultCurrency: string;
	}
) {
	requireOwnedUser(userId);
	if (!i.displayName) throw new Error('Display name is required');
	if (!validTimezone(i.timezone)) throw new Error('Invalid timezone');
	if (!nonNegativeInteger(i.flightCheckinLeadHours)) throw new Error('Flight check-in lead must be a non-negative integer');
	if (!nonNegativeInteger(i.documentExpiryLeadDays)) throw new Error('Document expiry lead must be a non-negative integer');
	if (!isThemeId(i.themeId)) throw new Error('Invalid theme');
	const defaultCurrency = parseCurrency(i.defaultCurrency, 'Default currency');
	if (!defaultCurrency.ok) throw new Error(defaultCurrency.error);
	usersRepo.updateUser(userId, {
		display_name: i.displayName,
		timezone: i.timezone,
		flight_checkin_lead_hours: BigInt(i.flightCheckinLeadHours),
		document_expiry_lead_days: BigInt(i.documentExpiryLeadDays),
		email_notifications: i.emailNotifications,
		webhook_notifications: i.webhookNotifications,
		theme_id: i.themeId,
		default_currency: defaultCurrency.value
	});
}

export async function _updatePassword(
	userId: number,
	currentToken: string,
	i: { oldPassword: string; newPassword: string; confirmPassword: string }
) {
	const u = requireOwnedUser(userId);
	if (!(await verifyPassword(u.password_hash, i.oldPassword)))
		throw new Error('Current password is incorrect');
	if (i.newPassword !== i.confirmPassword) throw new Error('New passwords do not match');
	usersRepo.updateUser(userId, { password_hash: await hashPassword(i.newPassword) });
	invalidateOtherSessions(userId, currentToken);
	logAudit(userId, 'password_change', 'user', userId);
}

export async function _changeEmail(
	userId: number,
	i: { currentPassword: string; newEmail: string; confirmEmail?: string }
) {
	const u = requireOwnedUser(userId);
	if (!(await verifyPassword(u.password_hash, i.currentPassword)))
		throw new Error('Current password is incorrect');

	const email = normalizeEmail(i.newEmail);
	if (!email || !email.includes('@')) throw new Error('A valid email is required.');

	if (i.confirmEmail !== undefined && email !== normalizeEmail(i.confirmEmail)) {
		throw new Error('Email addresses do not match.');
	}

	const duplicate = usersRepo.getUserByEmail(email);
	if (duplicate && Number(duplicate.id) !== userId) throw new Error('That email is already in use.');

	const oldEmail = u.email;
	usersRepo.updateUser(userId, { email });
	logAudit(userId, 'email_change', 'user', userId, { oldEmail });
}

export function _regenerateUserCalendarToken(userId: number, expiresAt?: string | null) {
	requireOwnedUser(userId);
	const token = randomBytes(24).toString('base64url');
	usersRepo.updateUser(userId, { calendar_token: token, calendar_token_expires_at: expiresAt ?? null });
	logAudit(userId, 'calendar_token_regenerate', 'user', userId, {
		expiresAt: expiresAt ?? null
	});
	return token;
}

export const load: PageServerLoad = ({ locals, cookies, url }) => {
	const u = requireUser(locals);
	const currentToken = cookies.get('session');
	const currentHash = currentToken ? tokenHash(currentToken) : null;
	const sessionRows = usersRepo.listSessionsForUser(u.id);
	const userSessions = sessionRows
		.filter((s) => s.expires_at >= nowIso())
		.map((s) => ({
			id: Number(s.id),
			tokenHash: s.token_hash,
			createdAt: s.created_at,
			expiresAt: s.expires_at,
			lastIp: s.last_ip,
			userAgent: s.user_agent,
			current: s.token_hash === currentHash
		}));
	const feedUrl = u.calendarToken
		? `${url.origin}/calendar/feed?token=${encodeURIComponent(u.calendarToken)}`
		: null;
	const emergencyContacts = listEmergencyContacts(u.id);

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
			themeId: normalizeThemeId(u.themeId),
			defaultCurrency: u.defaultCurrency
		},
		themes: THEMES,
		sessions: userSessions,
		feedUrl,
		calendarTokenExpiresAt: u.calendarTokenExpiresAt,
		emergencyContacts
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
		const defaultCurrency = String(f.get('defaultCurrency') ?? u.defaultCurrency);
		try {
			_updateProfile(u.id, {
				displayName,
				timezone,
				flightCheckinLeadHours,
				documentExpiryLeadDays,
				emailNotifications,
				webhookNotifications,
				themeId,
				defaultCurrency
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
		usersRepo.deleteSessionByIdAndUserId(id, u.id);
		if (currentHash) {
			const removed = usersRepo.getSessionByTokenHash(currentHash);
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
	},
	changeEmail: async ({ cookies, request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const currentPassword = String(f.get('currentPassword') ?? '');
		const newEmail = String(f.get('newEmail') ?? '');
		const confirmEmail = String(f.get('confirmEmail') ?? '');
		try {
			await _changeEmail(u.id, { currentPassword, newEmail, confirmEmail });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Email change failed' });
		}
		setFlash(cookies, 'Email changed.');
		throw redirect(303, '/profile');
	},
	regenerateCalendarToken: async ({ cookies, request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const expiresAt = String(f.get('calendarExpiresAt') || '');
		_regenerateUserCalendarToken(u.id, expiresAt || null);
		setFlash(cookies, 'Calendar feed URL regenerated.');
		throw redirect(303, '/profile');
	},
	addEmergencyContact: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		try {
			addEmergencyContact(u.id, {
				name: String(f.get('name') ?? ''),
				relationship: String(f.get('relationship') || '') || undefined,
				phone: String(f.get('phone') || '') || undefined,
				email: String(f.get('email') || '') || undefined,
				isPrimary: f.get('isPrimary') === 'on'
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to add contact' });
		}
		setFlash(cookies, 'Emergency contact added.');
		throw redirect(303, '/profile');
	},
	updateEmergencyContact: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Invalid contact' });
		try {
			updateEmergencyContact(id, u.id, {
				name: String(f.get('name') ?? ''),
				relationship: String(f.get('relationship') || '') || undefined,
				phone: String(f.get('phone') || '') || undefined,
				email: String(f.get('email') || '') || undefined,
				isPrimary: f.get('isPrimary') === 'on'
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to update contact' });
		}
		setFlash(cookies, 'Emergency contact updated.');
		throw redirect(303, '/profile');
	},
	deleteEmergencyContact: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Invalid contact' });
		try {
			deleteEmergencyContact(id, u.id);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to delete contact' });
		}
		setFlash(cookies, 'Emergency contact deleted.');
		throw redirect(303, '/profile');
	}
};
