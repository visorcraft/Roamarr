import { createHash } from 'node:crypto';
import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('$lib/server/db').DB,
	sqlite: null as unknown as import('better-sqlite3').Database,
	kit: null as unknown as import('@mongreldb/kit').KitDatabase
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
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
import { users, travelDocuments, loyaltyPrograms, sessions, auditLogs, emergencyContacts } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { eq } from 'drizzle-orm';
import { createSession, hashPassword, verifyPassword } from '$lib/server/auth';
import {
	travelDocuments as kitTravelDocuments,
	loyaltyPrograms as kitLoyaltyPrograms,
	emergencyContacts as kitEmergencyContacts,
	users as kitUsers
} from '$lib/server/db/mongrelSchema';
import { beforeEach } from 'vitest';
import { makeKitUser } from '../../../tests/kitHelpers';
import * as profileRepo from '$lib/server/repositories/profileRepo';

function makeTestUser(over: Partial<typeof users.$inferInsert> = {}) {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const kitUser = makeKitUser({
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
	return db.select().from(users).where(eq(users.id, Number(kitUser.id))).get()!;
}

beforeEach(() => {
	(ctx as any).sqlite.exec(
		'delete from audit_logs; delete from emergency_contacts; delete from loyalty_programs; delete from travel_documents; delete from sessions; delete from users;'
	);
	(ctx as any).kit.deleteFrom(kitEmergencyContacts).executeSync();
	(ctx as any).kit.deleteFrom(kitLoyaltyPrograms).executeSync();
	(ctx as any).kit.deleteFrom(kitTravelDocuments).executeSync();
	(ctx as any).kit.deleteFrom(kitUsers).executeSync();
});

test('document number is encrypted at rest and arms a reminder', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	addDocument(u.id, {
		type: 'passport',
		number: 'X1234567',
		issuingAuthority: 'US',
		expiresOn: '2030-01-01'
	});
	const row = db.select().from(travelDocuments).get()!;
	expect(row.number).not.toBe('X1234567');
	expect(decrypt(row.number!)).toBe('X1234567');
	expect(upsertRemindersForDocument).toHaveBeenCalled();
});

test('updateProgram edits a loyalty program and is user-scoped', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeTestUser({ email: 'loyal-a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeTestUser({ email: 'loyal-b@x.c', passwordHash: 'x', displayName: 'B' });
	const program = profileRepo.createLoyaltyProgram(a.id, {
		programName: 'Old',
		membershipNumber: '123',
		balance: 1000,
		notes: 'old note'
	});
	updateProgram(a.id, program.id, {
		programName: 'United MileagePlus',
		membershipNumber: 'UA999',
		balance: 5000,
		notes: 'new note'
	});
	const row = db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.id, program.id)).get()!;
	expect(row.programName).toBe('United MileagePlus');
	expect(row.membershipNumber).toBe('UA999');
	expect(row.balance).toBe(5000);
	expect(row.notes).toBe('new note');

	expect(() => updateProgram(b.id, program.id, { programName: 'Hacked' })).toThrow(
		expect.objectContaining({ status: 404, body: { message: 'Not found' } })
	);
	const unchanged = db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.id, program.id)).get()!;
	expect(unchanged.programName).toBe('United MileagePlus');
});

test('update profile changes display name, timezone and reminder leads', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'p1@x.c', passwordHash: 'x', displayName: 'P1', timezone: 'UTC' })
		.returning()
		.get();
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
	const row = db.select().from(users).where(eq(users.id, u.id)).get()!;
	expect(row.displayName).toBe('Ada');
	expect(row.timezone).toBe('America/New_York');
	expect(row.flightCheckinLeadHours).toBe(48);
	expect(row.documentExpiryLeadDays).toBe(60);
	expect(row.themeId).toBe('vibes');
	expect(row.defaultCurrency).toBe('EUR');
});

test('update profile rejects invalid timezone', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'p2@x.c', passwordHash: 'x', displayName: 'P2', timezone: 'UTC' })
		.returning()
		.get();
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
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'p-lead@x.c', passwordHash: 'x', displayName: 'P', timezone: 'UTC' })
		.returning()
		.get();
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
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'p-theme@x.c', passwordHash: 'x', displayName: 'P', timezone: 'UTC' })
		.returning()
		.get();
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
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'p-currency@x.c', passwordHash: 'x', displayName: 'P', timezone: 'UTC' })
		.returning()
		.get();
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
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const u = db
		.insert(users)
		.values({
			email: 'p3@x.c',
			passwordHash: initialHash,
			displayName: 'P3',
			timezone: 'UTC'
		})
		.returning()
		.get();
	await _updatePassword(u.id, 'current-token', {
		oldPassword: 'oldsecret',
		newPassword: 'newsecret1',
		confirmPassword: 'newsecret1'
	});
	const row = db.select().from(users).where(eq(users.id, u.id)).get()!;
	expect(await verifyPassword(row.passwordHash, 'newsecret1')).toBe(true);
	expect(await verifyPassword(row.passwordHash, 'oldsecret')).toBe(false);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('password_change');
	expect(logs[0].entityType).toBe('user');
	expect(logs[0].entityId).toBe(u.id);
});

