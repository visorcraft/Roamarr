import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _addDocument, load, actions } from './+page.server';
import { users, travelDocuments, trips, tripCompanions, auditLogs } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

function formData(obj: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(obj)) f.append(k, v);
	return f;
}

function makeEvent(form: FormData, userId = 1) {
	return {
		request: new Request('http://localhost/profile/documents', { method: 'POST', body: form }),
		locals: { user: { id: userId } }
	} as any;
}

test('visa is accepted as a travel-document type', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'visa@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const doc = _addDocument(u.id, { type: 'visa', issuingAuthority: 'US Embassy', expiresOn: '2027-01-01' });
	expect(doc.type).toBe('visa');
	const row = db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).get()!;
	expect(row.type).toBe('visa');
});

test('add action creates a document linked to a companion', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const trip = db.insert(trips).values({ ownerId: u.id, name: 'Paris' }).returning().get();
	const companion = db
		.insert(tripCompanions)
		.values({ tripId: trip.id, name: 'Alex' })
		.returning()
		.get();

	const form = formData({
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
	const u = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const trip = db.insert(trips).values({ ownerId: u.id, name: 'Tokyo' }).returning().get();
	const companion = db
		.insert(tripCompanions)
		.values({ tripId: trip.id, name: 'Sam' })
		.returning()
		.get();
	db.insert(travelDocuments)
		.values({
			userId: u.id,
			companionId: companion.id,
			type: 'passport',
			expiresOn: '2031-06-01'
		})
		.run();

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
	const u = db.insert(users).values({ email: 'c@x.c', passwordHash: 'x', displayName: 'C' }).returning().get();
	const other = db.insert(users).values({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const otherTrip = db.insert(trips).values({ ownerId: other.id, name: 'Madrid' }).returning().get();
	const otherCompanion = db
		.insert(tripCompanions)
		.values({ tripId: otherTrip.id, name: 'Jordan' })
		.returning()
		.get();

	const form = formData({
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
	const u = db.insert(users).values({ email: 'd@x.c', passwordHash: 'x', displayName: 'D' }).returning().get();
	const form = formData({ type: 'not_a_type', number: 'P000' });

	const result = await actions.add(makeEvent(form, u.id));
	expect(result).toMatchObject({ status: 400, data: { error: expect.any(String) } });
	expect(db.select().from(travelDocuments).where(eq(travelDocuments.userId, u.id)).all()).toHaveLength(0);
});

test('update action changes a document and its companion', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'e@x.c', passwordHash: 'x', displayName: 'E' }).returning().get();
	const trip = db.insert(trips).values({ ownerId: u.id, name: 'Rome' }).returning().get();
	const companion1 = db.insert(tripCompanions).values({ tripId: trip.id, name: 'Riley' }).returning().get();
	const companion2 = db.insert(tripCompanions).values({ tripId: trip.id, name: 'Quinn' }).returning().get();

	const doc = _addDocument(u.id, {
		type: 'passport',
		companionId: companion1.id,
		expiresOn: '2030-01-01'
	});

	const form = formData({
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
	const u = db.insert(users).values({ email: 'f@x.c', passwordHash: 'x', displayName: 'F' }).returning().get();
	const doc = _addDocument(u.id, { type: 'passport', number: 'OLDNUM' });

	const form = formData({ id: String(doc.id), type: 'passport', number: 'NEWSECRET' });
	await expect(actions.update(makeEvent(form, u.id))).rejects.toMatchObject({ status: 303 });

	const row = db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).get()!;
	expect(row.number).not.toBe('NEWSECRET');
	expect(row.number).not.toBe('OLDNUM');
	expect(typeof row.number).toBe('string');
});

test('delete action removes the document', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'g@x.c', passwordHash: 'x', displayName: 'G' }).returning().get();
	const doc = _addDocument(u.id, { type: 'passport' });

	const form = formData({ id: String(doc.id) });
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
	const u = db.insert(users).values({ email: 'h@x.c', passwordHash: 'x', displayName: 'H' }).returning().get();
	const other = db.insert(users).values({ email: 'i@x.c', passwordHash: 'x', displayName: 'I' }).returning().get();
	const doc = _addDocument(other.id, { type: 'passport' });

	const form = formData({ id: String(doc.id), type: 'visa' });
	await expect(actions.update(makeEvent(form, u.id))).rejects.toMatchObject({ status: 404 });

	const row = db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).get()!;
	expect(row.type).toBe('passport');
});

test('delete action rejects access to another users document', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'j@x.c', passwordHash: 'x', displayName: 'J' }).returning().get();
	const other = db.insert(users).values({ email: 'k@x.c', passwordHash: 'x', displayName: 'K' }).returning().get();
	const doc = _addDocument(other.id, { type: 'passport' });

	const form = formData({ id: String(doc.id) });
	await expect(actions.delete(makeEvent(form, u.id))).rejects.toMatchObject({ status: 404 });

	expect(db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).all()).toHaveLength(1);
});

test('add action rejects an invalid companionId format', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'l@x.c', passwordHash: 'x', displayName: 'L' }).returning().get();
	const form = formData({ type: 'passport', companionId: 'not-a-number' });

	await expect(actions.add(makeEvent(form, u.id))).rejects.toMatchObject({ status: 400 });
	expect(db.select().from(travelDocuments).where(eq(travelDocuments.userId, u.id)).all()).toHaveLength(0);
});

test('update action rejects an invalid companionId format', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'm@x.c', passwordHash: 'x', displayName: 'M' }).returning().get();
	const doc = _addDocument(u.id, { type: 'passport' });
	const form = formData({ id: String(doc.id), type: 'passport', companionId: '-5' });

	await expect(actions.update(makeEvent(form, u.id))).rejects.toMatchObject({ status: 400 });
	const row = db.select().from(travelDocuments).where(eq(travelDocuments.id, doc.id)).get()!;
	expect(row.companionId).toBeNull();
});
