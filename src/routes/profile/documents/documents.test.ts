import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('$lib/server/db').DB,
	sqlite: null as unknown as import('better-sqlite3').Database,
	kit: null as unknown as import('@mongreldb/kit').KitDatabase
}));
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
} from '$lib/server/db/schema';
import {
	travelDocuments as kitTravelDocuments,
	tripCompanions as kitTripCompanions,
	users as kitUsers
} from '$lib/server/db/mongrelSchema';
import { eq, and } from 'drizzle-orm';
import { makeFormData } from '../../../../tests/eventHelpers';
import { makeKitUser } from '../../../../tests/kitHelpers';
import { createTrip } from '$lib/server/repositories/tripsRepo';

function makeTestUser(over: Partial<typeof users.$inferInsert> = {}) {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const kitUser = makeKitUser({
		email: over.email,
		password_hash: over.passwordHash,
		display_name: over.displayName,
		role: (over.role as 'admin' | 'user') ?? 'user',
		timezone: over.timezone ?? 'UTC'
	});
	return db.select().from(users).where(eq(users.id, Number(kitUser.id))).get()!;
}

function makeCompanion(tripId: number, name: string) {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const c = db.insert(tripCompanions).values({ tripId, name }).returning().get();
	ctx.kit.insertInto(kitTripCompanions).values({
		id: BigInt(c.id),
		trip_id: BigInt(tripId),
		name
	} as any).executeSync();
	return c;
}

beforeEach(() => {
	ctx.sqlite.exec(
		'delete from travel_documents; delete from audit_logs; delete from trip_companions; delete from trips; delete from users;'
	);
	ctx.kit.deleteFrom(kitTravelDocuments).executeSync();
	ctx.kit.deleteFrom(kitTripCompanions).executeSync();
	ctx.kit.deleteFrom(kitUsers).executeSync();
});

function makeEvent(form: FormData, userId = 1) {
	return {
		request: new Request('http://localhost/profile/documents', { method: 'POST', body: form }),
		locals: { user: { id: userId } }
	} as any;
}

test('visa is accepted as a travel-document type', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'visa@x.c', passwordHash: 'x', displayName: 'U' });
	const doc = _addDocument(u.id, {
		type: 'visa',
		issuingAuthority: 'US Embassy',
		expiresOn: '2027-01-01'
	});
	expect(doc.type).toBe('visa');
	const row = db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).get()!;
	expect(row.type).toBe('visa');
});

test('add action creates a document linked to a companion', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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

	const row = db.select().from(travelDocuments).where(eq(travelDocuments.userId, u.id)).get()!;
	expect(row.companionId).toBe(companion.id);
	expect(row.number).not.toBe('P12345');

	const audit = db
		.select()
		.from(auditLogs)
		.where(and(eq(auditLogs.userId, u.id), eq(auditLogs.action, 'document_create')))
		.get();
	expect(audit).toBeTruthy();
	expect(audit?.entityType).toBe('document');
	expect(audit?.entityId).toBe(row.id);
});

test('load returns documents with companion context', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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

	expect(db.select().from(travelDocuments).where(eq(travelDocuments.userId, u.id)).all()).toHaveLength(0);
});

test('add action rejects an invalid document type', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'd@x.c', passwordHash: 'x', displayName: 'D' });
	const form = makeFormData({ type: 'not_a_type', number: 'P000' });

	const result = await actions.add(makeEvent(form, u.id));
	expect(result).toMatchObject({ status: 400, data: { error: expect.any(String) } });
	expect(db.select().from(travelDocuments).where(eq(travelDocuments.userId, u.id)).all()).toHaveLength(0);
});

test('update action changes a document and its companion', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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

	const row = db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).get()!;
	expect(row.type).toBe('visa');
	expect(row.number).not.toBe('V54321');
	expect(row.issuingAuthority).toBe('Italian Consulate');
	expect(row.expiresOn).toBe('2031-12-31');
	expect(row.companionId).toBe(companion2.id);
	expect(row.notes).toBe('Updated note');

	const audit = db
		.select()
		.from(auditLogs)
		.where(and(eq(auditLogs.userId, u.id), eq(auditLogs.action, 'document_update')))
		.get();
	expect(audit).toBeTruthy();
	expect(audit?.entityId).toBe(doc.id);
});

test('update action encrypts the document number', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'f@x.c', passwordHash: 'x', displayName: 'F' });
	const doc = _addDocument(u.id, { type: 'passport', number: 'OLDNUM' });

	const form = makeFormData({ id: String(doc.id), type: 'passport', number: 'NEWSECRET' });
	await expect(actions.update(makeEvent(form, u.id))).rejects.toMatchObject({ status: 303 });

	const row = db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).get()!;
	expect(row.number).not.toBe('NEWSECRET');
	expect(row.number).not.toBe('OLDNUM');
	expect(typeof row.number).toBe('string');
});

test('delete action removes the document', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'g@x.c', passwordHash: 'x', displayName: 'G' });
	const doc = _addDocument(u.id, { type: 'passport' });

	const form = makeFormData({ id: String(doc.id) });
	await expect(actions.delete(makeEvent(form, u.id))).rejects.toMatchObject({
		status: 303,
		location: '/profile/documents'
	});

	expect(db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).all()).toHaveLength(0);

	const audit = db
		.select()
		.from(auditLogs)
		.where(and(eq(auditLogs.userId, u.id), eq(auditLogs.action, 'document_delete')))
		.get();
	expect(audit).toBeTruthy();
	expect(audit?.entityId).toBe(doc.id);
});

test('update action rejects access to another users document', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'h@x.c', passwordHash: 'x', displayName: 'H' });
	const other = makeTestUser({ email: 'i@x.c', passwordHash: 'x', displayName: 'I' });
	const doc = _addDocument(other.id, { type: 'passport' });

	const form = makeFormData({ id: String(doc.id), type: 'visa' });
	await expect(actions.update(makeEvent(form, u.id))).rejects.toMatchObject({ status: 404 });

	const row = db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).get()!;
	expect(row.type).toBe('passport');
});

test('delete action rejects access to another users document', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'j@x.c', passwordHash: 'x', displayName: 'J' });
	const other = makeTestUser({ email: 'k@x.c', passwordHash: 'x', displayName: 'K' });
	const doc = _addDocument(other.id, { type: 'passport' });

	const form = makeFormData({ id: String(doc.id) });
	await expect(actions.delete(makeEvent(form, u.id))).rejects.toMatchObject({ status: 404 });

	expect(db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).all()).toHaveLength(1);
});

test('add action rejects an invalid companionId format', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'l@x.c', passwordHash: 'x', displayName: 'L' });
	const form = makeFormData({ type: 'passport', companionId: 'not-a-number' });

	await expect(actions.add(makeEvent(form, u.id))).rejects.toMatchObject({ status: 400 });
	expect(db.select().from(travelDocuments).where(eq(travelDocuments.userId, u.id)).all()).toHaveLength(0);
});

test('update action rejects an invalid companionId format', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'm@x.c', passwordHash: 'x', displayName: 'M' });
	const doc = _addDocument(u.id, { type: 'passport' });
	const form = makeFormData({ id: String(doc.id), type: 'passport', companionId: '-5' });

	await expect(actions.update(makeEvent(form, u.id))).rejects.toMatchObject({ status: 400 });
	const row = db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).get()!;
	expect(row.companionId).toBeNull();
});
