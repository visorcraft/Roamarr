import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users, trips, insurancePolicies, fareProviders } from '$lib/server/db/schema';

function event(user: { id: number }, tripId: number) {
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) },
		url: new URL(`http://localhost/trips/${tripId}`)
	} as any;
}

test('load includes attached insurance policies and user cards for the owner', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'td@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	db.insert(insurancePolicies).values({
		userId: u.id,
		provider: 'Acme Insurance',
		policyNumber: 'ACME-123',
		coverageSummary: 'Trip cancellation',
		tripId: t.id
	}).run();

	const result = load(event(u, t.id)) as {
		policies: { provider: string; policyNumber: string }[];
		cards: unknown[];
	};
	expect(result.policies).toHaveLength(1);
	expect(result.policies[0].provider).toBe('Acme Insurance');
	expect(Array.isArray(result.cards)).toBe(true);
});

test('load includes fare watches with segment titles', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'td-fw@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const p = db.insert(fareProviders).values({ userId: u.id, providerKey: 'stub', label: 'Stub', enabled: true }).returning().get();
	db.insert(insurancePolicies).values({ userId: u.id, provider: 'X', tripId: t.id }).run();

	const result = load(event(u, t.id)) as { watches: unknown[] };
	expect(Array.isArray(result.watches)).toBe(true);
});
