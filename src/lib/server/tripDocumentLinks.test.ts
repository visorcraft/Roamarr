import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
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
	deleteDocumentLink
} from './tripDocumentLinks';
import { tripDocumentLinks, auditLogs } from './db/schema';
import { eq } from 'drizzle-orm';
import { makeFormEvent } from '../../../tests/eventHelpers';
import { makeSyncedUser, makeSyncedTrip } from '../../../tests/helpers';

function getDb() {
	return (ctx as { db: import('./db').DB }).db;
}

function getKit() {
	return (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
}

test('listDocumentLinks returns links ordered by newest first', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(db, kit, { email: 'dl@x.c' });
	const t = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T' });

	createDocumentLink(u.id, t.id, { label: 'First', url: 'https://first.example' });
	createDocumentLink(u.id, t.id, { label: 'Second', url: 'https://second.example' });

	const list = listDocumentLinks(t.id);
	expect(list.map((l) => l.label)).toEqual(['Second', 'First']);
});

test('createDocumentLink inserts a link and audits', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(db, kit, { email: 'dl2@x.c' });
	const t = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T' });

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
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(db, kit, { email: 'dl3@x.c' });
	const t = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T' });

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
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(db, kit, { email: 'dl4@x.c' });
	const t = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T' });

	expect(() => createDocumentLink(u.id, t.id, { label: 'X', url: 'not-a-url' })).toThrow(
		expect.objectContaining({ status: 400, body: { message: 'URL must be a valid http or https URL' } })
	);
	expect(() => createDocumentLink(u.id, t.id, { label: 'X', url: 'ftp://files.example' })).toThrow(
		expect.objectContaining({ status: 400, body: { message: 'URL must be a valid http or https URL' } })
	);
});

test('editDocumentLink updates a link and audits', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(db, kit, { email: 'dl5@x.c' });
	const t = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T' });
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
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(db, kit, { email: 'dl6@x.c' });
	const t1 = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T1' });
	const t2 = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T2' });
	const link = createDocumentLink(u.id, t1.id, { label: 'L', url: 'https://a.example' });

	try {
		editDocumentLink(u.id, t2.id, link.id, { label: 'Hacked', url: 'https://b.example' });
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('removeDocumentLink deletes only the owned trip link', () => {
	const db = getDb();
	const kit = getKit();
	const a = makeSyncedUser(db, kit, { email: 'dl7-a@x.c' });
	const b = makeSyncedUser(db, kit, { email: 'dl7-b@x.c' });
	const t = makeSyncedTrip(db, kit, { ownerId: a.id, name: 'T' });
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
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(db, kit, { email: 'dl8@x.c' });
	const t = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T' });

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
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(db, kit, { email: 'dl9@x.c' });
	const t = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T' });

	const event = makeFormEvent(u, { id: String(t.id) }, { label: '', url: 'not-a-url' });
	const result = (await addDocumentLink(event)) as {
		status: number;
		data: { error: string; errors?: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors?.label).toBeDefined();
	expect(result.data.errors?.url).toBeDefined();
});

test('deleteDocumentLink action removes a link and redirects', async () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(db, kit, { email: 'dl10@x.c' });
	const t = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T' });
	const link = createDocumentLink(u.id, t.id, { label: 'Remove', url: 'https://remove.example' });

	const event = makeFormEvent(u, { id: String(t.id) }, { linkId: String(link.id) });
	await expect(deleteDocumentLink(event)).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(db.select().from(tripDocumentLinks).where(eq(tripDocumentLinks.id, link.id)).get()).toBeUndefined();
});