test('update password rejects wrong old password', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const u = db
		.insert(users)
		.values({
			email: 'p4@x.c',
			passwordHash: initialHash,
			displayName: 'P4',
			timezone: 'UTC'
		})
		.returning()
		.get();
	await expect(
		_updatePassword(u.id, 'current-token', {
			oldPassword: 'wrong',
			newPassword: 'newsecret1',
			confirmPassword: 'newsecret1'
		})
	).rejects.toThrow('Current password is incorrect');
});

test('update password rejects mismatched confirmation', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const u = db
		.insert(users)
		.values({
			email: 'p5@x.c',
			passwordHash: initialHash,
			displayName: 'P5',
			timezone: 'UTC'
		})
		.returning()
		.get();
	await expect(
		_updatePassword(u.id, 'current-token', {
			oldPassword: 'oldsecret',
			newPassword: 'newsecret1',
			confirmPassword: 'different'
		})
	).rejects.toThrow('New passwords do not match');
});

test('update password enforces password policy', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const u = db
		.insert(users)
		.values({
			email: 'p6@x.c',
			passwordHash: initialHash,
			displayName: 'P6',
			timezone: 'UTC'
		})
		.returning()
		.get();
	await expect(
		_updatePassword(u.id, 'current-token', { oldPassword: 'oldsecret', newPassword: 'short', confirmPassword: 'short' })
	).rejects.toThrow();
});

test('update password invalidates all other sessions for the user', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const kitUser = makeKitUser({
		email: 'p7@x.c',
		password_hash: initialHash,
		display_name: 'P7',
		timezone: 'UTC'
	});
	const u = db.select().from(users).where(eq(users.id, Number(kitUser.id))).get()!;
	const currentToken = createSession(u.id);
	createSession(u.id);
	createSession(u.id);
	expect(db.select().from(sessions).where(eq(sessions.userId, u.id)).all()).toHaveLength(3);

	await _updatePassword(u.id, currentToken, {
		oldPassword: 'oldsecret',
		newPassword: 'newsecret1',
		confirmPassword: 'newsecret1'
	});

	const remaining = db.select().from(sessions).where(eq(sessions.userId, u.id)).all();
	expect(remaining).toHaveLength(1);
	expect(remaining[0].tokenHash).toBe(
		createHash('sha256').update(currentToken).digest('hex')
	);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('password_change');
});

test('updateProfile action sets a flash cookie and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'p-action@x.c', passwordHash: 'x', displayName: 'P', timezone: 'UTC' })
		.returning()
		.get();
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
	expect(db.select().from(users).where(eq(users.id, u.id)).get()!.themeId).toBe('red-velvet');
});

test('updatePassword action sets a flash cookie and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const u = db
		.insert(users)
		.values({ email: 'p-pw-action@x.c', passwordHash: initialHash, displayName: 'P', timezone: 'UTC' })
		.returning()
		.get();
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
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'cal@x.c', passwordHash: 'x', displayName: 'Cal', calendarToken: 'old-token' })
		.returning()
		.get();

	const token = _regenerateUserCalendarToken(u.id);
	expect(token).not.toBe('old-token');
	expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

	const row = db.select().from(users).where(eq(users.id, u.id)).get()!;
	expect(row.calendarToken).toBe(token);
	expect(row.calendarTokenExpiresAt).toBeNull();

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('calendar_token_regenerate');
	expect(logs[0].entityType).toBe('user');
});

test('regenerate user calendar token can set an expiry', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'cal-exp@x.c', passwordHash: 'x', displayName: 'Cal' })
		.returning()
		.get();

	const expiresAt = '2030-01-01T00:00:00Z';
	const token = _regenerateUserCalendarToken(u.id, expiresAt);

	const row = db.select().from(users).where(eq(users.id, u.id)).get()!;
	expect(row.calendarToken).toBe(token);
	expect(row.calendarTokenExpiresAt).toBe(expiresAt);
});

