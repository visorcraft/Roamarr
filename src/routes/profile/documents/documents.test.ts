import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _addDocument, load, actions } from './+page.server';
import {
	users,
	travelDocuments,
	trips,
	tripCompanions,
	auditLogs
} from '$lib/server/db/mongrelSchema';
import { eq, and } from '@mongreldb/kit';
import { makeFormData } from '../../../../tests/eventHelpers';
import { makeKitUser } from '../../../../tests/kitHelpers';
import { makeCompanion as insertCompanion } from '../../../../tests/helpers';
import { createTrip } from '$lib/server/repositories/tripsRepo';

function kitDb(): import('@mongreldb/kit').KitDatabase {
	return (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
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
	kit.deleteFrom(travelDocuments).executeSync();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(tripCompanions).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

function makeEvent(form: FormData, userId = 1) {
	return {
		request: new Request('http://localhost/profile/documents', { method: 'POST', body: form }),
		locals: { user: { id: userId } }
	} as any;
}

test('visa is accepted as a travel-document type', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'visa@x.c', passwordHash: 'x', displayName: 'U' });
	const doc = _addDocument(u.id, {
		type: 'visa',
		issuingAuthority: 'US Embassy',
		expiresOn: '2027-01-01'
	});
	expect(doc.type).toBe('visa');
	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(row.type).toBe('visa');
});

test('add action creates a document linked to a companion', async () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	const trip = createTrip(u.id, { name: 'Paris' });
	const companion = makeCompanion(trip.id, 'Alex');

	const form = makeFormData({
		type: 'passport',
		number: 'P12345',
		issuingAuthority: 'US State Dept',
		expiresOn: '2030-01-01',
		companionId: String(companion.id)
	});

	await expect(actions.add(makeEvent(form, u.id))).rejects.toMatchObject({
		status: 303,
		location: '/profile/documents'
	});

	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.user_id, BigInt(u.id))).executeSync()[0]!;
	expect(Number(row.companion_id)).toBe(companion.id);
	expect(row.number).not.toBe('P12345');

	const audit = kit
		.selectFrom(auditLogs)
		.where(and(eq(auditLogs.user_id, BigInt(u.id)), eq(auditLogs.action, 'document_create')))
		.executeSync()[0];
	expect(audit).toBeTruthy();
	expect(audit?.entity_type).toBe('document');
	expect(Number(audit?.entity_id)).toBe(Number(row.id));
});

test('load returns documents with companion context', async () => {
	const u = makeTestUser({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' });
	const trip = createTrip(u.id, { name: 'Tokyo' });
	const companion = makeCompanion(trip.id, 'Sam');
	_addDocument(u.id, {
		type: 'passport',
		companionId: companion.id,
		expiresOn: '2031-06-01'
	});

	const data = (await load({ locals: { user: u } } as any)) as {
		documents: { companionId: number | null }[];
		companions: { id: number; name: string }[];
	};
	expect(data.documents).toHaveLength(1);
	expect(data.documents[0].companionId).toBe(companion.id);
	expect(data.companions).toHaveLength(1);
	expect(data.companions[0].name).toBe('Sam');
});

test('add action rejects a companion from another user', async () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'c@x.c', passwordHash: 'x', displayName: 'C' });
	const other = makeTestUser({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' });
	const otherTrip = createTrip(other.id, { name: 'Madrid' });
	const otherCompanion = makeCompanion(otherTrip.id, 'Jordan');

	const form = makeFormData({
		type: 'passport',
		number: 'P999',
		companionId: String(otherCompanion.id)
	});

	await expect(actions.add(makeEvent(form, u.id))).rejects.toMatchObject({
		status: 404
	});

	expect(kit.selectFrom(travelDocuments).where(eq(travelDocuments.user_id, BigInt(u.id))).executeSync()).toHaveLength(0);
});

test('add action rejects an invalid document type', async () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'd@x.c', passwordHash: 'x', displayName: 'D' });
	const form = makeFormData({ type: 'not_a_type', number: 'P000' });

	const result = await actions.add(makeEvent(form, u.id));
	expect(result).toMatchObject({ status: 400, data: { error: expect.any(String) } });
	expect(kit.selectFrom(travelDocuments).where(eq(travelDocuments.user_id, BigInt(u.id))).executeSync()).toHaveLength(0);
});

