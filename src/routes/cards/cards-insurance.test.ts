import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _addCard as addCard, _addBenefit as addBenefit } from './+page.server';
import { _addPolicy as addPolicy } from '../insurance/+page.server';
import { users, trips, cards, cardBenefits } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

test('card + benefit are owner-scoped; insurance to foreign trip is rejected', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const bTrip = db.insert(trips).values({ ownerId: b.id, name: 'B trip' }).returning().get();
	const card = addCard(a.id, { nickname: 'Sapphire', network: 'visa', last4: '1111' });
	addBenefit(a.id, card.id, { benefitType: 'trip_delay', coverageAmount: 50000 });
	expect(db.select().from(cardBenefits).all().length).toBe(1);
	expect(() => addPolicy(a.id, { provider: 'Acme', tripId: bTrip.id })).toThrow();
});

test('addCard never stores a full PAN — only the last 4 digits', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'pan@x.c', passwordHash: 'x', displayName: 'P' })
		.returning()
		.get();
	const card = addCard(u.id, { nickname: 'Sapphire', network: 'visa', last4: '4111 1111 1111 1234' });
	expect(db.select().from(cards).where(eq(cards.id, card.id)).get()!.last4).toBe('1234');
});
