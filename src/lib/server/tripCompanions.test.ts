import { test, expect, vi } from 'vitest';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	listTripCompanions,
	insertTripCompanion,
	patchTripCompanion,
	removeTripCompanion,
	addCompanion,
	updateCompanion
} from './tripCompanions';
import { trips, tripCompanions, auditLogs } from '$lib/server/db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import { makeUser, makeTrip } from '../../../tests/helpers';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function event(user: { id: number }, tripId: number, body: URLSearchParams) {
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) },
		request: new Request('http://localhost/trips/' + tripId, {
			method: 'POST',
			body
		})
	} as any;
}

test('insert and list companions', () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'tc@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const a = insertTripCompanion(u.id, t.id, { name: 'Alice', category: 'adult', notes: 'Likes windows' });
	const b = insertTripCompanion(u.id, t.id, { name: 'Bob', category: 'child' });

	const rows = listTripCompanions(t.id);
	expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
	expect(rows[0].notes).toBe('Likes windows');
	expect(rows[1].category).toBe('child');
});

test('patch companion updates fields', () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'patch@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const c = insertTripCompanion(u.id, t.id, { name: 'Charlie', category: 'other' });

	patchTripCompanion(u.id, t.id, c.id, { name: 'Charles', category: 'adult', notes: 'Updated' });
	const row = kit.selectFrom(tripCompanions).where(eq(tripCompanions.id, BigInt(c.id))).executeSync()[0]!;
	expect(row.name).toBe('Charles');
	expect(row.category).toBe('adult');
	expect(row.notes).toBe('Updated');
});

test('remove companion deletes the row', () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'del@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const c = insertTripCompanion(u.id, t.id, { name: 'Dana' });

	removeTripCompanion(u.id, t.id, c.id);
	expect(
		kit.selectFrom(tripCompanions).where(eq(tripCompanions.id, BigInt(c.id))).executeSync()[0]
	).toBeUndefined();
});

test('mutations bump trip updated_at and write audit logs', async () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'audit@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const before = t.updatedAt;

	await sleep(5);
	const c = insertTripCompanion(u.id, t.id, { name: 'Eve' });
	const afterInsert = kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]!.updated_at;
	expect(afterInsert).not.toBe(before);

	removeTripCompanion(u.id, t.id, c.id);
	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync();
	expect(logs.map((l: Record<string, unknown>) => l.action)).toContain('create');
	expect(logs.map((l: Record<string, unknown>) => l.action)).toContain('delete');
});

test('non-editor cannot mutate companions', () => {
	const kit = getKit();
	const owner = makeUser(kit, { email: 'owner@x.c', passwordHash: 'x', displayName: 'O' });
	const other = makeUser(kit, { email: 'other@x.c', passwordHash: 'x', displayName: 'X' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const c = insertTripCompanion(owner.id, t.id, { name: 'Mallory' });

	expect(() => insertTripCompanion(other.id, t.id, { name: 'Eve' })).toThrow();
	expect(() => patchTripCompanion(other.id, t.id, c.id, { name: 'Eve' })).toThrow();
	expect(() => removeTripCompanion(other.id, t.id, c.id)).toThrow();
});

test('addCompanion action creates a companion and redirects', async () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'add@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	await expect(
		addCompanion(event(u, t.id, new URLSearchParams({ name: 'Alice', category: 'adult', notes: 'A' })))
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const rows = kit.selectFrom(tripCompanions).where(eq(tripCompanions.trip_id, BigInt(t.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].name).toBe('Alice');
});

test('updateCompanion action updates a companion and redirects', async () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'upd@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const c = insertTripCompanion(u.id, t.id, { name: 'Ben', category: 'child' });

	await expect(
		updateCompanion(
			event(
				u,
				t.id,
				new URLSearchParams({ companionId: String(c.id), name: 'Benjamin', category: 'adult' })
			)
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const row = kit.selectFrom(tripCompanions).where(eq(tripCompanions.id, BigInt(c.id))).executeSync()[0]!;
	expect(row.name).toBe('Benjamin');
	expect(row.category).toBe('adult');
});

test('action handlers reject invalid input with fail(400)', async () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'bad@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const addResult = await addCompanion(event(u, t.id, new URLSearchParams({ name: '' })));
	expect(addResult).toMatchObject({ status: 400, data: { error: expect.any(String) } });

	const updateResult = await updateCompanion(
		event(u, t.id, new URLSearchParams({ companionId: '1', name: '', category: 'wizard' }))
	);
	expect(updateResult).toMatchObject({ status: 400, data: { errors: expect.any(Object) } });
});

test('insert and list companion with dietary, allergy, and medical notes', () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'notes@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const c = insertTripCompanion(u.id, t.id, {
		name: 'Sam',
		category: 'adult',
		dietary: 'Vegetarian',
		allergies: 'Peanuts, shellfish',
		medicalNotes: 'Carries an EpiPen'
	});
	expect(c.dietary).toBe('Vegetarian');
	expect(c.allergies).toBe('Peanuts, shellfish');
	expect(c.medicalNotes).toBe('Carries an EpiPen');

	const rows = listTripCompanions(t.id);
	expect(rows[0].dietary).toBe('Vegetarian');
	expect(rows[0].allergies).toBe('Peanuts, shellfish');
	expect(rows[0].medicalNotes).toBe('Carries an EpiPen');
});

