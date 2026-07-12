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
import { trips, tripCompanions, tripShares, tripInvitations, auditLogs } from '$lib/server/db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import { makeUser, makeTrip } from '../../../tests/helpers';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function event(user: { id: number }, tripId: number, body: URLSearchParams) {
	const url = new URL('http://localhost/trips/' + tripId);
	return {
		locals: { user } as App.Locals,
		cookies: { set: vi.fn() },
		params: { id: String(tripId) },
		url,
		request: new Request(url, {
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
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}#people` });

	const rows = kit.selectFrom(tripCompanions).where(eq(tripCompanions.trip_id, BigInt(t.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].name).toBe('Alice');
});

test('addCompanion shares an existing Roamarr user without claiming self identity', async () => {
	const kit = getKit();
	const owner = makeUser(kit, { email: 'invite-owner@x.c', passwordHash: 'x', displayName: 'Owner' });
	const guest = makeUser(kit, { email: 'invite-guest@x.c', passwordHash: 'x', displayName: 'Guest' });
	const t = makeTrip(kit, owner.id, { name: 'T' });

	await expect(
		addCompanion(
			event(
				owner,
				t.id,
				new URLSearchParams({
					name: 'Typed name',
					selectedUserId: String(guest.id),
					category: 'adult',
					invite: '1',
					email: guest.email,
					permission: 'edit'
				})
			)
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}#people` });

	const companion = kit.selectFrom(tripCompanions).where(eq(tripCompanions.trip_id, BigInt(t.id))).executeSync()[0]!;
	const share = kit.selectFrom(tripShares).where(eq(tripShares.trip_id, BigInt(t.id))).executeSync()[0]!;
	expect(companion.name).toBe('Guest');
	expect(companion.user_id).toBeNull();
	expect(share.shared_with_user_id).toBe(BigInt(guest.id));
	expect(share.permission).toBe('edit');
});

test('guide and driver categories work but reject invitations', async () => {
	const kit = getKit();
	const owner = makeUser(kit, { email: 'roles-owner@x.c', passwordHash: 'x', displayName: 'Owner' });
	const guest = makeUser(kit, { email: 'roles-guest@x.c', passwordHash: 'x', displayName: 'Guest' });
	const t = makeTrip(kit, owner.id, { name: 'T' });

	insertTripCompanion(owner.id, t.id, { name: 'Guide', category: 'guide' });
	insertTripCompanion(owner.id, t.id, { name: 'Driver', category: 'driver' });
	expect(listTripCompanions(t.id).map((person) => person.category)).toEqual(['guide', 'driver']);

	const result = await addCompanion(
		event(owner, t.id, new URLSearchParams({ name: 'Nope', category: 'guide', invite: '1', email: guest.email }))
	);
	expect(result).toMatchObject({ status: 400, data: { error: expect.stringContaining('cannot be invited') } });
});

test('addCompanion creates a pending invitation for a new email', async () => {
	const kit = getKit();
	const owner = makeUser(kit, { email: 'new-owner@x.c', passwordHash: 'x', displayName: 'Owner' });
	const trip = makeTrip(kit, owner.id, { name: 'T' });
	await expect(addCompanion(event(owner, trip.id, new URLSearchParams({ name: 'New Person', category: 'adult', invite: '1', email: 'new-person@x.c', permission: 'read' })))).rejects.toMatchObject({ status: 303, location: `/trips/${trip.id}#people` });
	expect(kit.selectFrom(tripCompanions).where(eq(tripCompanions.trip_id, BigInt(trip.id))).executeSync()).toHaveLength(1);
	expect(kit.selectFrom(tripShares).where(eq(tripShares.trip_id, BigInt(trip.id))).executeSync()).toHaveLength(0);
	expect(kit.selectFrom(tripInvitations).where(eq(tripInvitations.trip_id, BigInt(trip.id))).executeSync()[0].email).toBe('new-person@x.c');
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
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}#people` });

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
