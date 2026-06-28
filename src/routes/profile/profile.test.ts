import { createHash } from 'node:crypto';
import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@mongreldb/kit').KitDatabase
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import { makeUser } from '../../../tests/helpers';

const remindersMock = vi.hoisted(() => ({
	upsertRemindersForDocument: vi.fn(),
	cancelRemindersFor: vi.fn()
}));
vi.mock('$lib/server/reminders', () => remindersMock);

import { _addDocument as addDocument } from './documents/+page.server';
import { updateLoyaltyProgram as updateProgram } from '$lib/server/loyaltyPrograms';
import {
	_updateProfile,
	_updatePassword,
	_changeEmail,
	_regenerateUserCalendarToken,
	actions
} from './+page.server';
import { upsertRemindersForDocument } from '$lib/server/reminders';
import { users, travelDocuments, loyaltyPrograms, sessions, auditLogs, emergencyContacts } from '$lib/server/db/mongrelSchema';
import { decrypt } from '$lib/server/crypto';
import { eq } from '@mongreldb/kit';
import { createSession, hashPassword, verifyPassword } from '$lib/server/auth';
import { beforeEach } from 'vitest';
import { makeKitUser } from '../../../tests/kitHelpers';
import * as profileRepo from '$lib/server/repositories/profileRepo';

function makeTestUser(over: any = {}) {
	return makeKitUser({
		email: over.email,
		password_hash: over.passwordHash,
		display_name: over.displayName,
		role: (over.role as 'admin' | 'user') ?? 'user',
		timezone: over.timezone,
		theme_id: over.themeId,
		default_currency: over.defaultCurrency,
		calendar_token: over.calendarToken ?? null,
		calendar_token_expires_at: over.calendarTokenExpiresAt ?? null,
		must_reset_password: over.mustResetPassword ?? false,
		disabled: over.disabled ?? false,
		flight_checkin_lead_hours: over.flightCheckinLeadHours
			? BigInt(over.flightCheckinLeadHours)
			: undefined,
		document_expiry_lead_days: over.documentExpiryLeadDays
			? BigInt(over.documentExpiryLeadDays)
			: undefined,
		email_notifications: over.emailNotifications ?? undefined,
		webhook_notifications: over.webhookNotifications ?? undefined
	});
}

