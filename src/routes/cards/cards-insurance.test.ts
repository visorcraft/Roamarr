import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	_addCard as addCard,
	_addBenefit as addBenefit,
	_updateCard as updateCard,
	_updateBenefit as updateBenefit,
	_deleteBenefit as deleteBenefit
} from './+page.server';
import { _addPolicy as addPolicy, _updatePolicy as updatePolicy } from '../insurance/+page.server';
import { users, trips, cards, cardBenefits, insurancePolicies } from '$lib/server/db/schema';
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

test('updateCard edits a card and still only stores the last 4 digits', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'update-card@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();
	const card = addCard(u.id, { nickname: 'Old', network: 'visa', last4: '1234' });
	updateCard(u.id, card.id, {
		nickname: 'Updated',
		network: 'mc',
		last4: '4111 1111 1111 9999',
		notes: 'note'
	});
	const row = db.select().from(cards).where(eq(cards.id, card.id)).get()!;
	expect(row.nickname).toBe('Updated');
	expect(row.network).toBe('mc');
	expect(row.last4).toBe('9999');
	expect(row.notes).toBe('note');
});

test('updateCard cannot modify another users card', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'a2@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'b2@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const card = addCard(a.id, { nickname: 'A card', network: 'visa', last4: '1111' });
	updateCard(b.id, card.id, { nickname: 'Hacked', network: 'amex' });
	const row = db.select().from(cards).where(eq(cards.id, card.id)).get()!;
	expect(row.nickname).toBe('A card');
	expect(row.network).toBe('visa');
});

test('updateBenefit edits a benefit and enforces card ownership', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'benefit-owner@x.c', passwordHash: 'x', displayName: 'O' })
		.returning()
		.get();
	const other = db
		.insert(users)
		.values({ email: 'benefit-other@x.c', passwordHash: 'x', displayName: 'X' })
		.returning()
		.get();
	const card = addCard(u.id, { nickname: 'Sapphire', network: 'visa' });
	const benefit = addBenefit(u.id, card.id, { benefitType: 'trip_delay', coverageAmount: 100 });
	updateBenefit(u.id, benefit.id, card.id, {
		benefitType: 'baggage_delay',
		coverageAmount: 250,
		currency: 'EUR',
		notes: 'bag notes'
	});
	const row = db.select().from(cardBenefits).where(eq(cardBenefits.id, benefit.id)).get()!;
	expect(row.benefitType).toBe('baggage_delay');
	expect(row.coverageAmount).toBe(250);
	expect(row.currency).toBe('EUR');
	expect(row.notes).toBe('bag notes');

	const otherCard = addCard(other.id, { nickname: 'Other', network: 'amex' });
	const otherBenefit = addBenefit(other.id, otherCard.id, { benefitType: 'trip_delay' });
	expect(() => updateBenefit(u.id, otherBenefit.id, otherCard.id, { benefitType: 'other' })).toThrow();
});

test('deleteBenefit removes a benefit and enforces card ownership', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'benefit-delete@x.c', passwordHash: 'x', displayName: 'D' })
		.returning()
		.get();
	const other = db
		.insert(users)
		.values({ email: 'benefit-delete-other@x.c', passwordHash: 'x', displayName: 'E' })
		.returning()
		.get();
	const card = addCard(u.id, { nickname: 'Sapphire', network: 'visa' });
	const benefit = addBenefit(u.id, card.id, { benefitType: 'trip_delay' });
	deleteBenefit(u.id, benefit.id, card.id);
	expect(db.select().from(cardBenefits).where(eq(cardBenefits.id, benefit.id)).get()).toBeUndefined();

	const otherCard = addCard(other.id, { nickname: 'Other', network: 'amex' });
	const otherBenefit = addBenefit(other.id, otherCard.id, { benefitType: 'trip_delay' });
	expect(() => deleteBenefit(u.id, otherBenefit.id, otherCard.id)).toThrow();
	expect(db.select().from(cardBenefits).where(eq(cardBenefits.id, otherBenefit.id)).get()).toBeDefined();
});

test('updatePolicy edits a policy and rejects a foreign trip', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'ins-owner@x.c', passwordHash: 'x', displayName: 'I' })
		.returning()
		.get();
	const other = db
		.insert(users)
		.values({ email: 'ins-other@x.c', passwordHash: 'x', displayName: 'J' })
		.returning()
		.get();
	const myTrip = db.insert(trips).values({ ownerId: u.id, name: 'Mine' }).returning().get();
	const otherTrip = db.insert(trips).values({ ownerId: other.id, name: 'Other' }).returning().get();
	const policy = addPolicy(u.id, { provider: 'Acme', tripId: myTrip.id });
	updatePolicy(u.id, policy.id, {
		provider: 'Allianz',
		policyNumber: 'PN-123',
		coverageSummary: 'Full coverage',
		coverageAmount: 50000,
		startDate: '2025-01-01',
		endDate: '2025-12-31',
		tripId: myTrip.id,
		notes: 'policy notes'
	});
	const row = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, policy.id)).get()!;
	expect(row.provider).toBe('Allianz');
	expect(row.policyNumber).toBe('PN-123');
	expect(row.coverageSummary).toBe('Full coverage');
	expect(row.coverageAmount).toBe(50000);
	expect(row.startDate).toBe('2025-01-01');
	expect(row.endDate).toBe('2025-12-31');
	expect(row.notes).toBe('policy notes');
	expect(row.tripId).toBe(myTrip.id);

	expect(() => updatePolicy(u.id, policy.id, { provider: 'Evil', tripId: otherTrip.id })).toThrow();
});

test('updatePolicy cannot modify another users policy', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'ins-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'ins-b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const policy = addPolicy(a.id, { provider: 'Acme' });
	updatePolicy(b.id, policy.id, { provider: 'Hacked' });
	const row = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, policy.id)).get()!;
	expect(row.provider).toBe('Acme');
});
