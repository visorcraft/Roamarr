import { createHash } from 'node:crypto';
import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
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
import { _updateProgram as updateProgram } from './loyalty/+page.server';
import { _updateProfile, _updatePassword } from './+page.server';
import { upsertRemindersForDocument } from '$lib/server/reminders';
import { users, travelDocuments, loyaltyPrograms, sessions, auditLogs } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { eq } from 'drizzle-orm';
import { createSession, hashPassword, verifyPassword } from '$lib/server/auth';

test('document number is encrypted at rest and arms a reminder', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
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
	const a = db
		.insert(users)
		.values({ email: 'loyal-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'loyal-b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const program = db
		.insert(loyaltyPrograms)
		.values({
			userId: a.id,
			programName: 'Old',
			membershipNumber: '123',
			balance: 1000,
			notes: 'old note'
		})
		.returning()
		.get();
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

	updateProgram(b.id, program.id, { programName: 'Hacked' });
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
		documentExpiryLeadDays: 60
	});
	const row = db.select().from(users).where(eq(users.id, u.id)).get()!;
	expect(row.displayName).toBe('Ada');
	expect(row.timezone).toBe('America/New_York');
	expect(row.flightCheckinLeadHours).toBe(48);
	expect(row.documentExpiryLeadDays).toBe(60);
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
			documentExpiryLeadDays: 90
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
			documentExpiryLeadDays: 90
		})
	).toThrow('Flight check-in lead must be a non-negative integer');
	expect(() =>
		_updateProfile(u.id, {
			displayName: 'P',
			timezone: 'UTC',
			flightCheckinLeadHours: 24,
			documentExpiryLeadDays: 1.5
		})
	).toThrow('Document expiry lead must be a non-negative integer');
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
	const u = db
		.insert(users)
		.values({
			email: 'p7@x.c',
			passwordHash: initialHash,
			displayName: 'P7',
			timezone: 'UTC'
		})
		.returning()
		.get();
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
