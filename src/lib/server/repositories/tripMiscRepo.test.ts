import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq } from '@mongreldb/kit';
import * as repo from './tripMiscRepo';
import {
	tripChecklists as drizzleTripChecklists,
	tripChecklistItems as drizzleTripChecklistItems,
	tripJournalEntries as drizzleTripJournalEntries
} from '$lib/server/db/mongrelSchema';
import {
	tripChecklists as kitTripChecklists,
	tripChecklistItems as kitTripChecklistItems,
	tripJournalEntries as kitTripJournalEntries
} from '$lib/server/db/mongrelSchema';
import { makeSyncedUser, makeSyncedTrip, makeSyncedCompanion } from '../../../../tests/helpers';

function getDb() {
	return (ctx as { db: import('$lib/server/db').DB }).db;
}

function getKit() {
	return (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
}

beforeEach(() => {
	const db = getDb();
	const kit = getKit();
	db.delete(drizzleTripChecklistItems).run();
	db.delete(drizzleTripChecklists).run();
	db.delete(drizzleTripJournalEntries).run();
	kit.deleteFrom(kitTripChecklistItems).executeSync();
	kit.deleteFrom(kitTripChecklists).executeSync();
	kit.deleteFrom(kitTripJournalEntries).executeSync();
});

// Checklists

test('checklist get-or-create and mirroring', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'chk@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	const first = repo.getOrCreateChecklist(t.id);
	expect(first.tripId).toBe(t.id);

	const second = repo.getOrCreateChecklist(t.id);
	expect(second.id).toBe(first.id);

	const legacy = db
		.select()
		.from(drizzleTripChecklists)
		.where(eq(drizzleTripChecklists.trip_id, BigInt(t.id)))
		.get();
	expect(legacy?.id).toBe(first.id);
});

test('checklist item CRUD with companion name', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'chki@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const c = makeSyncedCompanion(kit, { tripId: t.id, name: 'Kid', category: 'child' });
	const checklist = repo.getOrCreateChecklist(t.id);

	const item = repo.createChecklistItem({
		checklistId: checklist.id,
		text: 'Passport',
		assignedToCompanionId: c.id
	});
	expect(item.text).toBe('Passport');
	expect(item.assignedToCompanionId).toBe(c.id);

	const items = repo.listItemsForChecklist(checklist.id);
	expect(items).toHaveLength(1);
	expect(items[0].assignedToName).toBe('Kid');

	const updated = repo.updateChecklistItem(item.id, { packed: true });
	expect(updated?.packed).toBe(true);

	repo.deleteChecklistItem(item.id);
	expect(repo.listItemsForChecklist(checklist.id)).toHaveLength(0);
	expect(
		db
			.select()
			.from(drizzleTripChecklistItems)
			.where(eq(drizzleTripChecklistItems.id, BigInt(item.id)))
			.get()
	).toBeUndefined();
});

// Journal entries

test('journal entry CRUD and mirroring', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'jrnl@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	const entry = repo.createJournalEntry({
		tripId: t.id,
		entryDate: '2026-06-15',
		title: 'Day one',
		body: 'Arrived safely.'
	});
	expect(entry.tripId).toBe(t.id);
	expect(entry.title).toBe('Day one');

	const legacy = db
		.select()
		.from(drizzleTripJournalEntries)
		.where(eq(drizzleTripJournalEntries.id, BigInt(entry.id)))
		.get();
	expect(legacy?.title).toBe('Day one');

	const updated = repo.updateJournalEntry(entry.id, { title: 'Updated' });
	expect(updated?.title).toBe('Updated');
	expect(repo.getJournalEntryById(entry.id)?.title).toBe('Updated');

	repo.deleteJournalEntry(entry.id);
	expect(repo.getJournalEntryById(entry.id)).toBeNull();
	expect(
		db
			.select()
			.from(drizzleTripJournalEntries)
			.where(eq(drizzleTripJournalEntries.id, BigInt(entry.id)))
			.get()
	).toBeUndefined();
});

test('listJournalEntriesForTrip orders by entry date descending', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'jrn2@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	repo.createJournalEntry({ tripId: t.id, entryDate: '2026-06-10', title: 'Older', body: 'A' });
	repo.createJournalEntry({ tripId: t.id, entryDate: '2026-06-12', title: 'Newer', body: 'B' });

	const entries = repo.listJournalEntriesForTrip(t.id);
	expect(entries.map((e) => e.title)).toEqual(['Newer', 'Older']);
});