test('regenerateCalendarToken action sets a flash cookie and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'cal-action@x.c', passwordHash: 'x', displayName: 'Cal' })
		.returning()
		.get();
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
	const row = db.select().from(users).where(eq(users.id, u.id)).get()!;
	expect(row.calendarToken).toBeTruthy();
	expect(row.calendarTokenExpiresAt).toBe('2030-01-01T00:00:00Z');
});

test('change email requires current password and updates the email', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const u = db
		.insert(users)
		.values({ email: 'old@x.c', passwordHash: initialHash, displayName: 'U', timezone: 'UTC' })
		.returning()
		.get();

	await _changeEmail(u.id, {
		currentPassword: 'oldsecret',
		newEmail: 'new@x.c',
		confirmEmail: 'new@x.c'
	});

	const row = db.select().from(users).where(eq(users.id, u.id)).get()!;
	expect(row.email).toBe('new@x.c');

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('email_change');
	expect(logs[0].entityType).toBe('user');
});

test('change email rejects a duplicate email', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const a = db
		.insert(users)
		.values({ email: 'dup-a@x.c', passwordHash: initialHash, displayName: 'A', timezone: 'UTC' })
		.returning()
		.get();
	db.insert(users)
		.values({ email: 'dup-b@x.c', passwordHash: initialHash, displayName: 'B', timezone: 'UTC' })
		.returning()
		.get();

	await expect(
		_changeEmail(a.id, { currentPassword: 'oldsecret', newEmail: 'dup-b@x.c', confirmEmail: 'dup-b@x.c' })
	).rejects.toThrow('That email is already in use.');
});

test('change email rejects wrong current password', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const u = db
		.insert(users)
		.values({ email: 'wrong@x.c', passwordHash: initialHash, displayName: 'U', timezone: 'UTC' })
		.returning()
		.get();

	await expect(
		_changeEmail(u.id, { currentPassword: 'nope', newEmail: 'new@x.c', confirmEmail: 'new@x.c' })
	).rejects.toThrow('Current password is incorrect');
});

test('change email rejects mismatched confirmation', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const u = db
		.insert(users)
		.values({ email: 'mismatch@x.c', passwordHash: initialHash, displayName: 'U', timezone: 'UTC' })
		.returning()
		.get();

	await expect(
		_changeEmail(u.id, { currentPassword: 'oldsecret', newEmail: 'new@x.c', confirmEmail: 'other@x.c' })
	).rejects.toThrow('Email addresses do not match.');
});

test('changeEmail action sets a flash cookie and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const initialHash = await hashPassword('oldsecret');
	const u = db
		.insert(users)
		.values({ email: 'action@x.c', passwordHash: initialHash, displayName: 'U', timezone: 'UTC' })
		.returning()
		.get();
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
	expect(db.select().from(users).where(eq(users.id, u.id)).get()!.email).toBe('changed@x.c');
});


test('addEmergencyContact action creates a contact and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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
	const locals = { user: u } as App.Locals;
	await expect(actions.addEmergencyContact({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/profile'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'Emergency contact added.', expect.any(Object));
	const row = db.select().from(emergencyContacts).get()!;
	expect(row.name).toBe('Sam Doe');
	expect(row.isPrimary).toBe(true);
});

test('updateEmergencyContact action edits a contact and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'ec-update-action@x.c', passwordHash: 'x', displayName: 'U', timezone: 'UTC' });
	const c = profileRepo.createEmergencyContact(u.id, { name: 'Old', phone: '000', isPrimary: false });
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
	const locals = { user: u } as App.Locals;
	await expect(actions.updateEmergencyContact({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/profile'
	});
	const row = db.select().from(emergencyContacts).where(eq(emergencyContacts.id, c.id)).get()!;
	expect(row.name).toBe('New Name');
	expect(row.phone).toBe('111');
	expect(row.isPrimary).toBe(true);
});

test('deleteEmergencyContact action removes a contact and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'ec-delete-action@x.c', passwordHash: 'x', displayName: 'U', timezone: 'UTC' });
	const c = profileRepo.createEmergencyContact(u.id, { name: 'Remove me', isPrimary: false });
	const cookies = { set: vi.fn(), get: vi.fn() };
	const request = new Request('http://x/profile', {
		method: 'POST',
		body: new URLSearchParams({ id: String(c.id) })
	});
	const locals = { user: u } as App.Locals;
	await expect(actions.deleteEmergencyContact({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/profile'
	});
	expect(db.select().from(emergencyContacts).where(eq(emergencyContacts.id, c.id)).get()).toBeUndefined();
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
