import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { addHomeTask, deleteHomeTask, listHomeTasks, toggleHomeTask } from './tripHomeTasks';
import { tripHomeTasks, trips, users } from './db/schema';
import { eq } from 'drizzle-orm';

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from trip_home_tasks; delete from trips; delete from users;'
	);
});

function seed() {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'ht@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const other = db.insert(users).values({ email: 'oth@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
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