test('update action changes a document and its companion', async () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'e@x.c', passwordHash: 'x', displayName: 'E' });
	const trip = createTrip(u.id, { name: 'Rome' });
	const companion1 = makeCompanion(trip.id, 'Riley');
	const companion2 = makeCompanion(trip.id, 'Quinn');

	const doc = _addDocument(u.id, {
		type: 'passport',
		companionId: companion1.id,
		expiresOn: '2030-01-01'
	});

	const form = makeFormData({
		id: String(doc.id),
		type: 'visa',
		number: 'V54321',
		issuingAuthority: 'Italian Consulate',
		expiresOn: '2031-12-31',
		companionId: String(companion2.id),
		notes: 'Updated note'
	});

	await expect(actions.update(makeEvent(form, u.id))).rejects.toMatchObject({
		status: 303,
		location: '/profile/documents'
	});

	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(row.type).toBe('visa');
	expect(row.number).not.toBe('V54321');
	expect(row.issuing_authority).toBe('Italian Consulate');
	expect(row.expires_on).toBe('2031-12-31');
	expect(Number(row.companion_id)).toBe(companion2.id);
	expect(row.notes).toBe('Updated note');

	const audit = kit
		.selectFrom(auditLogs)
		.where(and(eq(auditLogs.user_id, BigInt(u.id)), eq(auditLogs.action, 'document_update')))
		.executeSync()[0];
	expect(audit).toBeTruthy();
	expect(Number(audit?.entity_id)).toBe(doc.id);
});

test('update action encrypts the document number', async () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'f@x.c', passwordHash: 'x', displayName: 'F' });
	const doc = _addDocument(u.id, { type: 'passport', number: 'OLDNUM' });

	const form = makeFormData({ id: String(doc.id), type: 'passport', number: 'NEWSECRET' });
	await expect(actions.update(makeEvent(form, u.id))).rejects.toMatchObject({ status: 303 });

	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(row.number).not.toBe('NEWSECRET');
	expect(row.number).not.toBe('OLDNUM');
	expect(typeof row.number).toBe('string');
});

test('delete action removes the document', async () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'g@x.c', passwordHash: 'x', displayName: 'G' });
	const doc = _addDocument(u.id, { type: 'passport' });

	const form = makeFormData({ id: String(doc.id) });
	await expect(actions.delete(makeEvent(form, u.id))).rejects.toMatchObject({
		status: 303,
		location: '/profile/documents'
	});

	expect(kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()).toHaveLength(0);

	const audit = kit
		.selectFrom(auditLogs)
		.where(and(eq(auditLogs.user_id, BigInt(u.id)), eq(auditLogs.action, 'document_delete')))
		.executeSync()[0];
	expect(audit).toBeTruthy();
	expect(Number(audit?.entity_id)).toBe(doc.id);
});

test('update action rejects access to another users document', async () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'h@x.c', passwordHash: 'x', displayName: 'H' });
	const other = makeTestUser({ email: 'i@x.c', passwordHash: 'x', displayName: 'I' });
	const doc = _addDocument(other.id, { type: 'passport' });

	const form = makeFormData({ id: String(doc.id), type: 'visa' });
	await expect(actions.update(makeEvent(form, u.id))).rejects.toMatchObject({ status: 404 });

	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(row.type).toBe('passport');
});

test('delete action rejects access to another users document', async () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'j@x.c', passwordHash: 'x', displayName: 'J' });
	const other = makeTestUser({ email: 'k@x.c', passwordHash: 'x', displayName: 'K' });
	const doc = _addDocument(other.id, { type: 'passport' });

	const form = makeFormData({ id: String(doc.id) });
	await expect(actions.delete(makeEvent(form, u.id))).rejects.toMatchObject({ status: 404 });

	expect(kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()).toHaveLength(1);
});

test('add action rejects an invalid companionId format', async () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'l@x.c', passwordHash: 'x', displayName: 'L' });
	const form = makeFormData({ type: 'passport', companionId: 'not-a-number' });

	await expect(actions.add(makeEvent(form, u.id))).rejects.toMatchObject({ status: 400 });
	expect(kit.selectFrom(travelDocuments).where(eq(travelDocuments.user_id, BigInt(u.id))).executeSync()).toHaveLength(0);
});

test('update action rejects an invalid companionId format', async () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'm@x.c', passwordHash: 'x', displayName: 'M' });
	const doc = _addDocument(u.id, { type: 'passport' });
	const form = makeFormData({ id: String(doc.id), type: 'passport', companionId: '-5' });

	await expect(actions.update(makeEvent(form, u.id))).rejects.toMatchObject({ status: 400 });
	const row = kit.selectFrom(travelDocuments).where(eq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	// Kit returns 0n for an unset nullable int column, not null.
	expect(row.companion_id).toBeFalsy();
});