test('patch companion updates dietary, allergy, and medical notes', () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'patchnotes@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const c = insertTripCompanion(u.id, t.id, { name: 'Taylor', category: 'child' });

	patchTripCompanion(u.id, t.id, c.id, {
		dietary: 'Gluten-free',
		allergies: 'Dairy',
		medicalNotes: 'Asthma inhaler'
	});
	const row = kit.selectFrom(tripCompanions).where(eq(tripCompanions.id, BigInt(c.id))).executeSync()[0]!;
	expect(row.dietary).toBe('Gluten-free');
	expect(row.allergies).toBe('Dairy');
	expect(row.medical_notes).toBe('Asthma inhaler');
});

test('insert and list companion preferences and kid gear needs', () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'pref@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const c = insertTripCompanion(u.id, t.id, {
		name: 'Jordan',
		category: 'child',
		needsCarSeat: true,
		needsStroller: true,
		needsCrib: true,
		needsKidsMeal: true,
		childTicketDiscount: 'child',
		seatPreference: 'window',
		bedPreference: 'twin',
		accessibilityNeeds: 'Sensory friendly seating',
		roomNotes: 'Connecting room'
	});
	expect(c.needsCarSeat).toBe(true);
	expect(c.seatPreference).toBe('window');
	expect(c.bedPreference).toBe('twin');

	const row = kit.selectFrom(tripCompanions).where(eq(tripCompanions.id, BigInt(c.id))).executeSync()[0]!;
	expect(row.needs_car_seat).toBe(true);
	expect(row.needs_stroller).toBe(true);
	expect(row.needs_crib).toBe(true);
	expect(row.needs_kids_meal).toBe(true);
	expect(row.child_ticket_discount).toBe('child');
	expect(row.accessibility_needs).toBe('Sensory friendly seating');
	expect(row.room_notes).toBe('Connecting room');
});

test('patch companion updates preferences and gear needs', () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'patchpref@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const c = insertTripCompanion(u.id, t.id, { name: 'Taylor', category: 'child' });

	patchTripCompanion(u.id, t.id, c.id, {
		seatPreference: 'aisle',
		bedPreference: 'king',
		needsCarSeat: true,
		needsCrib: false,
		accessibilityNeeds: 'Wheelchair accessible room'
	});
	const row = kit.selectFrom(tripCompanions).where(eq(tripCompanions.id, BigInt(c.id))).executeSync()[0]!;
	expect(row.seat_preference).toBe('aisle');
	expect(row.bed_preference).toBe('king');
	expect(row.needs_car_seat).toBe(true);
	expect(row.needs_crib).toBe(false);
	expect(row.accessibility_needs).toBe('Wheelchair accessible room');
});

test('companion notes are rejected above max length', async () => {
	const kit = getKit();
	const u = makeUser(kit, { email: 'long@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const long = 'x'.repeat(1001);
	const result = await addCompanion(
		event(
			u,
			t.id,
			new URLSearchParams({ name: 'Long', dietary: long, allergies: long, medicalNotes: long })
		)
	);
	expect(result).toMatchObject({ status: 400, data: { errors: expect.any(Object) } });
	const errors = (result as { data: { errors: Record<string, string> } }).data.errors;
	expect(errors.dietary).toContain('1000');
	expect(errors.allergies).toContain('1000');
	expect(errors.medicalNotes).toContain('1000');

	const rows = kit.selectFrom(tripCompanions).where(eq(tripCompanions.trip_id, BigInt(t.id))).executeSync();
	expect(rows).toHaveLength(0);
});
