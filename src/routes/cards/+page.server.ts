import { redirect, error, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { cards, cardBenefits } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export function addCard(
	userId: number,
	i: { nickname: string; network: string; last4?: string; notes?: string }
) {
	return db
		.insert(cards)
		.values({
			userId,
			nickname: i.nickname,
			network: i.network,
			last4: i.last4,
			notes: i.notes
		})
		.returning()
		.get();
}

export function addBenefit(
	userId: number,
	cardId: number,
	i: {
		benefitType: string;
		coverageAmount?: number;
		currency?: string;
		notes?: string;
	}
) {
	if (
		!db.select().from(cards).where(and(eq(cards.id, cardId), eq(cards.userId, userId))).get()
	)
		throw error(403, 'Forbidden');
	return db
		.insert(cardBenefits)
		.values({
			cardId,
			benefitType: i.benefitType,
			coverageAmount: i.coverageAmount,
			currency: i.currency ?? 'USD',
			notes: i.notes
		})
		.returning()
		.get();
}

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const mine = db.select().from(cards).where(eq(cards.userId, u.id)).all();
	return {
		cards: mine.map((c) => ({
			...c,
			benefits: db.select().from(cardBenefits).where(eq(cardBenefits.cardId, c.id)).all()
		}))
	};
};

export const actions: Actions = {
	addCard: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		addCard(u.id, {
			nickname: String(f.get('nickname')),
			network: String(f.get('network')),
			last4: String(f.get('last4') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		throw redirect(303, '/cards');
	},
	addBenefit: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		addBenefit(u.id, Number(f.get('cardId')), {
			benefitType: String(f.get('benefitType')),
			coverageAmount: f.get('coverageAmount') ? Number(f.get('coverageAmount')) : undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		throw redirect(303, '/cards');
	},
	deleteCard: async ({ request, locals }) => {
		const u = requireUser(locals);
		const id = Number((await request.formData()).get('id'));
		db.delete(cards).where(and(eq(cards.id, id), eq(cards.userId, u.id))).run();
		throw redirect(303, '/cards');
	}
};
