import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _addBenefit as addBenefit, load } from './+page.server';
import { _addCard as addCard } from './+page.server';
import { cardBenefits, cards, users } from '$lib/server/db/mongrelSchema';
import { listBenefitTemplates } from '$lib/server/benefitTemplates';
import { eq } from '@mongreldb/kit';
import { makeKitUser } from '../../../tests/kitHelpers';

function kitDb(): import('@mongreldb/kit').KitDatabase {
	return (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
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
	kit.deleteFrom(cardBenefits).executeSync();
	kit.deleteFrom(cards).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('load returns benefit templates', () => {
	const u = makeTestUser();
	const data = load({ locals: { user: u } } as unknown as Parameters<typeof load>[0]) as {
		templates: Array<unknown>;
		cards: Array<unknown>;
	};
	expect(data.templates.length).toBeGreaterThanOrEqual(3);
	expect(data.cards).toEqual([]);
});

test('addBenefit applies a chosen template', () => {
	const kit = kitDb();
	const u = makeTestUser();
	const card = addCard(u.id, { nickname: 'Sapphire', network: 'visa' });
	const template = listBenefitTemplates().find((t) => t.benefitType === 'trip_delay')!;

	addBenefit(u.id, card.id, { templateId: template.id });
	const allBenefits = kit.selectFrom(cardBenefits).executeSync();
	const benefit = allBenefits[0]!;
	expect(benefit.benefit_type).toBe(template.benefitType);
	expect(Number(benefit.coverage_amount)).toBe(template.coverageAmount);
	expect(benefit.currency).toBe(template.currency);
});

test('addBenefit still works without a template', () => {
	const kit = kitDb();
	const u = makeTestUser();
	const card = addCard(u.id, { nickname: 'Freedom', network: 'mc' });

	addBenefit(u.id, card.id, { benefitType: 'other', coverageAmount: 123, currency: 'EUR', notes: 'manual' });
	const benefit = kit.selectFrom(cardBenefits).executeSync()[0]!;
	expect(benefit.benefit_type).toBe('other');
	expect(Number(benefit.coverage_amount)).toBe(123);
	expect(benefit.currency).toBe('EUR');
	expect(benefit.notes).toBe('manual');
});

test('addBenefit rejects a missing template id', () => {
	const kit = kitDb();
	const u = makeTestUser();
	const card = addCard(u.id, { nickname: 'Platinum', network: 'amex' });

	try {
		addBenefit(u.id, card.id, { templateId: 99999 });
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
	expect(kit.selectFrom(cardBenefits).executeSync().length).toBe(0);
});

test('addBenefit with template still enforces card ownership', () => {
	const a = makeTestUser({ email: 'a@x.c' });
	const b = makeTestUser({ email: 'b@x.c' });
	const aCard = addCard(a.id, { nickname: 'A card', network: 'visa' });
	const template = listBenefitTemplates()[0]!;

	try {
		addBenefit(b.id, aCard.id, { templateId: template.id });
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});
