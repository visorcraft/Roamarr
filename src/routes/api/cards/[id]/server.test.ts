import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { DELETE } from './+server';
import { makeCard, makeUser } from '../../../../../tests/helpers';
import { cards, cardBenefits, auditLogs, users } from '$lib/server/db/mongrelSchema';
import { kit } from '$lib/server/db';
import { resetRateLimit } from '$lib/server/rateLimit';

beforeEach(() => {
	ctx.kit.deleteFrom(cardBenefits).executeSync();
	ctx.kit.deleteFrom(cards).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

function makeEvent(params: Record<string, string>, user: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('delete removes an owned card, its benefits, logs audit, and returns 204', async () => {
	const user = makeUser(ctx.kit, { email: 'owner@x.c' });
	const card = makeCard(ctx.kit, user.id, { nickname: 'Sapphire', network: 'visa' });
	kit.insertInto(cardBenefits).values({
		card_id: BigInt(card.id),
		benefit_type: 'trip_delay',
		coverage_amount: BigInt(100),
		currency: 'USD'
	} as any).executeSync();

	const res = await DELETE(makeEvent({ id: String(card.id) }, user));
	expect(res.status).toBe(204);

	const cardRows = kit.selectFrom(cards).executeSync();
	expect(cardRows).toHaveLength(0);
	const benefitRows = kit.selectFrom(cardBenefits).executeSync();
	expect(benefitRows).toHaveLength(0);

	const logs = kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('card_delete');
	expect(logs[0].entity_type).toBe('card');
	expect(Number(logs[0].entity_id)).toBe(card.id);
});

test('delete returns 404 for another users card', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const card = makeCard(ctx.kit, owner.id, { nickname: 'Sapphire', network: 'visa' });

	await expect(DELETE(makeEvent({ id: String(card.id) }, other))).rejects.toMatchObject({ status: 404 });

	const rows = kit.selectFrom(cards).executeSync();
	expect(rows).toHaveLength(1);
});

test('delete rejects unauthenticated requests', async () => {
	await expect(DELETE(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
});

test('delete rate limits repeated requests', async () => {
	const user = makeUser(ctx.kit, { email: 'rate@x.c' });
	for (let i = 0; i < 10; i++) {
		const card = makeCard(ctx.kit, user.id, { nickname: `Card ${i}`, network: 'visa' });
		const res = await DELETE(makeEvent({ id: String(card.id) }, user));
		expect(res.status).toBe(204);
	}

	const lastCard = makeCard(ctx.kit, user.id, { nickname: 'Last', network: 'visa' });
	await expect(DELETE(makeEvent({ id: String(lastCard.id) }, user))).rejects.toMatchObject({ status: 429 });
});
