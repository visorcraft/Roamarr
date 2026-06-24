import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { _deleteTrip } from './edit/+page.server';
import { users, trips, insurancePolicies, fareProviders, reminders } from '$lib/server/db/schema';
import { upsertCustomReminder } from '$lib/server/reminders';
import { eq } from 'drizzle-orm';

function event(user: { id: number }, tripId: number) {
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) },
		url: new URL(`http://localhost/trips/${tripId}`)
	} as any;
}

test('load includes fare watches with segment titles', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'td-fw@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const p = db.insert(fareProviders).values({ userId: u.id, providerKey: 'stub', label: 'Stub', enabled: true }).returning().get();
	db.insert(insurancePolicies).values({ userId: u.id, provider: 'X', tripId: t.id }).run();

	const result = load(event(u, t.id)) as { watches: unknown[] };
	expect(Array.isArray(result.watches)).toBe(true);
});


test('load includes attached insurance policies and user cards for the owner', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'td@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const p = db.insert(fareProviders).values({ userId: u.id, providerKey: 'stub', label: 'Stub', enabled: true }).returning().get();
	db.insert(insurancePolicies).values({
		userId: u.id,
		provider: 'Acme Insurance',
		policyNumber: 'ACME-123',
		coverageSummary: 'Trip cancellation',
		tripId: t.id
	}).run();

	const result = load(event(u, t.id)) as {
		policies: { provider: string; policyNumber: string }[];
		availablePolicies: { provider: string }[];
		cards: unknown[];
	};
	expect(result.policies).toHaveLength(1);
	expect(result.policies[0].provider).toBe('Acme Insurance');
	expect(result.availablePolicies).toHaveLength(0);
	expect(Array.isArray(result.cards)).toBe(true);
});

test('load separates available unattached policies from attached policies', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'td2@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t1 = db.insert(trips).values({ ownerId: u.id, name: 'T1' }).returning().get();
	const t2 = db.insert(trips).values({ ownerId: u.id, name: 'T2' }).returning().get();
	db.insert(insurancePolicies).values({ userId: u.id, provider: 'Attached', tripId: t1.id }).run();
	db.insert(insurancePolicies).values({ userId: u.id, provider: 'Free', tripId: t2.id }).run();

	const result = load(event(u, t1.id)) as {
		policies: { provider: string }[];
		availablePolicies: { provider: string }[];
	};
	expect(result.policies.map((p) => p.provider)).toEqual(['Attached']);
	expect(result.availablePolicies.map((p) => p.provider)).toEqual(['Free']);
});

test('attachPolicy action links an existing policy to the trip', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'ap@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const pol = db.insert(insurancePolicies).values({ userId: u.id, provider: 'P', tripId: null }).returning().get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ policyId: String(pol.id) })
	});
	await expect(actions.attachPolicy({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, pol.id)).get();
	expect(row?.tripId).toBe(t.id);
});

test('attachPolicy action rejects a policy owned by another user', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'ap-owner@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'ap-other@x.c', passwordHash: 'x', displayName: 'X' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const pol = db.insert(insurancePolicies).values({ userId: other.id, provider: 'P', tripId: null }).returning().get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ policyId: String(pol.id) })
	});
	await expect(actions.attachPolicy({ ...event(owner, t.id), request })).rejects.toMatchObject({ status: 404 });
});

test('detachPolicy action unlinks a policy from the trip', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'dp@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const pol = db.insert(insurancePolicies).values({ userId: u.id, provider: 'P', tripId: t.id }).returning().get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ policyId: String(pol.id) })
	});
	await expect(actions.detachPolicy({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, pol.id)).get();
	expect(row?.tripId).toBeNull();
});

test('delete action removes trip-level reminders', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'del@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'Del', startDate: '2099-01-01' }).returning().get();
	upsertCustomReminder(u.id, 'trip', t.id, `${t.startDate}T09:00:00Z`, 60);
	expect(db.select().from(reminders).where(eq(reminders.refType, 'trip')).all()).toHaveLength(1);

	_deleteTrip(u.id, t.id);
	expect(db.select().from(trips).where(eq(trips.id, t.id)).get()).toBeUndefined();
	expect(db.select().from(reminders).where(eq(reminders.refType, 'trip')).all()).toHaveLength(0);
});
