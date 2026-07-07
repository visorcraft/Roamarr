import { test, expect, vi, beforeEach, afterAll } from 'vitest';
import { resetRateLimit } from '$lib/server/rateLimit';

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
	resetRateLimit();
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

function event(
	user: { id: number } | null,
	params: Record<string, string>,
	body?: FormData,
	clientAddress = '127.0.0.1'
) {
	return {
		locals: { user } as App.Locals,
		params,
		request: body ? ({ formData: async () => body } as Request) : undefined,
		getClientAddress: () => clientAddress
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

test('addBenefit action preserves coverage amount 0', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Freedom', network: 'mc' });

	const f = new FormData();
	f.set('benefitType', 'other');
	f.set('coverageAmount', '0');
	f.set('currency', 'USD');

	await expect(actions.addBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(cardBenefits).executeSync();
	expect(rows).toHaveLength(1);
	expect(Number(rows[0].coverage_amount)).toBe(0);
});

test('addBenefit action uses template currency', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	const template = listBenefitTemplates().find((t) => t.currency)!;
	expect(template).toBeDefined();

	const f = new FormData();
	f.set('templateId', String(template.id));

	await expect(actions.addBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(cardBenefits).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].currency).toBe(template.currency);
});

test('addBenefit action logs audit with benefit id', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Freedom', network: 'mc' });

	const f = new FormData();
	f.set('benefitType', 'other');
	f.set('coverageAmount', '50');
	f.set('currency', 'USD');

	await expect(actions.addBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(cardBenefits).executeSync();
	expect(rows).toHaveLength(1);
	const benefitId = Number(rows[0].id);

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('card_benefit_create');
	expect(logs[0].entity_type).toBe('card_benefit');
	expect(Number(logs[0].entity_id)).toBe(benefitId);
	expect(Number(logs[0].entity_id)).not.toBe(card.id);
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

test('updateCard action rejects empty nickname or unsupported network with errors object', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });

	const emptyNickname = new FormData();
	emptyNickname.set('nickname', '');
	emptyNickname.set('network', 'visa');
	const emptyResult = (await actions.updateCard(event(user, { id: String(card.id) }, emptyNickname))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values?: Record<string, unknown> };
	};
	expect(emptyResult.status).toBe(400);
	expect(emptyResult.data.errors.nickname).toBe('nickname is required');
	expect(emptyResult.data.values?.nickname).toBe('');

	const badNetwork = new FormData();
	badNetwork.set('nickname', 'Sapphire');
	badNetwork.set('network', 'jcb');
	const networkResult = (await actions.updateCard(event(user, { id: String(card.id) }, badNetwork))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values?: Record<string, unknown> };
	};
	expect(networkResult.status).toBe(400);
	expect(networkResult.data.errors.network).toContain('visa');
	expect(networkResult.data.values?.network).toBe('jcb');

	const rows = ctx.kit.selectFrom(cards).where(kitEq(cards.id, BigInt(card.id))).executeSync();
	expect(rows[0].nickname).toBe('Sapphire');
	expect(rows[0].network).toBe('visa');
});

test('updateCard action rejects nickname and notes that exceed max length', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });

	const f = new FormData();
	f.set('nickname', 'x'.repeat(201));
	f.set('network', 'visa');
	f.set('notes', 'x'.repeat(2001));
	const result = (await actions.updateCard(event(user, { id: String(card.id) }, f))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values?: Record<string, unknown> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.nickname).toBe('nickname must be at most 200 characters');
	expect(result.data.errors.notes).toBe('notes must be at most 2000 characters');

	const row = ctx.kit.selectFrom(cards).where(kitEq(cards.id, BigInt(card.id))).executeSync()[0];
	expect(row!.nickname).toBe('Sapphire');
	expect(row!.notes).toBeNull();
});

test('updateBenefit action preserves coverage amount 0', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	const benefit = createCardBenefit(user.id, card.id, { benefitType: 'trip_delay', coverageAmount: 100 });

	const f = new FormData();
	f.set('id', String(benefit.id));
	f.set('benefitType', 'trip_delay');
	f.set('coverageAmount', '0');
	f.set('currency', 'USD');

	await expect(actions.updateBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(cardBenefits).where(kitEq(cardBenefits.id, BigInt(benefit.id))).executeSync()[0];
	expect(Number(row!.coverage_amount)).toBe(0);
});

