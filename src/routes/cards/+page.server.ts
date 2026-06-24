import { redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { assertOwnedRefs } from '$lib/server/ownership';
import { db } from '$lib/server/db';
import { cards, cardBenefits } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export function _addCard(
	userId: number,
	i: { nickname: string; network: string; last4?: string; notes?: string }
) {
	// Never persist a full PAN: keep digits only and store at most the last four,
	// whatever the form submits (spec: cards store last4 + network only).
	const last4 = i.last4 ? i.last4.replace(/\D/g, '').slice(-4) || null : null;
	return db
		.insert(cards)
		.values({
			userId,
			nickname: i.nickname,
			network: i.network,
			last4,
			notes: i.notes
		})
		.returning()
		.get();
}

export function _addBenefit(
	userId: number,
	cardId: number,
	i: {
		benefitType: string;
		coverageAmount?: number;
		currency?: string;
		notes?: string;
	}
) {
	assertOwnedRefs(userId, { cardId });
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

export function _updateCard(
	userId: number,
	id: number,
	i: {
		nickname: string;
		network: string;
		last4?: string;
		notes?: string;
	}
) {
	const last4 = i.last4 ? i.last4.replace(/\D/g, '').slice(-4) || null : null;
	db.update(cards)
		.set({
			nickname: i.nickname,
			network: i.network,
			last4,
			notes: i.notes || null
		})
		.where(and(eq(cards.id, id), eq(cards.userId, userId)))
		.run();
}

export function _updateBenefit(
	userId: number,
	id: number,
	cardId: number,
	i: {
		benefitType: string;
		coverageAmount?: number;
		currency?: string;
		notes?: string;
	}
) {
	assertOwnedRefs(userId, { cardId });
	db.update(cardBenefits)
		.set({
			benefitType: i.benefitType,
			coverageAmount: i.coverageAmount ?? null,
			currency: i.currency ?? 'USD',
			notes: i.notes || null
		})
		.where(and(eq(cardBenefits.id, id), eq(cardBenefits.cardId, cardId)))
		.run();
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
		_addCard(u.id, {
			nickname: String(f.get('nickname')),
			network: String(f.get('network')),
			last4: String(f.get('last4') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		throw redirect(303, '/cards');
	},
	updateCard: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		_updateCard(u.id, Number(f.get('id')), {
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
		_addBenefit(u.id, Number(f.get('cardId')), {
			benefitType: String(f.get('benefitType')),
			coverageAmount: f.get('coverageAmount') ? Number(f.get('coverageAmount')) : undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		throw redirect(303, '/cards');
	},
	updateBenefit: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		_updateBenefit(u.id, Number(f.get('id')), Number(f.get('cardId')), {
			benefitType: String(f.get('benefitType')),
			coverageAmount: f.get('coverageAmount') ? Number(f.get('coverageAmount')) : undefined,
			currency: String(f.get('currency') || '') || undefined,
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
