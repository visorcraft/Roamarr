import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { addHomeTask, deleteHomeTask, listHomeTasks, toggleHomeTask } from './tripHomeTasks';
import { tripHomeTasks } from './db/schema';
import {
	tripHomeTasks as kitTripHomeTasks,
	trips as kitTrips,
	users as kitUsers
} from './db/mongrelSchema';
import { eq } from 'drizzle-orm';
import { makeSyncedUser, makeSyncedTrip, resetTables } from '../../../tests/helpers';

function getDb() {
	return (ctx as { db: import('./db').DB }).db;
}

function getKit() {
	return (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
}

beforeEach(() => {
	const sqlite = (ctx as { sqlite: import('better-sqlite3').Database }).sqlite;
	const kit = getKit();
	resetTables(sqlite, 'trip_home_tasks', 'trips', 'users');
	kit.deleteFrom(kitTripHomeTasks).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

function seed() {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(db, kit, { email: 'ht@x.c' });
	const t = makeSyncedTrip(db, kit, { ownerId: u.id, name: 'T' });
	const other = makeSyncedUser(db, kit, { email: 'oth@x.c' });
	return { db, u, t, other };
}

test('addHomeTask creates a task and lists it', () => {
	const { db, u, t } = seed();
	const task = addHomeTask(u.id, t.id, { text: 'Hold mail', dueDate: '2026-07-01' });
	expect(task.text).toBe('Hold mail');
	expect(task.dueDate).toBe('2026-07-01');
	expect(task.done).toBe(false);

	const rows = listHomeTasks(t.id);
	expect(rows).toHaveLength(1);
	expect(rows[0].text).toBe('Hold mail');
	expect(db.select().from(tripHomeTasks).where(eq(tripHomeTasks.id, task.id)).get()).toBeTruthy();
});

test('addHomeTask validates text', () => {
	const { u, t } = seed();
	expect(() => addHomeTask(u.id, t.id, { text: '' })).toThrow();
	expect(() => addHomeTask(u.id, t.id, { text: 'x'.repeat(201) })).toThrow();
});

test('toggleHomeTask flips done state', () => {
	const { u, t } = seed();
	const task = addHomeTask(u.id, t.id, { text: 'Water plants' });
	expect(toggleHomeTask(u.id, t.id, task.id).done).toBe(true);
	expect(toggleHomeTask(u.id, t.id, task.id).done).toBe(false);
});

test('deleteHomeTask removes the task', () => {
	const { db, u, t } = seed();
	const task = addHomeTask(u.id, t.id, { text: 'Pack' });
	deleteHomeTask(u.id, t.id, task.id);
	expect(db.select().from(tripHomeTasks).where(eq(tripHomeTasks.id, task.id)).get()).toBeUndefined();
});

test('non-editor cannot mutate home tasks', () => {
	const { u, t, other } = seed();
	const task = addHomeTask(u.id, t.id, { text: 'A' });
	expect(() => addHomeTask(other.id, t.id, { text: 'B' })).toThrow();
	expect(() => toggleHomeTask(other.id, t.id, task.id)).toThrow();
	expect(() => deleteHomeTask(other.id, t.id, task.id)).toThrow();
});
