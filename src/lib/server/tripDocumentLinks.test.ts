import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	listDocumentLinks,
	createDocumentLink,
	editDocumentLink,
	removeDocumentLink,
	addDocumentLink,
	updateDocumentLink,
	deleteDocumentLink
} from './tripDocumentLinks';
import { users, trips, tripDocumentLinks, auditLogs } from './db/schema';
import { eq } from 'drizzle-orm';
import { makeUser, makeTrip } from '../../../tests/helpers';
import { makeFormEvent } from '../../../tests/eventHelpers';

function formData(entries: Record<string, string>): FormData {
	const f = new FormData();
	for (const [key, value] of Object.entries(entries)) {
		f.set(key, value);
	}
	return f;
}

test('listDocumentLinks returns links ordered by newest first', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'dl@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	createDocumentLink(u.id, t.id, { label: 'First', url: 'https://first.example' });
	createDocumentLink(u.id, t.id, { label: 'Second', url: 'https://second.example' });

	const list = listDocumentLinks(t.id);
	expect(list.map((l) => l.label)).toEqual(['Second', 'First']);
});

test('createDocumentLink inserts a link and audits', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'dl2@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const link = createDocumentLink(u.id, t.id, {
		label: 'Booking',
		url: 'https://booking.example/123',
		notes: 'Confirmation ABC'
	});

	expect(link.label).toBe('Booking');
	expect(link.url).toBe('https://booking.example/123');
	expect(link.notes).toBe('Confirmation ABC');

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('document_link_create');
	expect(logs[0].entityType).toBe('trip_document_link');
});

test('createDocumentLink trims whitespace and stores null for blank notes', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'dl3@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const link = createDocumentLink(u.id, t.id, {
		label: '  Booking  ',
		url: '  https://booking.example/123  ',
		notes: '   '
	});

	expect(link.label).toBe('Booking');
	expect(link.url).toBe('https://booking.example/123');
	expect(link.notes).toBeNull();
});

test('createDocumentLink rejects invalid URLs', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'dl4@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	expect(() => createDocumentLink(u.id, t.id, { label: 'X', url: 'not-a-url' })).toThrow(
		'URL must be a valid http or https URL'
	);
	expect(() => createDocumentLink(u.id, t.id, { label: 'X', url: 'ftp://files.example' })).toThrow(
		'URL must be a valid http or https URL'
	);
});

test('editDocumentLink updates a link and audits', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'dl5@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const link = createDocumentLink(u.id, t.id, { label: 'Old', url: 'https://old.example' });

	const updated = editDocumentLink(u.id, t.id, link.id, {
		label: 'New',
		url: 'https://new.example',
		notes: 'Updated note'
	});

	expect(updated.label).toBe('New');
	expect(updated.url).toBe('https://new.example');
	expect(updated.notes).toBe('Updated note');

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs.some((l) => l.action === 'document_link_update')).toBe(true);
});

test('editDocumentLink is scoped to the trip', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'dl6@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t1 = db.insert(trips).values({ ownerId: u.id, name: 'T1' }).returning().get();
	const t2 = db.insert(trips).values({ ownerId: u.id, name: 'T2' }).returning().get();
	const link = createDocumentLink(u.id, t1.id, { label: 'L', url: 'https://a.example' });

	try {
		editDocumentLink(u.id, t2.id, link.id, { label: 'Hacked', url: 'https://b.example' });
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('removeDocumentLink deletes only the owned trip link', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'dl7-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'dl7-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const link = createDocumentLink(a.id, t.id, { label: 'L', url: 'https://a.example' });

	try {
		removeDocumentLink(b.id, t.id, link.id);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
	expect(db.select().from(tripDocumentLinks).where(eq(tripDocumentLinks.id, link.id)).get()).toBeDefined();

	removeDocumentLink(a.id, t.id, link.id);
	expect(db.select().from(tripDocumentLinks).where(eq(tripDocumentLinks.id, link.id)).get()).toBeUndefined();

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, a.id)).all();
	expect(logs.some((l) => l.action === 'document_link_delete')).toBe(true);
});

test('addDocumentLink action creates a link and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser(db);
	const t = makeTrip(db, { ownerId: u.id });

	const event = makeFormEvent(
		u,
		{ id: String(t.id) },
		{ label: 'Action', url: 'https://action.example', notes: 'N' }
	);
	await expect(addDocumentLink(event)).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const rows = listDocumentLinks(t.id);
	expect(rows).toHaveLength(1);
	expect(rows[0].label).toBe('Action');
});

test('addDocumentLink action returns validation errors', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser(db);
	const t = makeTrip(db, { ownerId: u.id });

	const event = makeFormEvent(u, { id: String(t.id) }, { label: '', url: 'not-a-url' });
	const result = (await addDocumentLink(event)) as {
		status: number;
		data: { error: string; errors?: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors?.label).toBeDefined();
	expect(result.data.errors?.url).toBeDefined();
});

test('updateDocumentLink action updates a link and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser(db);
	const t = makeTrip(db, { ownerId: u.id });
	const link = createDocumentLink(u.id, t.id, { label: 'Old', url: 'https://old.example' });

	const event = makeFormEvent(
		u,
		{ id: String(t.id) },
		{ linkId: String(link.id), label: 'Updated', url: 'https://updated.example', notes: '' }
	);
	await expect(updateDocumentLink(event)).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = db.select().from(tripDocumentLinks).where(eq(tripDocumentLinks.id, link.id)).get();
	expect(row?.label).toBe('Updated');
	expect(row?.url).toBe('https://updated.example');
});

test('deleteDocumentLink action removes a link and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser(db);
	const t = makeTrip(db, { ownerId: u.id });
	const link = createDocumentLink(u.id, t.id, { label: 'Remove', url: 'https://remove.example' });

	const event = makeFormEvent(u, { id: String(t.id) }, { linkId: String(link.id) });
	await expect(deleteDocumentLink(event)).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(db.select().from(tripDocumentLinks).where(eq(tripDocumentLinks.id, link.id)).get()).toBeUndefined();
});