test('addBenefit action rejects invalid benefit fields', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Freedom', network: 'mc' });

	const invalidType = new FormData();
	invalidType.set('benefitType', 'invalid_type');
	invalidType.set('coverageAmount', '100');
	invalidType.set('currency', 'USD');
	const typeResult = (await actions.addBenefit(event(user, { id: String(card.id) }, invalidType))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(typeResult.status).toBe(400);
	expect(typeResult.data.errors.benefitType).toContain('trip_delay');
	expect(ctx.kit.selectFrom(cardBenefits).executeSync()).toHaveLength(0);

	const nonNumericCoverage = new FormData();
	nonNumericCoverage.set('benefitType', 'other');
	nonNumericCoverage.set('coverageAmount', 'abc');
	nonNumericCoverage.set('currency', 'USD');
	const coverageResult = (await actions.addBenefit(event(user, { id: String(card.id) }, nonNumericCoverage))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(coverageResult.status).toBe(400);
	expect(coverageResult.data.errors.coverageAmount).toBe('coverageAmount must be a number');

	const negativeCoverage = new FormData();
	negativeCoverage.set('benefitType', 'other');
	negativeCoverage.set('coverageAmount', '-1');
	negativeCoverage.set('currency', 'USD');
	const negativeResult = (await actions.addBenefit(event(user, { id: String(card.id) }, negativeCoverage))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(negativeResult.status).toBe(400);
	expect(negativeResult.data.errors.coverageAmount).toBe('Coverage amount cannot be negative');

	const invalidCurrency = new FormData();
	invalidCurrency.set('benefitType', 'other');
	invalidCurrency.set('coverageAmount', '100');
	invalidCurrency.set('currency', 'dollars');
	const currencyResult = (await actions.addBenefit(event(user, { id: String(card.id) }, invalidCurrency))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(currencyResult.status).toBe(400);
	expect(currencyResult.data.errors.currency).toContain('3-letter currency code');

	expect(ctx.kit.selectFrom(cardBenefits).executeSync()).toHaveLength(0);
	expect(ctx.kit.selectFrom(auditLogs).executeSync()).toHaveLength(0);
});

test('updateBenefit action rejects invalid benefit fields', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	const benefit = createCardBenefit(user.id, card.id, { benefitType: 'trip_delay', coverageAmount: 100 });

	const invalid = new FormData();
	invalid.set('id', String(benefit.id));
	invalid.set('benefitType', 'invalid_type');
	invalid.set('coverageAmount', 'not-a-number');
	invalid.set('currency', 'XYZABC');
	const result = (await actions.updateBenefit(event(user, { id: String(card.id) }, invalid))) as {
		status: number;
		data: { error: string; errors: Record<string, string>; values?: Record<string, unknown> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.benefitType).toContain('trip_delay');
	expect(result.data.errors.coverageAmount).toBe('coverageAmount must be a number');
	expect(result.data.errors.currency).toContain('3-letter currency code');
	expect(result.data.values?.id).toBe(benefit.id);

	const negative = new FormData();
	negative.set('id', String(benefit.id));
	negative.set('benefitType', 'trip_delay');
	negative.set('coverageAmount', '-5');
	negative.set('currency', 'USD');
	const negativeResult = (await actions.updateBenefit(event(user, { id: String(card.id) }, negative))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(negativeResult.status).toBe(400);
	expect(negativeResult.data.errors.coverageAmount).toBe('Coverage amount cannot be negative');

	const row = ctx.kit.selectFrom(cardBenefits).where(kitEq(cardBenefits.id, BigInt(benefit.id))).executeSync()[0];
	expect(row!.benefit_type).toBe('trip_delay');
	expect(Number(row!.coverage_amount)).toBe(100);
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

test('updateCard action rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('nickname', `Updated ${i}`);
		f.set('network', 'visa');
		await expect(actions.updateCard(event(user, { id: String(card.id) }, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('nickname', 'Blocked');
	f.set('network', 'visa');
	const result = (await actions.updateCard(event(user, { id: String(card.id) }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
	expect(result.data.error).toBe('Too many attempts. Try again later.');
});

test('addBenefit action rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('benefitType', 'other');
		f.set('coverageAmount', String(i));
		f.set('currency', 'USD');
		await expect(actions.addBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('benefitType', 'other');
	f.set('coverageAmount', '100');
	f.set('currency', 'USD');
	const result = (await actions.addBenefit(event(user, { id: String(card.id) }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
	expect(result.data.error).toBe('Too many attempts. Try again later.');
});

test('updateBenefit action rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	for (let i = 0; i < 10; i++) {
		const benefit = createCardBenefit(user.id, card.id, { benefitType: 'trip_delay', coverageAmount: i });
		const f = new FormData();
		f.set('id', String(benefit.id));
		f.set('benefitType', 'trip_delay');
		f.set('coverageAmount', String(i + 1));
		f.set('currency', 'USD');
		await expect(actions.updateBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const lastBenefit = createCardBenefit(user.id, card.id, { benefitType: 'trip_delay', coverageAmount: 99 });
	const f = new FormData();
	f.set('id', String(lastBenefit.id));
	f.set('benefitType', 'trip_delay');
	f.set('coverageAmount', '100');
	f.set('currency', 'USD');
	const result = (await actions.updateBenefit(event(user, { id: String(card.id) }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
	expect(result.data.error).toBe('Too many attempts. Try again later.');
});

test('deleteBenefit action rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit);
	const card = createCard(user.id, { nickname: 'Sapphire', network: 'visa' });
	for (let i = 0; i < 10; i++) {
		const benefit = createCardBenefit(user.id, card.id, { benefitType: 'trip_delay' });
		const f = new FormData();
		f.set('id', String(benefit.id));
		await expect(actions.deleteBenefit(event(user, { id: String(card.id) }, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const lastBenefit = createCardBenefit(user.id, card.id, { benefitType: 'trip_delay' });
	const f = new FormData();
	f.set('id', String(lastBenefit.id));
	const result = (await actions.deleteBenefit(event(user, { id: String(card.id) }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
	expect(result.data.error).toBe('Too many attempts. Try again later.');
});
