import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	createCard,
	createCardBenefit,
	updateCard,
	updateCardBenefit,
	deleteCardBenefit
} from '$lib/server/repositories/profileRepo';
import { _addPolicy as addPolicy, _updatePolicy as updatePolicy } from '../insurance/+page.server';
import { users, trips, cards, cardBenefits, insurancePolicies } from '$lib/server/db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import { makeKitUser } from '../../../tests/kitHelpers';
import { createTrip } from '$lib/server/repositories/tripsRepo';

function kitDb(): import('@visorcraft/mongreldb-kit').KitDatabase {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

function makeTestUser(over: any = {}) {
	const kit = kitDb();
	const kitUser = makeKitUser({
		email: over.email,
		password_hash: over.passwordHash,
		display_name: over.displayName,
		role: (over.role as 'admin' | 'user') ?? 'user'
	});
	const row = kit.selectFrom(users).where(eq(users.id, kitUser.id)).executeSync()[0]!;
	return { ...row, id: Number(row.id) };
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(insurancePolicies).executeSync();
	kit.deleteFrom(cardBenefits).executeSync();
	kit.deleteFrom(cards).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('card + benefit are owner-scoped; insurance to foreign trip is rejected', () => {
	const kit = kitDb();
	const a = makeTestUser({ email: 'a@x.c' });
	const b = makeTestUser({ email: 'b@x.c' });
	const bTrip = createTrip(b.id, { name: 'B trip' });
	const card = createCard(a.id, { nickname: 'Sapphire', network: 'visa', last4: '1111' });
	createCardBenefit(a.id, card.id, { benefitType: 'trip_delay', coverageAmount: 50000 });
	expect(kit.selectFrom(cardBenefits).executeSync().length).toBe(1);
	expect(() => addPolicy(a.id, { provider: 'Acme', tripId: bTrip.id })).toThrow();
});

test('createCard never stores a full PAN — only the last 4 digits', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'pan@x.c', passwordHash: 'x', displayName: 'P' });
	const card = createCard(u.id, { nickname: 'Sapphire', network: 'visa', last4: '4111 1111 1111 1234' });
	expect(kit.selectFrom(cards).where(eq(cards.id, BigInt(card.id))).executeSync()[0]!.last4).toBe('1234');
});

test('updateCard edits a card and still only stores the last 4 digits', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'update-card@x.c', passwordHash: 'x', displayName: 'U' });
	const card = createCard(u.id, { nickname: 'Old', network: 'visa', last4: '1234' });
	updateCard(card.id, u.id, {
		nickname: 'Updated',
		network: 'mc',
		last4: '4111 1111 1111 9999',
		notes: 'note'
	});
	const row = kit.selectFrom(cards).where(eq(cards.id, BigInt(card.id))).executeSync()[0]!;
	expect(row.nickname).toBe('Updated');
	expect(row.network).toBe('mc');
	expect(row.last4).toBe('9999');
	expect(row.notes).toBe('note');
});

test('updateCard cannot modify another users card', () => {
	const kit = kitDb();
	const a = makeTestUser({ email: 'a2@x.c' });
	const b = makeTestUser({ email: 'b2@x.c' });
	const card = createCard(a.id, { nickname: 'A card', network: 'visa', last4: '1111' });
	expect(() => updateCard(card.id, b.id, { nickname: 'Hacked', network: 'amex' })).toThrow(
		expect.objectContaining({ status: 404 })
	);
	const row = kit.selectFrom(cards).where(eq(cards.id, BigInt(card.id))).executeSync()[0]!;
	expect(row.nickname).toBe('A card');
	expect(row.network).toBe('visa');
});

test('updateCardBenefit edits a benefit', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'benefit-owner@x.c' });
	const card = createCard(u.id, { nickname: 'Sapphire', network: 'visa' });
	const benefit = createCardBenefit(u.id, card.id, { benefitType: 'trip_delay', coverageAmount: 100 });
	updateCardBenefit(benefit.id, card.id, {
		benefitType: 'baggage_delay',
		coverageAmount: 250,
		currency: 'EUR',
		notes: 'bag notes'
	});
	const row = kit.selectFrom(cardBenefits).where(eq(cardBenefits.id, BigInt(benefit.id))).executeSync()[0]!;
	expect(row.benefit_type).toBe('baggage_delay');
	expect(Number(row.coverage_amount)).toBe(250);
	expect(row.currency).toBe('EUR');
	expect(row.notes).toBe('bag notes');
});

test('deleteCardBenefit removes a benefit', () => {
	const kit = kitDb();
	const u = makeTestUser({ email: 'benefit-delete@x.c' });
	const card = createCard(u.id, { nickname: 'Sapphire', network: 'visa' });
	const benefit = createCardBenefit(u.id, card.id, { benefitType: 'trip_delay' });
	deleteCardBenefit(benefit.id, card.id);
	expect(kit.selectFrom(cardBenefits).where(eq(cardBenefits.id, BigInt(benefit.id))).executeSync()[0]).toBeUndefined();
});

test('updatePolicy edits a policy and rejects a foreign trip', () => {
	const kit = kitDb();
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
	const row = kit.selectFrom(insurancePolicies).where(eq(insurancePolicies.id, BigInt(policy.id))).executeSync()[0]!;
	expect(row.provider).toBe('Allianz');
	expect(row.policy_number).toBe('PN-123');
	expect(row.coverage_summary).toBe('Full coverage');
	expect(Number(row.coverage_amount)).toBe(50000);
	expect(row.start_date).toBe('2025-01-01');
	expect(row.end_date).toBe('2025-12-31');
	expect(row.notes).toBe('policy notes');
	expect(Number(row.trip_id)).toBe(myTrip.id);

	expect(() => updatePolicy(u.id, policy.id, { provider: 'Evil', tripId: otherTrip.id })).toThrow();
});

test('updatePolicy cannot modify another users policy', () => {
	const kit = kitDb();
	const a = makeTestUser({ email: 'ins-a@x.c' });
	const b = makeTestUser({ email: 'ins-b@x.c' });
	const policy = addPolicy(a.id, { provider: 'Acme' });
	expect(() => updatePolicy(b.id, policy.id, { provider: 'Hacked' })).toThrow(
		expect.objectContaining({ status: 404 })
	);
	const row = kit.selectFrom(insurancePolicies).where(eq(insurancePolicies.id, BigInt(policy.id))).executeSync()[0]!;
	expect(row.provider).toBe('Acme');
});
