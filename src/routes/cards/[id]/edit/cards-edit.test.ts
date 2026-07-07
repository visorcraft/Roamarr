import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(cardBenefits).executeSync();
	ctx.kit.deleteFrom(cards).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { cards, cardBenefits, auditLogs, users } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { listBenefitTemplates } from '$lib/server/benefitTemplates';
import { makeUser } from '../../../../../tests/helpers';
import { createCard, createCardBenefit } from '$lib/server/repositories/profileRepo';

function event(user: { id: number } | null, params: Record<string, string>, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		params,
		request: body ? ({ formData: async () => body } as Request) : undefined
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null, { id: '1' }))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns 404 for a missing or non-owned card', () => {
	const user = makeUser(ctx.kit);
	expect(() => load(event(user, { id: '999' }))).toThrow(
		expect.objectContaining({ status: 404 })
	);
});

test('load returns card, benefits, and templates', () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	const benefit = createCardBenefit(user.id, card.id, { benefitType: 'trip_delay', coverageAmount: 100 });

	const result = load(event(user, { id: String(card.id) })) as {
		card: { id: number; nickname: string };
		benefits: Array<{ id: number }>;
		templates: Array<unknown>;
	};
	expect(result.card.id).toBe(card.id);
	expect(result.card.nickname).toBe('Sapphire');
	expect(result.benefits).toHaveLength(1);
	expect(result.benefits[0].id).toBe(benefit.id);
	expect(result.templates.length).toBeGreaterThanOrEqual(1);
});

test('updateCard action edits an owned card, logs audit, and redirects', async () => {
	const user = makeUser(ctx.kit);
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const card = createCard(user.id, { nickname: 'Old', network: 'visa', last4: '1234' });

	const f = new FormData();
	f.set('nickname', 'Updated');
	f.set('network', 'mc');
	f.set('last4', '9999');
	f.set('notes', 'Updated notes');

	await expect(actions.updateCard(event(user, { id: String(card.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(cards).where(kitEq(cards.id, BigInt(card.id))).executeSync()[0];
	expect(row!.nickname).toBe('Updated');
	expect(row!.network).toBe('mc');
	expect(row!.last4).toBe('9999');
	expect(row!.notes).toBe('Updated notes');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('card_update');
	expect(logs[0].entity_type).toBe('card');
	expect(Number(logs[0].entity_id)).toBe(card.id);

	const hijack = new FormData();
	hijack.set('nickname', 'Hijacked');
	hijack.set('network', 'amex');
	await expect(actions.updateCard(event(other, { id: String(card.id) }, hijack))).rejects.toMatchObject({
		status: 404
	});

	const after = ctx.kit.selectFrom(cards).where(kitEq(cards.id, BigInt(card.id))).executeSync()[0];
	expect(after!.nickname).toBe('Updated');
});

test('addBenefit action returns 404 for an invalid templateId', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });

	const f = new FormData();
	f.set('templateId', '999999');

	const result = await actions.addBenefit(event(user, { id: String(card.id) }, f));
	expect(result).toEqual(
		expect.objectContaining({ status: 404, data: { error: 'Template not found' } })
	);
});

test('addBenefit action creates a benefit from a template', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	const template = listBenefitTemplates().find((t) => t.benefitType === 'trip_delay')!;

	const f = new FormData();
	f.set('templateId', String(template.id));

	await expect(actions.addBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(cardBenefits).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].benefit_type).toBe(template.benefitType);
	expect(Number(rows[0].coverage_amount)).toBe(template.coverageAmount);
	expect(rows[0].currency).toBe(template.currency);

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('card_benefit_create');
});

test('addBenefit action creates a custom benefit', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Freedom', network: 'mc' });

	const f = new FormData();
	f.set('benefitType', 'other');
	f.set('coverageAmount', '123');
	f.set('currency', 'EUR');
	f.set('notes', 'manual');

	await expect(actions.addBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(cardBenefits).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].benefit_type).toBe('other');
	expect(Number(rows[0].coverage_amount)).toBe(123);
	expect(rows[0].currency).toBe('EUR');
	expect(rows[0].notes).toBe('manual');
});

test('updateBenefit action edits a benefit and logs audit', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	const benefit = createCardBenefit(user.id, card.id, { benefitType: 'trip_delay', coverageAmount: 100 });

	const f = new FormData();
	f.set('id', String(benefit.id));
	f.set('benefitType', 'baggage_delay');
	f.set('coverageAmount', '250');
	f.set('currency', 'EUR');
	f.set('notes', 'bag notes');

	await expect(actions.updateBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(cardBenefits).where(kitEq(cardBenefits.id, BigInt(benefit.id))).executeSync()[0];
	expect(row!.benefit_type).toBe('baggage_delay');
	expect(Number(row!.coverage_amount)).toBe(250);
	expect(row!.currency).toBe('EUR');
	expect(row!.notes).toBe('bag notes');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('card_benefit_update');
	expect(Number(logs[0].entity_id)).toBe(benefit.id);
});

test('deleteBenefit action removes a benefit and logs audit', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	const benefit = createCardBenefit(user.id, card.id, { benefitType: 'trip_delay' });

	const f = new FormData();
	f.set('id', String(benefit.id));

	await expect(actions.deleteBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(cardBenefits).executeSync();
	expect(rows).toHaveLength(0);

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('card_benefit_delete');
	expect(Number(logs[0].entity_id)).toBe(benefit.id);
});
