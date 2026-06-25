import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { loadChecklist, addItem, toggleItem, deleteItem, addChecklistItem, toggleChecklistItem, deleteChecklistItem } from './tripChecklists';
import { users, trips, tripCompanions, tripChecklists, tripChecklistItems } from './db/schema';
import { eq } from 'drizzle-orm';
import { makeLocals } from '../../../tests/eventHelpers';

function formRequest(data: Record<string, string>) {
	const body = new URLSearchParams(data);
	return new Request('http://localhost/trips/1', { method: 'POST', body });
}

test('loadChecklist creates checklist lazily and returns empty items', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const checklist = loadChecklist(t.id);
	expect(checklist.tripId).toBe(t.id);
	expect(checklist.items).toEqual([]);
	expect(db.select().from(tripChecklists).where(eq(tripChecklists.tripId, t.id)).get()).toBeDefined();
});

test('addItem creates item and loadChecklist returns assigned companion name', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o2@x.c', passwordHash: 'x', displayName: 'O2' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const c = db.insert(tripCompanions).values({ tripId: t.id, name: 'Kid', category: 'child' }).returning().get();

	const item = addItem(u.id, t.id, 'Passports', c.id);
	expect(item.text).toBe('Passports');
	expect(item.packed).toBe(false);
	expect(item.assignedToCompanionId).toBe(c.id);

	const checklist = loadChecklist(t.id);
	expect(checklist.items).toHaveLength(1);
	expect(checklist.items[0].assignedToName).toBe('Kid');
});

test('addItem rejects missing or oversized text', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o3@x.c', passwordHash: 'x', displayName: 'O3' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	expect(() => addItem(u.id, t.id, '')).toThrow();
	expect(() => addItem(u.id, t.id, 'x'.repeat(201))).toThrow();
});

test('addItem rejects companion from another trip', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o4@x.c', passwordHash: 'x', displayName: 'O4' }).returning().get();
	const t1 = db.insert(trips).values({ ownerId: u.id, name: 'T1' }).returning().get();
	const t2 = db.insert(trips).values({ ownerId: u.id, name: 'T2' }).returning().get();
	const c2 = db.insert(tripCompanions).values({ tripId: t2.id, name: 'Other' }).returning().get();

	expect(() => addItem(u.id, t1.id, 'Thing', c2.id)).toThrow();
});

test('toggleItem flips packed status', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o5@x.c', passwordHash: 'x', displayName: 'O5' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const item = addItem(u.id, t.id, 'Socks');

	expect(toggleItem(u.id, t.id, item.id).packed).toBe(true);
	expect(toggleItem(u.id, t.id, item.id).packed).toBe(false);
});

test('toggleItem and deleteItem reject unknown items', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o6@x.c', passwordHash: 'x', displayName: 'O6' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	expect(() => toggleItem(u.id, t.id, 9999)).toThrow();
	expect(() => deleteItem(u.id, t.id, 9999)).toThrow();
});

test('deleteItem removes item', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o7@x.c', passwordHash: 'x', displayName: 'O7' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const item = addItem(u.id, t.id, 'Hat');

	deleteItem(u.id, t.id, item.id);
	expect(db.select().from(tripChecklistItems).where(eq(tripChecklistItems.id, item.id)).get()).toBeUndefined();
});

test('addChecklistItem action parses form and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o8@x.c', passwordHash: 'x', displayName: 'O8' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const c = db.insert(tripCompanions).values({ tripId: t.id, name: 'Adult', category: 'adult' }).returning().get();

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
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o9@x.c', passwordHash: 'x', displayName: 'O9' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
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
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'o10@x.c', passwordHash: 'x', displayName: 'O10' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
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
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();

	expect(() => addItem(b.id, t.id, 'Thing')).toThrow();
});
