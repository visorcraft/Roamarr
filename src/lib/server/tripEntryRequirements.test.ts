import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	addEntryRequirement,
	deleteEntryRequirement,
	listEntryRequirements,
	updateEntryRequirementStatus
} from './tripEntryRequirements';
import { tripEntryRequirements, trips, users } from './db/schema';
import { eq } from 'drizzle-orm';

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from trip_entry_requirements; delete from trips; delete from users;'
	);
});

function seed() {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'er@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const other = db.insert(users).values({ email: 'oth@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	return { db, u, t, other };
}

test('addEntryRequirement creates a visa requirement', () => {
	const { db, u, t } = seed();
	const req = addEntryRequirement(u.id, t.id, {
		country: 'France',
		requirementType: 'visa',
		status: 'needed',
		dueDate: '2026-06-01',
		notes: 'Apply online'
	});
	expect(req.country).toBe('France');
	expect(req.status).toBe('needed');

	const rows = listEntryRequirements(t.id);
	expect(rows).toHaveLength(1);
	expect(db.select().from(tripEntryRequirements).where(eq(tripEntryRequirements.id, req.id)).get()).toBeTruthy();
});

test('addEntryRequirement defaults status to needed', () => {
	const { u, t } = seed();
	const req = addEntryRequirement(u.id, t.id, { country: 'Brazil', requirementType: 'vaccination' });
	expect(req.status).toBe('needed');
});

test('addEntryRequirement validates type and country', () => {
	const { u, t } = seed();
	expect(() => addEntryRequirement(u.id, t.id, { country: '', requirementType: 'visa' })).toThrow();
	expect(() =>
		addEntryRequirement(u.id, t.id, { country: 'X', requirementType: 'invalid' })
	).toThrowError(expect.objectContaining({ status: 400 }));
});

test('updateEntryRequirementStatus changes status', () => {
	const { u, t } = seed();
	const req = addEntryRequirement(u.id, t.id, { country: 'China', requirementType: 'visa' });
	const updated = updateEntryRequirementStatus(u.id, t.id, req.id, 'complete');
	expect(updated.status).toBe('complete');
	expect(listEntryRequirements(t.id)[0].status).toBe('complete');
});

test('updateEntryRequirementStatus rejects invalid status', () => {
	const { u, t } = seed();
	const req = addEntryRequirement(u.id, t.id, { country: 'X', requirementType: 'other' });
	expect(() => updateEntryRequirementStatus(u.id, t.id, req.id, 'nope')).toThrow();
});

test('deleteEntryRequirement removes the row', () => {
	const { db, u, t } = seed();
	const req = addEntryRequirement(u.id, t.id, { country: 'Y', requirementType: 'other' });
	deleteEntryRequirement(u.id, t.id, req.id);
	expect(db.select().from(tripEntryRequirements).where(eq(tripEntryRequirements.id, req.id)).get()).toBeUndefined();
});

test('non-editor cannot mutate entry requirements', () => {
	const { u, t, other } = seed();
	const req = addEntryRequirement(u.id, t.id, { country: 'Z', requirementType: 'other' });
	expect(() => addEntryRequirement(other.id, t.id, { country: 'A', requirementType: 'other' })).toThrow();
	expect(() => updateEntryRequirementStatus(other.id, t.id, req.id, 'complete')).toThrow();
	expect(() => deleteEntryRequirement(other.id, t.id, req.id)).toThrow();
});
