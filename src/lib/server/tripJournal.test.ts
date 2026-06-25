import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
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
	updateJournalEntry,
	deleteJournalEntry
} from './tripJournal';
import { tripJournalEntries, tripShares, auditLogs } from './db/schema';
import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { RequestEvent } from '@sveltejs/kit';
import { makeUser as makeUserHelper, makeTrip as makeTripHelper } from '../../../tests/helpers';

function getDb() {
	return (ctx as { db: import('./db').DB }).db;
}

function makeUser() {
	return makeUserHelper(getDb());
}

function makeTrip(ownerId: number) {
	return makeTripHelper(getDb(), { ownerId });
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
	const u = makeUser();
	const t = makeTrip(u.id);
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
	expect(entries.map((e) => e.title)).toEqual(['Newer', 'Same day second', 'Older']);
});

test('createJournalEntry inserts entry and logs audit', () => {
	const db = getDb();
	const u = makeUser();
	const t = makeTrip(u.id);
	const entry = createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-15',
		title: 'Day one',
		body: 'We arrived safely.'
	});
	expect(entry.tripId).toBe(t.id);
	expect(entry.entryDate).toBe('2026-06-15');
	expect(entry.title).toBe('Day one');
	expect(entry.body).toBe('We arrived safely.');
	expect(db.select().from(tripJournalEntries).where(eq(tripJournalEntries.id, entry.id)).get()).toBeDefined();

	const audit = db.select().from(auditLogs).where(eq(auditLogs.entityId, entry.id)).get();
	expect(audit).toBeDefined();
	expect(audit?.action).toBe('create');
	expect(audit?.entityType).toBe('journal_entry');
});

test('createJournalEntry rejects viewers and non-members', () => {
	const db = getDb();
	const owner = makeUser();
	const viewer = makeUser();
	const stranger = makeUser();
	const t = makeTrip(owner.id);
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
	const owner = makeUser();
	const editor = makeUser();
	const t = makeTrip(owner.id);
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
	const u = makeUser();
	const t = makeTrip(u.id);
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
	const originalTime = DateTime.fromSQL(entry.updatedAt, { zone: 'utc' }).toMillis();
	const updatedTime = DateTime.fromISO(updated.updatedAt).toMillis();
	expect(updatedTime).toBeGreaterThanOrEqual(originalTime);
});

test('modifyJournalEntry rejects non-editors', () => {
	const db = getDb();
	const owner = makeUser();
	const viewer = makeUser();
	const t = makeTrip(owner.id);
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
	const u = makeUser();
	const t = makeTrip(u.id);
	const entry = createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-15',
		title: 'To delete',
		body: 'Body'
	});
	removeJournalEntry(u.id, entry.id);
	expect(db.select().from(tripJournalEntries).where(eq(tripJournalEntries.id, entry.id)).get()).toBeUndefined();
	const audit = db
		.select()
		.from(auditLogs)
		.where(and(eq(auditLogs.entityId, entry.id), eq(auditLogs.action, 'delete')))
		.get();
	expect(audit).toBeDefined();
	expect(audit?.entityType).toBe('journal_entry');
});

test('addJournalEntry action validates and redirects', async () => {
	const u = makeUser();
	const t = makeTrip(u.id);
	const event = makeEvent(u, { id: String(t.id) }, {
		entryDate: '2026-06-20',
		title: 'Action title',
		body: 'Action body'
	});
	await expect(addJournalEntry(event)).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });
	expect(listJournalEntries(t.id).map((e) => e.title)).toContain('Action title');
});

test('addJournalEntry action returns fail for invalid input', async () => {
	const u = makeUser();
	const t = makeTrip(u.id);
	const event = makeEvent(u, { id: String(t.id) }, {
		entryDate: '',
		title: '',
		body: ''
	});
	const result = await addJournalEntry(event);
	expect(result?.status).toBe(400);
	expect((result as unknown as { data: { error: string } }).data.error).toBe('Please fix the highlighted fields.');
});

test('updateJournalEntry action validates and redirects', async () => {
	const u = makeUser();
	const t = makeTrip(u.id);
	const entry = createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-20',
		title: 'Before',
		body: 'Body'
	});
	const event = makeEvent(u, { id: String(t.id) }, {
		entryId: String(entry.id),
		entryDate: '2026-06-21',
		title: 'After',
		body: 'Updated'
	});
	await expect(updateJournalEntry(event)).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });
	const updated = listJournalEntries(t.id)[0];
	expect(updated.title).toBe('After');
});

test('deleteJournalEntry action deletes and redirects', async () => {
	const u = makeUser();
	const t = makeTrip(u.id);
	const entry = createJournalEntry(u.id, t.id, {
		entryDate: '2026-06-20',
		title: 'Delete me',
		body: 'Body'
	});
	const event = makeEvent(u, { id: String(t.id) }, { entryId: String(entry.id) });
	await expect(deleteJournalEntry(event)).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });
	expect(listJournalEntries(t.id)).toHaveLength(0);
});
