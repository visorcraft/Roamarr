import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	listJournalEntries,
	createJournalEntry,
	modifyJournalEntry,
	removeJournalEntry,
	addJournalEntry,
	deleteJournalEntry
} from './tripJournal';
import { tripJournalEntries, tripShares, auditLogs } from './db/mongrelSchema';
import { and, eq } from '@mongreldb/kit';
import { DateTime } from 'luxon';
import type { RequestEvent } from '@sveltejs/kit';
import { makeSyncedUser, makeSyncedTrip } from '../../../tests/helpers';

function getDb() {
	return (ctx as { db: import('./db').DB }).db;
}

function getKit() {
	return (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
}

function makeEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	values: Record<string, string>
): RequestEvent {
	const form = new FormData();
	for (const [key, value] of Object.entries(values)) {
		form.append(key, value);
	}
	return {
		locals: { user } as App.Locals,
		params,
		request: { formData: async () => form } as unknown as Request
	} as RequestEvent;
}

test('listJournalEntries sorts by entryDate descending', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'j1@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-10',
		title: 'Older',
		body: 'Body older'
	});
	createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-12',
		title: 'Newer',
		body: 'Body newer'
	});
	createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-12',
		title: 'Same day second',
		body: 'Body same'
	});

	const entries = listJournalEntries(t.id);
	expect(entries.map((e) => e.title)).toEqual(['Same day second', 'Newer', 'Older']);
});

test('createJournalEntry inserts entry and logs audit', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'j2@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const entry = createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-15',
		title: 'Day one',
		body: 'We arrived safely.'
	});
	expect(entry.tripId).toBe(t.id);
	expect(entry.entryDate).toBe('2026-06-15');
	expect(entry.title).toBe('Day one');
	expect(entry.body).toBe('We arrived safely.');
	expect(db.select().from(tripJournalEntries).where(eq(tripJournalEntries.id, BigInt(entry.id))).get()).toBeDefined();

	const audit = db.select().from(auditLogs).where(eq(auditLogs.entity_id, BigInt(entry.id))).get();
	expect(audit).toBeDefined();
	expect(audit?.action).toBe('create');
	expect(audit?.entityType).toBe('journal_entry');
});

test('createJournalEntry rejects viewers and non-members', () => {
	const db = getDb();
	const kit = getKit();
	const owner = makeSyncedUser(kit, { email: 'j3-owner@x.c' });
	const viewer = makeSyncedUser(kit, { email: 'j3-viewer@x.c' });
	const stranger = makeSyncedUser(kit, { email: 'j3-stranger@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });
	db.insert(tripShares).values({
		tripId: t.id,
		sharedWithUserId: viewer.id,
		permission: 'read'
	}).run();

	expect(() =>
		createJournalEntry(viewer.id, t.id, {
			entryDate: '2026-06-15',
			title: 'X',
			body: 'Y'
		})
	).toThrow();
	expect(() =>
		createJournalEntry(stranger.id, t.id, {
			entryDate: '2026-06-15',
			title: 'X',
			body: 'Y'
		})
	).toThrow();
});

test('createJournalEntry allows shared editors', () => {
	const db = getDb();
	const kit = getKit();
	const owner = makeSyncedUser(kit, { email: 'j4-owner@x.c' });
	const editor = makeSyncedUser(kit, { email: 'j4-editor@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });
	db.insert(tripShares).values({
		tripId: t.id,
		sharedWithUserId: editor.id,
		permission: 'edit'
	}).run();

	const entry = createJournalEntry(editor.id, t.id, {
		entryDate: '2026-06-15',
		title: 'Editor note',
		body: 'Shared editor can write.'
	});
	expect(entry.title).toBe('Editor note');
});

test('modifyJournalEntry updates fields and updatedAt', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'j5@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const entry = createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-15',
		title: 'Original',
		body: 'Original body'
	});
	const updated = modifyJournalEntry(u.id, entry.id, {
		entryDate: '2026-06-16',
		title: 'Updated',
		body: 'Updated body'
	});
	expect(updated.entryDate).toBe('2026-06-16');
	expect(updated.title).toBe('Updated');
	expect(updated.body).toBe('Updated body');
	const originalTime = DateTime.fromISO(entry.updatedAt, { zone: 'utc' }).toMillis();
	const updatedTime = DateTime.fromISO(updated.updatedAt).toMillis();
	expect(updatedTime).toBeGreaterThanOrEqual(originalTime);
});

test('modifyJournalEntry rejects non-editors', () => {
	const db = getDb();
	const kit = getKit();
	const owner = makeSyncedUser(kit, { email: 'j6-owner@x.c' });
	const viewer = makeSyncedUser(kit, { email: 'j6-viewer@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });
	const entry = createJournalEntry(owner.id, t.id, {
		entryDate: '2026-06-15',
		title: 'X',
		body: 'Y'
	});
	db.insert(tripShares).values({
		tripId: t.id,
		sharedWithUserId: viewer.id,
		permission: 'read'
	}).run();

	expect(() => modifyJournalEntry(viewer.id, entry.id, { title: 'Hacked' })).toThrow();
});

test('removeJournalEntry deletes entry and logs audit', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'j7@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const entry = createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-15',
		title: 'To delete',
		body: 'Body'
	});
	removeJournalEntry(u.id, entry.id);
	expect(db.select().from(tripJournalEntries).where(eq(tripJournalEntries.id, BigInt(entry.id))).get()).toBeUndefined();
	const audit = db
		.select()
		.from(auditLogs)
		.where(and(eq(auditLogs.entity_id, BigInt(entry.id)), eq(auditLogs.action, 'delete')))
		.get();
	expect(audit).toBeDefined();
	expect(audit?.entityType).toBe('journal_entry');
});

test('addJournalEntry action validates and redirects', async () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'j8@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const event = makeEvent(u, { id: String(t.id) }, {
		entryDate: '2026-06-20',
		title: 'Action title',
		body: 'Action body'
	});
	await expect(addJournalEntry(event)).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });
	expect(listJournalEntries(t.id).map((e) => e.title)).toContain('Action title');
});

test('addJournalEntry action returns fail for invalid input', async () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'j9@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const event = makeEvent(u, { id: String(t.id) }, {
		entryDate: '',
		title: '',
		body: ''
	});
	const result = await addJournalEntry(event);
	expect(result?.status).toBe(400);
	expect((result as unknown as { data: { error: string } }).data.error).toBe('Please fix the highlighted fields.');
});

test('deleteJournalEntry action deletes and redirects', async () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'j10@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const entry = createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-20',
		title: 'Delete me',
		body: 'Body'
	});
	const event = makeEvent(u, { id: String(t.id) }, { entryId: String(entry.id) });
	await expect(deleteJournalEntry(event)).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });
	expect(listJournalEntries(t.id)).toHaveLength(0);
});
