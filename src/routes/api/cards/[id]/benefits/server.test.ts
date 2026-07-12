import { beforeEach, expect, test, vi } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => { const { freshDb } = await import('../../../../../../tests/helpers'); Object.assign(ctx, freshDb()); return ctx; });

import { GET, POST } from './+server';
import { makeCard, makeUser } from '../../../../../../tests/helpers';
import { cardBenefits, cards, users } from '$lib/server/db/mongrelSchema';

beforeEach(() => { ctx.kit.deleteFrom(cardBenefits).executeSync(); ctx.kit.deleteFrom(cards).executeSync(); ctx.kit.deleteFrom(users).executeSync(); });

test('benefit CRUD is scoped to card owner', async () => {
	const owner = makeUser(ctx.kit), other = makeUser(ctx.kit), card = makeCard(ctx.kit, owner.id, { nickname: 'Card', network: 'visa' });
	const create = await POST({ params: { id: String(card.id) }, locals: { user: owner }, request: new Request('http://localhost', { method: 'POST', body: JSON.stringify({ benefitType: 'trip_delay', coverageAmount: 50000, currency: 'USD', notes: 'Six hours' }) }) } as any);
	expect(create.status).toBe(201);
	const list = await GET({ params: { id: String(card.id) }, locals: { user: owner } } as any);
	expect((await list.json()).rows).toHaveLength(1);
	expect(() => GET({ params: { id: String(card.id) }, locals: { user: other } } as any)).toThrow();
});
