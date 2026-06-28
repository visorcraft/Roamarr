import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { addHomeTask, deleteHomeTask, listHomeTasks, toggleHomeTask } from './tripHomeTasks';
import { tripHomeTasks, trips, users } from './db/mongrelSchema';
import { eq } from '@mongreldb/kit';
import { makeSyncedUser, makeSyncedTrip } from '../../../tests/helpers';

function getKit() {
	return (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
}

beforeEach(() => {
	const kit = getKit();
	kit.deleteFrom(tripHomeTasks).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

function seed() {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'ht@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const other = makeSyncedUser(kit, { email: 'oth@x.c' });
	return { kit, u, t, other };
}

test('addHomeTask creates a task and lists it', () => {
	const { kit, u, t } = seed();
	const task = addHomeTask(u.id, t.id, { text: 'Hold mail', dueDate: '2026-07-01' });
	expect(task.text).toBe('Hold mail');
	expect(task.dueDate).toBe('2026-07-01');
	expect(task.done).toBe(false);

	const rows = listHomeTasks(t.id);
	expect(rows).toHaveLength(1);
	expect(rows[0].text).toBe('Hold mail');
	expect(kit.selectFrom(tripHomeTasks).where(eq(tripHomeTasks.id, BigInt(task.id))).executeSync()[0]).toBeTruthy();
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
	const { kit, u, t } = seed();
	const task = addHomeTask(u.id, t.id, { text: 'Pack' });
	deleteHomeTask(u.id, t.id, task.id);
	expect(kit.selectFrom(tripHomeTasks).where(eq(tripHomeTasks.id, BigInt(task.id))).executeSync()[0]).toBeUndefined();
});

test('non-editor cannot mutate home tasks', () => {
	const { u, t, other } = seed();
	const task = addHomeTask(u.id, t.id, { text: 'A' });
	expect(() => addHomeTask(other.id, t.id, { text: 'B' })).toThrow();
	expect(() => toggleHomeTask(other.id, t.id, task.id)).toThrow();
	expect(() => deleteHomeTask(other.id, t.id, task.id)).toThrow();
});
