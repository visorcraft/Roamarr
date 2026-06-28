import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { addMedication, deleteMedication, listMedications } from './tripMedications';
import { tripMedications } from './db/schema';
import {
	tripMedications as kitTripMedications,
	tripCompanions as kitTripCompanions,
	trips as kitTrips,
	users as kitUsers
} from './db/mongrelSchema';
import { eq } from 'drizzle-orm';
import {
	makeSyncedUser,
	makeSyncedTrip,
	makeSyncedCompanion
} from '../../../tests/helpers';

function getDb() {
	return (ctx as { db: import('./db').DB }).db;
}

function getKit() {
	return (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
}

beforeEach(() => {
	const kit = getKit();
	kit.deleteFrom(kitTripMedications).executeSync();
	kit.deleteFrom(kitTripCompanions).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

function seed() {
	const db = getDb();
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'med@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const c = makeSyncedCompanion(kit, { tripId: t.id, name: 'Sam', category: 'child' });
	const other = makeSyncedUser(kit, { email: 'oth@x.c' });
	return { db, u, t, c, other };
}

test('addMedication creates a schedule with companion name', () => {
	const { db, u, t, c } = seed();
	const med = addMedication(u.id, t.id, {
		name: 'Claritin',
		companionId: c.id,
		dosage: '5mg',
		schedule: 'daily',
		startsAt: '2026-07-01T09:00:00Z',
		endsAt: '2026-07-10T09:00:00Z',
		notes: 'With breakfast'
	});
	expect(med.name).toBe('Claritin');
	expect(med.companionId).toBe(c.id);

	const rows = listMedications(t.id);
	expect(rows).toHaveLength(1);
	expect(rows[0].companionName).toBe('Sam');
	expect(db.select().from(tripMedications).where(eq(tripMedications.id, med.id)).get()).toBeTruthy();
});

test('addMedication rejects unknown companion', () => {
	const { u, t } = seed();
	expect(() => addMedication(u.id, t.id, { name: 'X', companionId: 999 })).toThrowError(
		expect.objectContaining({ status: 400 })
	);
});

test('addMedication without companion is allowed', () => {
	const { u, t } = seed();
	const med = addMedication(u.id, t.id, { name: 'Advil' });
	expect(med.companionId).toBeNull();
	expect(listMedications(t.id)[0].companionName).toBeNull();
});

test('deleteMedication removes the schedule', () => {
	const { db, u, t } = seed();
	const med = addMedication(u.id, t.id, { name: 'Zyrtec' });
	deleteMedication(u.id, t.id, med.id);
	expect(db.select().from(tripMedications).where(eq(tripMedications.id, med.id)).get()).toBeUndefined();
});

test('non-editor cannot mutate medications', () => {
	const { u, t, other } = seed();
	const med = addMedication(u.id, t.id, { name: 'A' });
	expect(() => addMedication(other.id, t.id, { name: 'B' })).toThrow();
	expect(() => deleteMedication(other.id, t.id, med.id)).toThrow();
});
