import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { loadChecklist, addItem, toggleItem, deleteItem, addChecklistItem, toggleChecklistItem, deleteChecklistItem, setAllItemsPacked } from './tripChecklists';
import { tripChecklists, tripChecklistItems } from './db/schema';
import { eq } from 'drizzle-orm';
import { makeLocals } from '../../../tests/eventHelpers';
import { makeSyncedUser, makeSyncedTrip, makeSyncedCompanion } from '../../../tests/helpers';

function formRequest(data: Record<string, string>) {
	const body = new URLSearchParams(data);
	return new Request('http://localhost/trips/1', { method: 'POST', body });
}

function getDb() {
	return (ctx as { db: import('./db').DB }).db;
}

function getKit() {
	return (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
}

test('loadChecklist creates checklist lazily and returns empty items', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	const checklist = loadChecklist(t.id);
	expect(checklist.tripId).toBe(t.id);
	expect(checklist.items).toEqual([]);
	expect(db.select().from(tripChecklists).where(eq(tripChecklists.tripId, t.id)).get()).toBeDefined();
});

test('addItem creates item and loadChecklist returns assigned companion name', () => {
	const db = getDb();
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
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o3@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	expect(() => addItem(u.id, t.id, '')).toThrow();
	expect(() => addItem(u.id, t.id, 'x'.repeat(201))).toThrow();
});

test('addItem rejects companion from another trip', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o4@x.c' });
	const t1 = makeSyncedTrip(kit, { ownerId: u.id, name: 'T1' });
	const t2 = makeSyncedTrip(kit, { ownerId: u.id, name: 'T2' });
	const c2 = makeSyncedCompanion(kit, { tripId: t2.id, name: 'Other' });

	expect(() => addItem(u.id, t1.id, 'Thing', c2.id)).toThrow();
});

test('toggleItem flips packed status', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o5@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const item = addItem(u.id, t.id, 'Socks');

	expect(toggleItem(u.id, t.id, item.id).packed).toBe(true);
	expect(toggleItem(u.id, t.id, item.id).packed).toBe(false);
});

test('toggleItem and deleteItem reject unknown items', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o6@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });

	expect(() => toggleItem(u.id, t.id, 9999)).toThrow();
	expect(() => deleteItem(u.id, t.id, 9999)).toThrow();
});

test('deleteItem removes item', () => {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'o7@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const item = addItem(u.id, t.id, 'Hat');

	deleteItem(u.id, t.id, item.id);
	expect(db.select().from(tripChecklistItems).where(eq(tripChecklistItems.id, item.id)).get()).toBeUndefined();
});

test('addChecklistItem action parses form and redirects', async () => {
	const db = getDb();
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
	const db = getDb();
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
	const db = getDb();
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
	const db = getDb();
	const kit = getKit();
	const a = makeSyncedUser(kit, { email: 'a@x.c' });
	const b = makeSyncedUser(kit, { email: 'b@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: a.id, name: 'T' });

	expect(() => addItem(b.id, t.id, 'Thing')).toThrow();
});

test('setAllItemsPacked packs and unpacks every item', () => {
	const db = getDb();
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
