import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('$lib/server/db').DB,
	sqlite: null as unknown as any,
	kit: null as unknown as import('@mongreldb/kit').KitDatabase
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _addBenefit as addBenefit, load } from './+page.server';
import { _addCard as addCard } from './+page.server';
import { cardBenefits, users } from '$lib/server/db/mongrelSchema';
import { listBenefitTemplates } from '$lib/server/benefitTemplates';
import { cardBenefits as kitCardBenefits, cards as kitCards, users as kitUsers } from '$lib/server/db/mongrelSchema';
import { eq } from '@mongreldb/kit';
import { makeKitUser } from '../../../tests/kitHelpers';

function makeTestUser(over: any = {}) {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const kitUser = makeKitUser({
		email: over.email,
		password_hash: over.passwordHash,
		display_name: over.displayName,
		role: (over.role as 'admin' | 'user') ?? 'user'
	});
	return db.select().from(users).where(eq(users.id, BigInt(kitUser.id))).get()!;
}

beforeEach(() => {
	ctx.sqlite.exec('delete from card_benefits; delete from cards; delete from users;');
	ctx.kit.deleteFrom(kitCardBenefits).executeSync();
	ctx.kit.deleteFrom(kitCards).executeSync();
	ctx.kit.deleteFrom(kitUsers).executeSync();
});

test('load returns benefit templates', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser();
	const data = load({ locals: { user: u } } as Parameters<typeof load>[0]) as {
		templates: Array<unknown>;
		cards: Array<unknown>;
	};
	expect(data.templates.length).toBeGreaterThanOrEqual(3);
	expect(data.cards).toEqual([]);
});

test('addBenefit applies a chosen template', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser();
	const card = addCard(u.id, { nickname: 'Sapphire', network: 'visa' });
	const template = listBenefitTemplates().find((t) => t.benefitType === 'trip_delay')!;

	addBenefit(u.id, card.id, { templateId: template.id });
	const allBenefits = db.select().from(cardBenefits).all();
	const benefit = allBenefits[0]!;
	expect(benefit.benefitType).toBe(template.benefitType);
	expect(benefit.coverageAmount).toBe(template.coverageAmount);
	expect(benefit.currency).toBe(template.currency);
});

test('addBenefit still works without a template', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser();
	const card = addCard(u.id, { nickname: 'Freedom', network: 'mc' });

	addBenefit(u.id, card.id, { benefitType: 'other', coverageAmount: 123, currency: 'EUR', notes: 'manual' });
	const benefit = db.select().from(cardBenefits).get()!;
	expect(benefit.benefitType).toBe('other');
	expect(benefit.coverageAmount).toBe(123);
	expect(benefit.currency).toBe('EUR');
	expect(benefit.notes).toBe('manual');
});

test('addBenefit rejects a missing template id', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeTestUser();
	const card = addCard(u.id, { nickname: 'Platinum', network: 'amex' });

	try {
		addBenefit(u.id, card.id, { templateId: 99999 });
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
	expect(db.select().from(cardBenefits).all().length).toBe(0);
});

test('addBenefit with template still enforces card ownership', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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