beforeEach(() => {
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(sessions).executeSync();
	kit.deleteFrom(emergencyContacts).executeSync();
	kit.deleteFrom(loyaltyPrograms).executeSync();
	kit.deleteFrom(travelDocuments).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('document number is encrypted at rest and arms a reminder', () => {
	const u = makeTestUser({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	addDocument(Number(u.id), {
		type: 'passport',
		number: 'X1234567',
		issuingAuthority: 'US',
		expiresOn: '2030-01-01'
	});
	const row = kit.selectFrom(travelDocuments).executeSync()[0]!;
	expect(row.number).not.toBe('X1234567');
	expect(decrypt(row.number!)).toBe('X1234567');
	expect(upsertRemindersForDocument).toHaveBeenCalled();
});

test('updateProgram edits a loyalty program and is user-scoped', () => {
	const a = makeTestUser({ email: 'loyal-a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeTestUser({ email: 'loyal-b@x.c', passwordHash: 'x', displayName: 'B' });
	const program = profileRepo.createLoyaltyProgram(Number(a.id), {
		programName: 'Old',
		membershipNumber: '123',
		balance: 1000,
		notes: 'old note'
	});
	updateProgram(Number(a.id), program.id, {
		programName: 'United MileagePlus',
		membershipNumber: 'UA999',
		balance: 5000,
		notes: 'new note'
	});
	const row = kit.selectFrom(loyaltyPrograms).where(eq(loyaltyPrograms.id, BigInt(program.id))).executeSync()[0]!;
	expect(row.program_name).toBe('United MileagePlus');
	expect(row.membership_number).toBe('UA999');
	expect(Number(row.balance)).toBe(5000);
	expect(row.notes).toBe('new note');

	expect(() => updateProgram(Number(b.id), program.id, { programName: 'Hacked' })).toThrow(
		expect.objectContaining({ status: 404, body: { message: 'Not found' } })
	);
	const unchanged = kit.selectFrom(loyaltyPrograms).where(eq(loyaltyPrograms.id, BigInt(program.id))).executeSync()[0]!;
	expect(unchanged.program_name).toBe('United MileagePlus');
});

test('update profile changes display name, timezone and reminder leads', () => {
	const u = makeUser(kit, { email: 'p1@x.c', passwordHash: 'x', displayName: 'P1', timezone: 'UTC' });
	_updateProfile(u.id, {
		displayName: 'Ada',
		timezone: 'America/New_York',
		flightCheckinLeadHours: 48,
		documentExpiryLeadDays: 60,
		emailNotifications: true,
		webhookNotifications: false,
		themeId: 'vibes',
		defaultCurrency: 'eur'
	});
	const row = kit.selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!;
	expect(row.display_name).toBe('Ada');
	expect(row.timezone).toBe('America/New_York');
	expect(Number(row.flight_checkin_lead_hours)).toBe(48);
	expect(Number(row.document_expiry_lead_days)).toBe(60);
	expect(row.theme_id).toBe('vibes');
	expect(row.default_currency).toBe('EUR');
});

test('update profile rejects invalid timezone', () => {
	const u = makeUser(kit, { email: 'p2@x.c', passwordHash: 'x', displayName: 'P2', timezone: 'UTC' });
	expect(() =>
		_updateProfile(u.id, {
			displayName: 'P2',
			timezone: 'Mars/Colony',
			flightCheckinLeadHours: 24,
			documentExpiryLeadDays: 90,
			emailNotifications: true,
			webhookNotifications: true,
			themeId: 'midnight-travels',
			defaultCurrency: 'USD'
		})
	).toThrow('Invalid timezone');
});

test('update profile rejects negative or fractional reminder leads', () => {
	const u = makeUser(kit, { email: 'p-lead@x.c', passwordHash: 'x', displayName: 'P', timezone: 'UTC' });
	expect(() =>
		_updateProfile(u.id, {
			displayName: 'P',
			timezone: 'UTC',
			flightCheckinLeadHours: -1,
			documentExpiryLeadDays: 90,
			emailNotifications: true,
			webhookNotifications: true,
			themeId: 'midnight-travels',
			defaultCurrency: 'USD'
		})
	).toThrow('Flight check-in lead must be a non-negative integer');
	expect(() =>
		_updateProfile(u.id, {
			displayName: 'P',
			timezone: 'UTC',
			flightCheckinLeadHours: 24,
			documentExpiryLeadDays: 1.5,
			emailNotifications: true,
			webhookNotifications: true,
			themeId: 'midnight-travels',
			defaultCurrency: 'USD'
		})
	).toThrow('Document expiry lead must be a non-negative integer');
});

test('update profile rejects invalid theme', () => {
	const u = makeUser(kit, { email: 'p-theme@x.c', passwordHash: 'x', displayName: 'P', timezone: 'UTC' });
	expect(() =>
		_updateProfile(u.id, {
			displayName: 'P',
			timezone: 'UTC',
			flightCheckinLeadHours: 24,
			documentExpiryLeadDays: 90,
			emailNotifications: true,
			webhookNotifications: true,
			themeId: 'not-a-theme',
			defaultCurrency: 'USD'
		})
	).toThrow('Invalid theme');
});

test('update profile rejects invalid default currency', () => {
	const u = makeUser(kit, { email: 'p-currency@x.c', passwordHash: 'x', displayName: 'P', timezone: 'UTC' });
	expect(() =>
		_updateProfile(u.id, {
			displayName: 'P',
			timezone: 'UTC',
			flightCheckinLeadHours: 24,
			documentExpiryLeadDays: 90,
			emailNotifications: true,
			webhookNotifications: true,
			themeId: 'midnight-travels',
			defaultCurrency: 'US Dollar'
		})
	).toThrow('Default currency must be a 3-letter currency code');
});

test('update password requires old password and hashes new password', async () => {
	const initialHash = await hashPassword('oldsecret');
	const u = makeUser(kit, {
			email: 'p3@x.c',
			passwordHash: initialHash,
			displayName: 'P3',
			timezone: 'UTC'
		});
	await _updatePassword(u.id, 'current-token', {
		oldPassword: 'oldsecret',
		newPassword: 'newsecret1',
		confirmPassword: 'newsecret1'
	});
	const row = kit.selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!;
	expect(await verifyPassword(row.password_hash, 'newsecret1')).toBe(true);
	expect(await verifyPassword(row.password_hash, 'oldsecret')).toBe(false);

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('password_change');
	expect(logs[0].entity_type).toBe('user');
	expect(Number(logs[0].entity_id)).toBe(u.id);
});

test('update password rejects wrong old password', async () => {
	const initialHash = await hashPassword('oldsecret');
	const u = makeUser(kit, {
			email: 'p4@x.c',
			passwordHash: initialHash,
			displayName: 'P4',
			timezone: 'UTC'
		});
	await expect(
		_updatePassword(u.id, 'current-token', {
			oldPassword: 'wrong',
			newPassword: 'newsecret1',
			confirmPassword: 'newsecret1'
		})
	).rejects.toThrow('Current password is incorrect');
});

test('update password rejects mismatched confirmation', async () => {
	const initialHash = await hashPassword('oldsecret');
	const u = makeUser(kit, {
			email: 'p5@x.c',
			passwordHash: initialHash,
			displayName: 'P5',
			timezone: 'UTC'
		});
	await expect(
		_updatePassword(u.id, 'current-token', {
			oldPassword: 'oldsecret',
			newPassword: 'newsecret1',
			confirmPassword: 'different'
		})
	).rejects.toThrow('New passwords do not match');
});

test('update password enforces password policy', async () => {
	const initialHash = await hashPassword('oldsecret');
	const u = makeUser(kit, {
			email: 'p6@x.c',
			passwordHash: initialHash,
			displayName: 'P6',
			timezone: 'UTC'
		});
	await expect(
		_updatePassword(u.id, 'current-token', { oldPassword: 'oldsecret', newPassword: 'short', confirmPassword: 'short' })
	).rejects.toThrow();
});

test('update password invalidates all other sessions for the user', async () => {
	const initialHash = await hashPassword('oldsecret');
	const u = makeKitUser({
		email: 'p7@x.c',
		password_hash: initialHash,
		display_name: 'P7',
		timezone: 'UTC'
	});
	const currentToken = createSession(Number(u.id));
	createSession(Number(u.id));
	createSession(Number(u.id));
	expect(kit.selectFrom(sessions).where(eq(sessions.user_id, BigInt(u.id))).executeSync()).toHaveLength(3);

	await _updatePassword(Number(u.id), currentToken, {
		oldPassword: 'oldsecret',
		newPassword: 'newsecret1',
		confirmPassword: 'newsecret1'
	});

	const remaining = kit.selectFrom(sessions).where(eq(sessions.user_id, BigInt(u.id))).executeSync();
	expect(remaining).toHaveLength(1);
	expect(remaining[0].token_hash).toBe(
		createHash('sha256').update(currentToken).digest('hex')
	);

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('password_change');
});

test('updateProfile action sets a flash cookie and redirects', async () => {
	const u = makeUser(kit, { email: 'p-action@x.c', passwordHash: 'x', displayName: 'P', timezone: 'UTC' });
	const cookies = { set: vi.fn(), get: vi.fn() };
	const request = new Request('http://x/profile', {
		method: 'POST',
		body: new URLSearchParams({
			displayName: 'Ada',
			timezone: 'UTC',
			flightCheckinLeadHours: '24',
			documentExpiryLeadDays: '90',
			themeId: 'red-velvet'
		})
	});
	const locals = { user: u } as App.Locals;
	await expect(actions.updateProfile({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/profile'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'Profile updated.', expect.any(Object));
	expect(kit.selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!.theme_id).toBe('red-velvet');
});

test('updatePassword action sets a flash cookie and redirects', async () => {
	const initialHash = await hashPassword('oldsecret');
	const u = makeUser(kit, { email: 'p-pw-action@x.c', passwordHash: initialHash, displayName: 'P', timezone: 'UTC' });
	const cookies = { set: vi.fn(), get: () => 'current-token' };
	const request = new Request('http://x/profile', {
		method: 'POST',
		body: new URLSearchParams({
			oldPassword: 'oldsecret',
			newPassword: 'newsecret1',
			confirmPassword: 'newsecret1'
		})
	});
	const locals = { user: u } as App.Locals;
	await expect(actions.updatePassword({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/profile'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'Password changed.', expect.any(Object));
});

test('regenerate user calendar token mints a new token and audits', () => {
	const u = makeUser(kit, { email: 'cal@x.c', passwordHash: 'x', displayName: 'Cal', calendarToken: 'old-token' });

	const token = _regenerateUserCalendarToken(u.id);
	expect(token).not.toBe('old-token');
	expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

	const row = kit.selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!;
	expect(row.calendar_token).toBe(token);
	expect(row.calendar_token_expires_at).toBe('');

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('calendar_token_regenerate');
	expect(logs[0].entity_type).toBe('user');
});

test('regenerate user calendar token can set an expiry', () => {
	const u = makeUser(kit, { email: 'cal-exp@x.c', passwordHash: 'x', displayName: 'Cal' });

	const expiresAt = '2030-01-01T00:00:00Z';
	const token = _regenerateUserCalendarToken(u.id, expiresAt);

	const row = kit.selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!;
	expect(row.calendar_token).toBe(token);
	expect(row.calendar_token_expires_at).toBe(expiresAt);
});

test('regenerateCalendarToken action sets a flash cookie and redirects', async () => {
	const u = makeUser(kit, { email: 'cal-action@x.c', passwordHash: 'x', displayName: 'Cal' });
	const cookies = { set: vi.fn(), get: vi.fn() };
	const request = new Request('http://x/profile', {
		method: 'POST',
		body: new URLSearchParams({ calendarExpiresAt: '2030-01-01T00:00:00Z' })
	});
	const locals = { user: u } as App.Locals;
	await expect(actions.regenerateCalendarToken({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/profile'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'Calendar feed URL regenerated.', expect.any(Object));
	const row = kit.selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!;
	expect(row.calendar_token).toBeTruthy();
	expect(row.calendar_token_expires_at).toBe('2030-01-01T00:00:00Z');
});

test('change email requires current password and updates the email', async () => {
	const initialHash = await hashPassword('oldsecret');
	const u = makeUser(kit, { email: 'old@x.c', passwordHash: initialHash, displayName: 'U', timezone: 'UTC' });

	await _changeEmail(u.id, {
		currentPassword: 'oldsecret',
		newEmail: 'new@x.c',
		confirmEmail: 'new@x.c'
	});

	const row = kit.selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!;
	expect(row.email).toBe('new@x.c');

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('email_change');
	expect(logs[0].entity_type).toBe('user');
});

test('change email rejects a duplicate email', async () => {
	const initialHash = await hashPassword('oldsecret');
	const a = makeUser(kit, { email: 'dup-a@x.c', passwordHash: initialHash, displayName: 'A', timezone: 'UTC' });
	kit.insertInto(users)
		.values({ email: 'dup-b@x.c', password_hash: initialHash, display_name: 'B' })
		.executeSync();

	await expect(
		_changeEmail(a.id, { currentPassword: 'oldsecret', newEmail: 'dup-b@x.c', confirmEmail: 'dup-b@x.c' })
	).rejects.toThrow('That email is already in use.');
});

test('change email rejects wrong current password', async () => {
	const initialHash = await hashPassword('oldsecret');
	const u = makeUser(kit, { email: 'wrong@x.c', passwordHash: initialHash, displayName: 'U', timezone: 'UTC' });

	await expect(
		_changeEmail(u.id, { currentPassword: 'nope', newEmail: 'new@x.c', confirmEmail: 'new@x.c' })
	).rejects.toThrow('Current password is incorrect');
});

test('change email rejects mismatched confirmation', async () => {
	const initialHash = await hashPassword('oldsecret');
	const u = makeUser(kit, { email: 'mismatch@x.c', passwordHash: initialHash, displayName: 'U', timezone: 'UTC' });

	await expect(
		_changeEmail(u.id, { currentPassword: 'oldsecret', newEmail: 'new@x.c', confirmEmail: 'other@x.c' })
	).rejects.toThrow('Email addresses do not match.');
});

test('changeEmail action sets a flash cookie and redirects', async () => {
	const initialHash = await hashPassword('oldsecret');
	const u = makeUser(kit, { email: 'action@x.c', passwordHash: initialHash, displayName: 'U', timezone: 'UTC' });
	const cookies = { set: vi.fn(), get: vi.fn() };
	const request = new Request('http://x/profile', {
		method: 'POST',
		body: new URLSearchParams({
			currentPassword: 'oldsecret',
			newEmail: 'changed@x.c',
			confirmEmail: 'changed@x.c'
		})
	});
	const locals = { user: u } as App.Locals;
	await expect(actions.changeEmail({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/profile'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'Email changed.', expect.any(Object));
	expect(kit.selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!.email).toBe('changed@x.c');
});


test('addEmergencyContact action creates a contact and redirects', async () => {
	const u = makeTestUser({ email: 'ec-action@x.c', passwordHash: 'x', displayName: 'U', timezone: 'UTC' });
	const cookies = { set: vi.fn(), get: vi.fn() };
	const request = new Request('http://x/profile', {
		method: 'POST',
		body: new URLSearchParams({
			name: 'Sam Doe',
			relationship: 'sibling',
			phone: '+1-555-0199',
			email: 'sam@x.c',
			isPrimary: 'on'
		})
	});
	const locals = { user: u } as unknown as App.Locals;
	await expect(actions.addEmergencyContact({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/profile'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'Emergency contact added.', expect.any(Object));
	const row = kit.selectFrom(emergencyContacts).executeSync()[0]!;
	expect(row.name).toBe('Sam Doe');
	expect(row.is_primary).toBe(true);
});

test('updateEmergencyContact action edits a contact and redirects', async () => {
	const u = makeTestUser({ email: 'ec-update-action@x.c', passwordHash: 'x', displayName: 'U', timezone: 'UTC' });
	const c = profileRepo.createEmergencyContact(Number(u.id), { name: 'Old', phone: '000', isPrimary: false });
	const cookies = { set: vi.fn(), get: vi.fn() };
	const request = new Request('http://x/profile', {
		method: 'POST',
		body: new URLSearchParams({
			id: String(c.id),
			name: 'New Name',
			relationship: '',
			phone: '111',
			email: '',
			isPrimary: 'on'
		})
	});
	const locals = { user: u } as unknown as App.Locals;
	await expect(actions.updateEmergencyContact({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/profile'
	});
	const row = kit.selectFrom(emergencyContacts).where(eq(emergencyContacts.id, BigInt(c.id))).executeSync()[0]!;
	expect(row.name).toBe('New Name');
	expect(row.phone).toBe('111');
	expect(row.is_primary).toBe(true);
});

test('deleteEmergencyContact action removes a contact and redirects', async () => {
	const u = makeTestUser({ email: 'ec-delete-action@x.c', passwordHash: 'x', displayName: 'U', timezone: 'UTC' });
	const c = profileRepo.createEmergencyContact(Number(u.id), { name: 'Remove me', isPrimary: false });
	const cookies = { set: vi.fn(), get: vi.fn() };
	const request = new Request('http://x/profile', {
		method: 'POST',
		body: new URLSearchParams({ id: String(c.id) })
	});
	const locals = { user: u } as unknown as App.Locals;
	await expect(actions.deleteEmergencyContact({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/profile'
	});
	expect(kit.selectFrom(emergencyContacts).where(eq(emergencyContacts.id, BigInt(c.id))).executeSync()[0]).toBeUndefined();
});

test('emergency contact actions reject invalid contact ids', async () => {
	const u = makeTestUser({ email: 'ec-invalid@x.c', passwordHash: 'x', displayName: 'U', timezone: 'UTC' });
	const cookies = { set: vi.fn(), get: vi.fn() };

	const updateRequest = new Request('http://x/profile', {
		method: 'POST',
		body: new URLSearchParams({ id: 'not-a-number', name: 'X' })
	});
	const updateResult = await actions.updateEmergencyContact({ request: updateRequest, locals: { user: u }, cookies } as any);
	expect(updateResult?.status).toBe(400);

	const deleteRequest = new Request('http://x/profile', {
		method: 'POST',
		body: new URLSearchParams({ id: 'not-a-number' })
	});
	const deleteResult = await actions.deleteEmergencyContact({ request: deleteRequest, locals: { user: u }, cookies } as any);
	expect(deleteResult?.status).toBe(400);
});
