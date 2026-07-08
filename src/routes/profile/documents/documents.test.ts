import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	users,
	travelDocuments,
	trips,
	tripCompanions,
	auditLogs
} from '$lib/server/db/mongrelSchema';
import { eq, and } from '@visorcraft/mongreldb-kit';
import { makeKitUser } from '../../../../tests/kitHelpers';
import { makeCompanion as insertCompanion } from '../../../../tests/helpers';
import { createTrip } from '$lib/server/repositories/tripsRepo';
import { addDocument, updateDocument } from '$lib/server/travelDocuments';
import { reminders } from '$lib/server/db/mongrelSchema';

function kitDb(): import('@visorcraft/mongreldb-kit').KitDatabase {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

function makeTestUser(over: any = {}) {
	const kit = kitDb();
	const kitUser = makeKitUser({
		email: over.email,
		password_hash: over.passwordHash,
		display_name: over.displayName,
		role: (over.role as 'admin' | 'user') ?? 'user',
		timezone: over.timezone ?? 'UTC'
	});
	const row = kit.selectFrom(users).where(eq(users.id, kitUser.id)).executeSync()[0]!;
	return { ...row, id: Number(row.id) };
}

function makeCompanion(tripId: number, name: string) {
	return insertCompanion(kitDb(), tripId, { name });
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(reminders).executeSync();
	kit.deleteFrom(travelDocuments).executeSync();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(tripCompanions).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('visa is accepted as a travel-document type', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'visa@x.c', passwordHash: 'x', displayName: 'U' });
	const doc = addDocument(u.id, {
		type: 'visa',
		issuingAuthority: 'US Embassy',
		expiresOn: '2027-01-01'
	});
	expect(doc.type).toBe('visa');
	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(row.type).toBe('visa');
});

test('addDocument links a document to an owned companion and encrypts the number', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	const trip = createTrip(u.id, { name: 'Paris' });
	const companion = makeCompanion(trip.id, 'Alex');

	const doc = addDocument(u.id, {
		type: 'passport',
		number: 'P12345',
		issuingAuthority: 'US State Dept',
		expiresOn: '2030-01-01',
		companionId: companion.id
	});

	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(Number(row.companion_id)).toBe(companion.id);
	expect(row.number).not.toBe('P12345');
	expect(typeof row.number).toBe('string');
});

test('addDocument arms an expiry reminder when expiresOn is provided', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'rem@x.c', passwordHash: 'x', displayName: 'R' });
	addDocument(u.id, { type: 'passport', expiresOn: '2030-01-01' });
	const rows = kit.selectFrom(reminders).where(eq(reminders.user_id, BigInt(u.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].kind).toBe('document_expiry');
});

test('addDocument cancels the reminder when expiresOn is omitted', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'norem@x.c', passwordHash: 'x', displayName: 'N' });
	addDocument(u.id, { type: 'passport' });
	expect(kit.selectFrom(reminders).where(eq(reminders.user_id, BigInt(u.id))).executeSync()).toHaveLength(0);
});

test('updateDocument changes a document and its companion', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'e@x.c', passwordHash: 'x', displayName: 'E' });
	const trip = createTrip(u.id, { name: 'Rome' });
	const companion1 = makeCompanion(trip.id, 'Riley');
	const companion2 = makeCompanion(trip.id, 'Quinn');

	const doc = addDocument(u.id, {
		type: 'passport',
		companionId: companion1.id,
		expiresOn: '2030-01-01'
	});

	updateDocument(u.id, doc.id, {
		type: 'visa',
		number: 'V54321',
		issuingAuthority: 'Italian Consulate',
		expiresOn: '2031-12-31',
		companionId: companion2.id,
		notes: 'Updated note'
	});

	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(row.type).toBe('visa');
	expect(row.number).not.toBe('V54321');
	expect(row.issuing_authority).toBe('Italian Consulate');
	expect(row.expires_on).toBe('2031-12-31');
	expect(Number(row.companion_id)).toBe(companion2.id);
	expect(row.notes).toBe('Updated note');
});

test('updateDocument encrypts the document number', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'f@x.c', passwordHash: 'x', displayName: 'F' });
	const doc = addDocument(u.id, { type: 'passport', number: 'OLDNUM' });

	updateDocument(u.id, doc.id, { type: 'passport', number: 'NEWSECRET' });

	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(row.number).not.toBe('NEWSECRET');
	expect(row.number).not.toBe('OLDNUM');
	expect(typeof row.number).toBe('string');
});

test('updateDocument cannot modify another users document', () => {
	const kit = kitDb();
	const a = makeTestUser({ email: 'g@x.c', passwordHash: 'x', displayName: 'G' });
	const b = makeTestUser({ email: 'h@x.c', passwordHash: 'x', displayName: 'H' });
	const doc = addDocument(a.id, { type: 'passport' });
	expect(() => updateDocument(b.id, doc.id, { type: 'visa' })).toThrow(
		expect.objectContaining({ status: 404 })
	);
	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(row.type).toBe('passport');
});

test('audit log records document_create from the route, not the helper', () => {
	// Sanity: helper itself does not log audit (routes do). Verify no stray logs.
	const kit = kitDb();
	const u = makeTestUser({ email: 'aud@x.c', passwordHash: 'x', displayName: 'A' });
	addDocument(u.id, { type: 'passport' });
	const logs = kit
		.selectFrom(auditLogs)
		.where(and(eq(auditLogs.user_id, BigInt(u.id)), eq(auditLogs.action, 'document_create')))
		.executeSync();
	expect(logs).toHaveLength(0);
});
