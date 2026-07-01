import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { loadChecklist, addItem, toggleItem, deleteItem, addChecklistItem, toggleChecklistItem, deleteChecklistItem, setAllItemsPacked } from './tripChecklists';
import { tripChecklists, tripChecklistItems } from './db/mongrelSchema';
import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeLocals } from '../../../tests/eventHelpers';
import { makeSyncedUser, makeSyncedTrip, makeSyncedCompanion } from '../../../tests/helpers';

function formRequest(data: Record<string, string>) {
	const body = new URLSearchParams(data);
	return new Request('http://localhost/trips/1', { method: 'POST', body });
}

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

test('loadChecklist creates checklist lazily and returns empty items', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	const checklist = loadChecklist(t.id);
	expect(checklist.tripId).toBe(t.id);
	expect(checklist.items).toEqual([]);
	expect(
		kit.selectFrom(tripChecklists).where(eq(tripChecklists.trip_id, BigInt(t.id))).executeSync()[0]
	).toBeDefined();
});

test('addItem creates item and loadChecklist returns assigned companion name', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o2@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const c = makeSyncedCompanion(kit, { tripId: t.id, name: 'Kid', category: 'child' });

	const item = addItem(u.id, t.id, 'Passports', c.id);
	expect(item.text).toBe('Passports');
	expect(item.packed).toBe(false);
	expect(item.assignedToCompanionId).toBe(c.id);

	const checklist = loadChecklist(t.id);
	expect(checklist.items).toHaveLength(1);
	expect(checklist.items[0].assignedToName).toBe('Kid');
});

test('addItem rejects missing or oversized text', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o3@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	expect(() => addItem(u.id, t.id, '')).toThrow();
	expect(() => addItem(u.id, t.id, 'x'.repeat(201))).toThrow();
});

test('addItem rejects companion from another trip', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o4@x.c' });
	const t1 = makeSyncedTrip(kit, { ownerId: u.id, name: 'T1' });
	const t2 = makeSyncedTrip(kit, { ownerId: u.id, name: 'T2' });
	const c2 = makeSyncedCompanion(kit, { tripId: t2.id, name: 'Other' });

	expect(() => addItem(u.id, t1.id, 'Thing', c2.id)).toThrow();
});

test('toggleItem flips packed status', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o5@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const item = addItem(u.id, t.id, 'Socks');

	expect(toggleItem(u.id, t.id, item.id).packed).toBe(true);
	expect(toggleItem(u.id, t.id, item.id).packed).toBe(false);
});

test('toggleItem and deleteItem reject unknown items', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o6@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	expect(() => toggleItem(u.id, t.id, 9999)).toThrow();
	expect(() => deleteItem(u.id, t.id, 9999)).toThrow();
});

test('deleteItem removes item', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o7@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const item = addItem(u.id, t.id, 'Hat');

	deleteItem(u.id, t.id, item.id);
	expect(
		kit.selectFrom(tripChecklistItems).where(eq(tripChecklistItems.id, BigInt(item.id))).executeSync()[0]
	).toBeUndefined();
});

test('addChecklistItem action parses form and redirects', async () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o8@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const c = makeSyncedCompanion(kit, { tripId: t.id, name: 'Adult', category: 'adult' });

	await expect(
		addChecklistItem({
			locals: makeLocals(u),
			params: { id: String(t.id) },
			request: formRequest({ text: 'Tickets', assignedToCompanionId: String(c.id) })
		} as unknown as Parameters<typeof addChecklistItem>[0])
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const checklist = loadChecklist(t.id);
	expect(checklist.items.map((i) => i.text)).toContain('Tickets');
});

test('toggleChecklistItem action toggles and redirects', async () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o9@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const item = addItem(u.id, t.id, 'Shoes');

	await expect(
		toggleChecklistItem({
			locals: makeLocals(u),
			params: { id: String(t.id) },
			request: formRequest({ itemId: String(item.id) })
		} as unknown as Parameters<typeof toggleChecklistItem>[0])
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const loaded = loadChecklist(t.id).items[0];
	expect(loaded.packed).toBe(true);
});

test('deleteChecklistItem action deletes and redirects', async () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o10@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const item = addItem(u.id, t.id, 'Bag');

	await expect(
		deleteChecklistItem({
			locals: makeLocals(u),
			params: { id: String(t.id) },
			request: formRequest({ itemId: String(item.id) })
		} as unknown as Parameters<typeof deleteChecklistItem>[0])
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	expect(loadChecklist(t.id).items).toHaveLength(0);
});

test('mutation helpers require editable trip', () => {
	const kit = getKit();
	const a = makeSyncedUser(kit, { email: 'a@x.c' });
	const b = makeSyncedUser(kit, { email: 'b@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: a.id, name: 'T' });

	expect(() => addItem(b.id, t.id, 'Thing')).toThrow();
});

test('setAllItemsPacked packs and unpacks every item', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'all@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	addItem(u.id, t.id, 'A');
	addItem(u.id, t.id, 'B');

	setAllItemsPacked(u.id, t.id, true);
	let checklist = loadChecklist(t.id);
	expect(checklist.items.every((i) => i.packed)).toBe(true);

	setAllItemsPacked(u.id, t.id, false);
	checklist = loadChecklist(t.id);
	expect(checklist.items.every((i) => !i.packed)).toBe(true);
});
