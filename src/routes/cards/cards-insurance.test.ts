import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('$lib/server/db').DB,
	sqlite: null as unknown as import('better-sqlite3').Database,
	kit: null as unknown as import('@mongreldb/kit').KitDatabase
}));
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
import {
	cards as kitCards,
	cardBenefits as kitCardBenefits,
	insurancePolicies as kitInsurancePolicies,
	trips as kitTrips,
	users as kitUsers
} from '$lib/server/db/mongrelSchema';
import { eq } from 'drizzle-orm';
import { makeKitUser } from '../../../tests/kitHelpers';
import { createTrip } from '$lib/server/repositories/tripsRepo';

function makeTestUser(over: Partial<typeof users.$inferInsert> = {}) {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const kitUser = makeKitUser({
		email: over.email,
		password_hash: over.passwordHash,
		display_name: over.displayName,
		role: (over.role as 'admin' | 'user') ?? 'user'
	});
	return db.select().from(users).where(eq(users.id, Number(kitUser.id))).get()!;
}

beforeEach(() => {
	ctx.sqlite.exec(
		'delete from insurance_policies; delete from card_benefits; delete from cards; delete from trips; delete from users;'
	);
	ctx.kit.deleteFrom(kitInsurancePolicies).executeSync();
	ctx.kit.deleteFrom(kitCardBenefits).executeSync();
	ctx.kit.deleteFrom(kitCards).executeSync();
	ctx.kit.deleteFrom(kitTrips).executeSync();
	ctx.kit.deleteFrom(kitUsers).executeSync();
});

test('card + benefit are owner-scoped; insurance to foreign trip is rejected', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeTestUser({ email: 'a@x.c' });
	const b = makeTestUser({ email: 'b@x.c' });
	const bTrip = createTrip(b.id, { name: 'B trip' });
	const card = addCard(a.id, { nickname: 'Sapphire', network: 'visa', last4: '1111' });
	addBenefit(a.id, card.id, { benefitType: 'trip_delay', coverageAmount: 50000 });
	expect(db.select().from(cardBenefits).all().length).toBe(1);
	expect(() => addPolicy(a.id, { provider: 'Acme', tripId: bTrip.id })).toThrow();
});

test('addCard never stores a full PAN — only the last 4 digits', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'pan@x.c', passwordHash: 'x', displayName: 'P' });
	const card = addCard(u.id, { nickname: 'Sapphire', network: 'visa', last4: '4111 1111 1111 1234' });
	expect(db.select().from(cards).where(eq(cards.id, card.id)).get()!.last4).toBe('1234');
});

test('updateCard edits a card and still only stores the last 4 digits', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'update-card@x.c', passwordHash: 'x', displayName: 'U' });
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
	const a = makeTestUser({ email: 'a2@x.c' });
	const b = makeTestUser({ email: 'b2@x.c' });
	const card = addCard(a.id, { nickname: 'A card', network: 'visa', last4: '1111' });
	expect(() => updateCard(b.id, card.id, { nickname: 'Hacked', network: 'amex' })).toThrow(
		expect.objectContaining({ status: 404 })
	);
	const row = db.select().from(cards).where(eq(cards.id, card.id)).get()!;
	expect(row.nickname).toBe('A card');
	expect(row.network).toBe('visa');
});

test('updateBenefit edits a benefit and enforces card ownership', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser({ email: 'benefit-owner@x.c' });
	const other = makeTestUser({ email: 'benefit-other@x.c' });
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
	const u = makeTestUser({ email: 'benefit-delete@x.c' });
	const other = makeTestUser({ email: 'benefit-delete-other@x.c' });
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
	const u = makeTestUser({ email: 'ins-owner@x.c' });
	const other = makeTestUser({ email: 'ins-other@x.c' });
	const myTrip = createTrip(u.id, { name: 'Mine' });
	const otherTrip = createTrip(other.id, { name: 'Other' });
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
	const a = makeTestUser({ email: 'ins-a@x.c' });
	const b = makeTestUser({ email: 'ins-b@x.c' });
	const policy = addPolicy(a.id, { provider: 'Acme' });
	expect(() => updatePolicy(b.id, policy.id, { provider: 'Hacked' })).toThrow(
		expect.objectContaining({ status: 404 })
	);
	const row = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, policy.id)).get()!;
	expect(row.provider).toBe('Acme');
});
