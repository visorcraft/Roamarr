import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import * as repo from './tripMiscRepo';
import {
	tripChecklists,
	tripChecklistItems,
	tripJournalEntries,
	tripDocumentLinks,
	tripHomeTasks,
	tripMailHolds,
	tripMedications,
	tripEntryRequirements,
	tripImportantItems
} from '$lib/server/db/mongrelSchema';
import { makeSyncedUser, makeSyncedTrip, makeSyncedCompanion } from '../../../../tests/helpers';
import { currentTripRev, subscribeUser } from '../eventBus';

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

beforeEach(() => {
	const kit = getKit();
	kit.deleteFrom(tripChecklistItems).executeSync();
	kit.deleteFrom(tripChecklists).executeSync();
	kit.deleteFrom(tripJournalEntries).executeSync();
	kit.deleteFrom(tripDocumentLinks).executeSync();
	kit.deleteFrom(tripHomeTasks).executeSync();
	kit.deleteFrom(tripMailHolds).executeSync();
	kit.deleteFrom(tripMedications).executeSync();
	kit.deleteFrom(tripEntryRequirements).executeSync();
	kit.deleteFrom(tripImportantItems).executeSync();
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

test('createJournalEntry publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'jrnl-pub-create@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const entry = repo.createJournalEntry({
		tripId: t.id,
		entryDate: '2026-06-15',
		title: 'Day one',
		body: 'Arrived safely.'
	});

	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('updateJournalEntry publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'jrnl-pub-update@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const entry = repo.createJournalEntry({
		tripId: t.id,
		entryDate: '2026-06-15',
		title: 'Before',
		body: 'Body'
	});
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const updated = repo.updateJournalEntry(entry.id, { title: 'After' });

	expect(updated?.title).toBe('After');
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('updateJournalEntry on a missing id returns null and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'jrnl-pub-missing@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const result = repo.updateJournalEntry(999999, { title: 'X' });

	expect(result).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

test('deleteJournalEntry publishes one trip-changed event and removes the entry', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'jrnl-pub-delete@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const entry = repo.createJournalEntry({
		tripId: t.id,
		entryDate: '2026-06-15',
		title: 'To delete',
		body: 'Body'
	});
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteJournalEntry(entry.id);

	expect(deleted).toBe(1);
	expect(repo.getJournalEntryById(entry.id)).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('deleteJournalEntry on a missing id returns 0 and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'jrnl-pub-missing-del@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteJournalEntry(999999);

	expect(deleted).toBe(0);
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

// Checklist items publishing

test('createChecklistItem publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'chk-pub-create@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const checklist = repo.getOrCreateChecklist(t.id);
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const item = repo.createChecklistItem({
		checklistId: checklist.id,
		text: 'Passport'
	});

	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	expect(events[0].id).not.toBe(checklist.id);
	expect(events[0].id).not.toBe(item.id);
	unsubscribe!();
});

test('updateChecklistItem publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'chk-pub-update@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const checklist = repo.getOrCreateChecklist(t.id);
	const item = repo.createChecklistItem({
		checklistId: checklist.id,
		text: 'Passport'
	});
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const updated = repo.updateChecklistItem(item.id, { text: 'Updated' });

	expect(updated?.text).toBe('Updated');
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	expect(events[0].id).not.toBe(checklist.id);
	expect(events[0].id).not.toBe(item.id);
	unsubscribe!();
});

test('updateChecklistItem on a missing id returns null and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'chk-pub-missing@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const result = repo.updateChecklistItem(999999, { text: 'X' });

	expect(result).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

test('deleteChecklistItem publishes one trip-changed event and removes the item', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'chk-pub-delete@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const checklist = repo.getOrCreateChecklist(t.id);
	const item = repo.createChecklistItem({
		checklistId: checklist.id,
		text: 'Passport'
	});
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteChecklistItem(item.id);

	expect(deleted).toBe(1);
	expect(repo.listItemsForChecklist(checklist.id)).toHaveLength(0);
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	expect(events[0].id).not.toBe(checklist.id);
	expect(events[0].id).not.toBe(item.id);
	unsubscribe!();
});

test('deleteChecklistItem on a missing id returns 0 and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'chk-pub-missing-del@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteChecklistItem(999999);

	expect(deleted).toBe(0);
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

// Document links publishing

test('createDocumentLink publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dl-pub-create@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const link = repo.createDocumentLink({
		tripId: t.id,
		label: 'Visa',
		url: 'https://example.com/visa'
	});

	expect(link.tripId).toBe(t.id);
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('updateDocumentLink publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dl-pub-update@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const link = repo.createDocumentLink({
		tripId: t.id,
		label: 'Visa',
		url: 'https://example.com/visa'
	});
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const updated = repo.updateDocumentLink(link.id, { label: 'Updated' });

	expect(updated?.label).toBe('Updated');
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('updateDocumentLink on a missing id returns null and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dl-pub-missing@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const result = repo.updateDocumentLink(999999, { label: 'X' });

	expect(result).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

test('deleteDocumentLink publishes one trip-changed event and removes the link', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dl-pub-delete@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const link = repo.createDocumentLink({
		tripId: t.id,
		label: 'Visa',
		url: 'https://example.com/visa'
	});
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteDocumentLink(link.id);

	expect(deleted).toBe(1);
	expect(repo.getDocumentLinkById(link.id)).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('deleteDocumentLink on a missing id returns 0 and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dl-pub-missing-del@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteDocumentLink(999999);

	expect(deleted).toBe(0);
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

// Home tasks publishing

test('createHomeTask publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'ht-pub-create@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const task = repo.createHomeTask({ tripId: t.id, text: 'Book hotel' });

	expect(task.tripId).toBe(t.id);
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('updateHomeTask publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'ht-pub-update@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const task = repo.createHomeTask({ tripId: t.id, text: 'Book hotel' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const updated = repo.updateHomeTask(task.id, { text: 'Updated' });

	expect(updated?.text).toBe('Updated');
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('updateHomeTask on a missing id returns null and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'ht-pub-missing@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const result = repo.updateHomeTask(999999, { text: 'X' });

	expect(result).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

test('deleteHomeTask publishes one trip-changed event and removes the task', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'ht-pub-delete@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const task = repo.createHomeTask({ tripId: t.id, text: 'Book hotel' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteHomeTask(task.id);

	expect(deleted).toBe(1);
	expect(repo.getHomeTaskById(task.id)).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('deleteHomeTask on a missing id returns 0 and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'ht-pub-missing-del@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteHomeTask(999999);

	expect(deleted).toBe(0);
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

// Mail holds publishing

test('createMailHold publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'mh-pub-create@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const hold = repo.createMailHold({
		tripId: t.id,
		carrier: 'UPS',
		startDate: '2026-06-01',
		endDate: '2026-06-10'
	});

	expect(hold.tripId).toBe(t.id);
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('updateMailHold publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'mh-pub-update@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const hold = repo.createMailHold({
		tripId: t.id,
		carrier: 'UPS',
		startDate: '2026-06-01',
		endDate: '2026-06-10'
	});
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const updated = repo.updateMailHold(hold.id, { carrier: 'FedEx' });

	expect(updated?.carrier).toBe('FedEx');
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('updateMailHold on a missing id returns null and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'mh-pub-missing@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const result = repo.updateMailHold(999999, { carrier: 'X' });

	expect(result).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

test('deleteMailHold publishes one trip-changed event and removes the hold', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'mh-pub-delete@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const hold = repo.createMailHold({
		tripId: t.id,
		carrier: 'UPS',
		startDate: '2026-06-01',
		endDate: '2026-06-10'
	});
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteMailHold(hold.id);

	expect(deleted).toBe(1);
	expect(repo.getMailHoldById(hold.id)).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('deleteMailHold on a missing id returns 0 and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'mh-pub-missing-del@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteMailHold(999999);

	expect(deleted).toBe(0);
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

// Medications publishing

test('createMedication publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'med-pub-create@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const med = repo.createMedication({ tripId: t.id, name: 'Aspirin' });

	expect(med.tripId).toBe(t.id);
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('deleteMedication publishes one trip-changed event and removes the medication', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'med-pub-delete@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const med = repo.createMedication({ tripId: t.id, name: 'Aspirin' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteMedication(med.id);

	expect(deleted).toBe(1);
	expect(repo.getMedicationById(med.id)).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('deleteMedication on a missing id returns 0 and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'med-pub-missing-del@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteMedication(999999);

	expect(deleted).toBe(0);
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

// Entry requirements publishing

test('createEntryRequirement publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'er-pub-create@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const req = repo.createEntryRequirement({
		tripId: t.id,
		country: 'Japan',
		requirementType: 'visa'
	});

	expect(req.tripId).toBe(t.id);
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('updateEntryRequirement publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'er-pub-update@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const req = repo.createEntryRequirement({
		tripId: t.id,
		country: 'Japan',
		requirementType: 'visa'
	});
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const updated = repo.updateEntryRequirement(req.id, { status: 'complete' });

	expect(updated?.status).toBe('complete');
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('updateEntryRequirement on a missing id returns null and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'er-pub-missing@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const result = repo.updateEntryRequirement(999999, { status: 'complete' });

	expect(result).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

test('deleteEntryRequirement publishes one trip-changed event and removes the requirement', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'er-pub-delete@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const req = repo.createEntryRequirement({
		tripId: t.id,
		country: 'Japan',
		requirementType: 'visa'
	});
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteEntryRequirement(req.id);

	expect(deleted).toBe(1);
	expect(repo.getEntryRequirementById(req.id)).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('deleteEntryRequirement on a missing id returns 0 and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'er-pub-missing-del@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteEntryRequirement(999999);

	expect(deleted).toBe(0);
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});

// Important items publishing

test('createImportantItem publishes one trip-changed event', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'ii-pub-create@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const item = repo.createImportantItem({ tripId: t.id, name: 'Passport' });

	expect(item.tripId).toBe(t.id);
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('deleteImportantItem publishes one trip-changed event and removes the item', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'ii-pub-delete@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const item = repo.createImportantItem({ tripId: t.id, name: 'Passport' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteImportantItem(item.id);

	expect(deleted).toBe(1);
	expect(repo.getImportantItemById(item.id)).toBeNull();
	expect(currentTripRev(t.id) - before).toBe(1);
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ type: 'trip', id: t.id });
	unsubscribe!();
});

test('deleteImportantItem on a missing id returns 0 and publishes nothing', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'ii-pub-missing-del@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const events: Array<{ type: string; id: number }> = [];
	const unsubscribe = subscribeUser(u.id, (e) => events.push(e as never));
	expect(unsubscribe).toBeTypeOf('function');
	const before = currentTripRev(t.id);

	const deleted = repo.deleteImportantItem(999999);

	expect(deleted).toBe(0);
	expect(currentTripRev(t.id) - before).toBe(0);
	expect(events).toHaveLength(0);
	unsubscribe!();
});
