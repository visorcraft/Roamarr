import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { addImportantItem, deleteImportantItem, listImportantItems } from './tripImportantItems';
import { tripCompanions, tripImportantItems, trips, users } from './db/schema';
import { eq } from 'drizzle-orm';

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from trip_important_items; delete from trip_companions; delete from trips; delete from users;'
	);
});

function seed() {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'ii@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const c = db.insert(tripCompanions).values({ tripId: t.id, name: 'Alex', category: 'adult' }).returning().get();
	const other = db.insert(users).values({ email: 'oth@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	return { db, u, t, c, other };
}

test('addImportantItem creates a tracked item with companion name', () => {
	const { db, u, t, c } = seed();
	const item = addImportantItem(u.id, t.id, {
		name: 'Passport',
		companionId: c.id,
		serialNumber: 'ABC123',
		trackerId: 'tile-1',
		notes: 'In carry-on'
	});
	expect(item.name).toBe('Passport');
	expect(item.serialNumber).toBe('ABC123');

	const rows = listImportantItems(t.id);
	expect(rows).toHaveLength(1);
	expect(rows[0].companionName).toBe('Alex');
	expect(db.select().from(tripImportantItems).where(eq(tripImportantItems.id, item.id)).get()).toBeTruthy();
});

test('addImportantItem rejects unknown companion', () => {
	const { u, t } = seed();
	expect(() => addImportantItem(u.id, t.id, { name: 'X', companionId: 999 })).toThrowError(
		expect.objectContaining({ status: 400 })
	);
});

test('addImportantItem without companion is allowed', () => {
	const { u, t } = seed();
	const item = addImportantItem(u.id, t.id, { name: 'Phone' });
	expect(item.companionId).toBeNull();
	expect(listImportantItems(t.id)[0].companionName).toBeNull();
});

test('deleteImportantItem removes the row', () => {
	const { db, u, t } = seed();
	const item = addImportantItem(u.id, t.id, { name: 'Keys' });
	deleteImportantItem(u.id, t.id, item.id);
	expect(db.select().from(tripImportantItems).where(eq(tripImportantItems.id, item.id)).get()).toBeUndefined();
});

test('non-editor cannot mutate important items', () => {
	const { u, t, other } = seed();
	const item = addImportantItem(u.id, t.id, { name: 'A' });
	expect(() => addImportantItem(other.id, t.id, { name: 'B' })).toThrow();
	expect(() => deleteImportantItem(other.id, t.id, item.id)).toThrow();
});
