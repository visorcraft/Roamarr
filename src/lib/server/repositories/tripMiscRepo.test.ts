import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq, type KitDatabase } from '@mongreldb/kit';
import * as repo from './tripMiscRepo';
import {
	tripChecklists,
	tripChecklistItems,
	tripJournalEntries
} from '$lib/server/db/mongrelSchema';
import { makeSyncedUser, makeSyncedTrip, makeSyncedCompanion } from '../../../../tests/helpers';

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

beforeEach(() => {
	const kit = getKit();
	kit.deleteFrom(tripChecklistItems).executeSync();
	kit.deleteFrom(tripChecklists).executeSync();
	kit.deleteFrom(tripJournalEntries).executeSync();
});

// Checklists

test('checklist get-or-create', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'chk@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	const first = repo.getOrCreateChecklist(t.id);
	expect(first.tripId).toBe(t.id);

	const second = repo.getOrCreateChecklist(t.id);
	expect(second.id).toBe(first.id);

	const stored = kit
		.selectFrom(tripChecklists)
		.where(eq(tripChecklists.trip_id, BigInt(t.id)))
		.executeSync()[0];
	expect(Number(stored?.id)).toBe(first.id);
});

test('checklist item CRUD with companion name', () => {
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
		kit
			.selectFrom(tripChecklistItems)
			.where(eq(tripChecklistItems.id, BigInt(item.id)))
			.executeSync()[0]
	).toBeUndefined();
});

// Journal entries

test('journal entry CRUD', () => {
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

	const stored = kit
		.selectFrom(tripJournalEntries)
		.where(eq(tripJournalEntries.id, BigInt(entry.id)))
		.executeSync()[0];
	expect(stored?.title).toBe('Day one');

	const updated = repo.updateJournalEntry(entry.id, { title: 'Updated' });
	expect(updated?.title).toBe('Updated');
	expect(repo.getJournalEntryById(entry.id)?.title).toBe('Updated');

	repo.deleteJournalEntry(entry.id);
	expect(repo.getJournalEntryById(entry.id)).toBeNull();
	expect(
		kit
			.selectFrom(tripJournalEntries)
			.where(eq(tripJournalEntries.id, BigInt(entry.id)))
			.executeSync()[0]
	).toBeUndefined();
});

test('listJournalEntriesForTrip orders by entry date descending', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'jrn2@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	repo.createJournalEntry({ tripId: t.id, entryDate: '2026-06-10', title: 'Older', body: 'A' });
	repo.createJournalEntry({ tripId: t.id, entryDate: '2026-06-12', title: 'Newer', body: 'B' });

	const entries = repo.listJournalEntriesForTrip(t.id);
	expect(entries.map((e) => e.title)).toEqual(['Newer', 'Older']);
});
