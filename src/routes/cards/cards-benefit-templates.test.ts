import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _addBenefit as addBenefit, load } from './+page.server';
import { _addCard as addCard } from './+page.server';
import { cardBenefits, benefitTemplates } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { makeUser } from '../../../tests/helpers';
import { beforeEach } from 'vitest';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from card_benefits; delete from cards; delete from users;');
});

test('load returns benefit templates', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser(db);
	const data = load({ locals: { user: u } } as Parameters<typeof load>[0]) as {
		templates: Array<unknown>;
		cards: Array<unknown>;
	};
	expect(data.templates.length).toBeGreaterThanOrEqual(3);
	expect(data.cards).toEqual([]);
});

test('addBenefit applies a chosen template', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser(db);
	const card = addCard(u.id, { nickname: 'Sapphire', network: 'visa' });
	const template = db.select().from(benefitTemplates).where(eq(benefitTemplates.benefitType, 'trip_delay')).get()!;

	addBenefit(u.id, card.id, { templateId: template.id });
	const benefit = db.select().from(cardBenefits).get()!;
	expect(benefit.benefitType).toBe(template.benefitType);
	expect(benefit.coverageAmount).toBe(template.coverageAmount);
	expect(benefit.currency).toBe(template.currency);
});

test('addBenefit still works without a template', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser(db);
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
	const u = makeUser(db);
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
	const a = makeUser(db, { email: 'a@x.c' });
	const b = makeUser(db, { email: 'b@x.c' });
	const aCard = addCard(a.id, { nickname: 'A card', network: 'visa' });
	const template = db.select().from(benefitTemplates).get()!;

	try {
		addBenefit(b.id, aCard.id, { templateId: template.id });
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});
