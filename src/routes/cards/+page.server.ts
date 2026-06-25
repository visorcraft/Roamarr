import { fail, redirect, error, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { assertOwnedRefs } from '$lib/server/ownership';
import { db } from '$lib/server/db';
import { cards, cardBenefits } from '$lib/server/db/schema';
import { listBenefitTemplates, getBenefitTemplate } from '$lib/server/benefitTemplates';
import { sanitizeLast4, positiveIdFromForm } from '$lib/server/validation';
import type { PageServerLoad } from './$types';

export function _addCard(
	userId: number,
	i: { nickname: string; network: string; last4?: string; notes?: string }
) {
	// Never persist a full PAN: keep digits only and store at most the last four,
	// whatever the form submits (spec: cards store last4 + network only).
	return db
		.insert(cards)
		.values({
			userId,
			nickname: i.nickname,
			network: i.network,
			last4: sanitizeLast4(i.last4),
			notes: i.notes
		})
		.returning()
		.get();
}

export function _addBenefit(
	userId: number,
	cardId: number,
	i: {
		templateId?: number;
		benefitType?: string;
		coverageAmount?: number;
		currency?: string;
		notes?: string;
	}
) {
	assertOwnedRefs(userId, { cardId });

	let benefitType = i.benefitType;
	let coverageAmount = i.coverageAmount;
	let currency = i.currency;
	if (i.templateId != null) {
		const template = getBenefitTemplate(i.templateId);
		if (!template) throw error(404, 'Template not found');
		benefitType = template.benefitType;
		coverageAmount = template.coverageAmount ?? undefined;
		currency = template.currency;
	}

	return db
		.insert(cardBenefits)
		.values({
			cardId,
			benefitType: benefitType!,
			coverageAmount,
			currency: currency ?? 'USD',
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
	db.update(cards)
		.set({
			nickname: i.nickname,
			network: i.network,
			last4: sanitizeLast4(i.last4),
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

export function _deleteBenefit(userId: number, id: number, cardId: number) {
	assertOwnedRefs(userId, { cardId });
	db.delete(cardBenefits).where(and(eq(cardBenefits.id, id), eq(cardBenefits.cardId, cardId))).run();
}

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const mine = db.select().from(cards).where(eq(cards.userId, u.id)).all();
	return {
		templates: listBenefitTemplates(),
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
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		_updateCard(u.id, idResult.value, {
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
		const cardResult = positiveIdFromForm(f.get('cardId'), 'cardId');
		if (!cardResult.ok) return fail(400, { error: cardResult.error });
		const templateIdRaw = f.get('templateId');
		let templateId: number | undefined;
		if (templateIdRaw) {
			const templateResult = positiveIdFromForm(templateIdRaw, 'templateId');
			if (!templateResult.ok) return fail(400, { error: templateResult.error });
			templateId = templateResult.value;
		}
		_addBenefit(u.id, cardResult.value, {
			templateId,
			benefitType: templateId ? undefined : String(f.get('benefitType')),
			coverageAmount: templateId
				? undefined
				: f.get('coverageAmount')
					? Number(f.get('coverageAmount'))
					: undefined,
			currency: templateId ? undefined : String(f.get('currency') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		throw redirect(303, '/cards');
	},
	updateBenefit: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		const cardResult = positiveIdFromForm(f.get('cardId'), 'cardId');
		if (!cardResult.ok) return fail(400, { error: cardResult.error });
		_updateBenefit(u.id, idResult.value, cardResult.value, {
			benefitType: String(f.get('benefitType')),
			coverageAmount: f.get('coverageAmount') ? Number(f.get('coverageAmount')) : undefined,
			currency: String(f.get('currency') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		throw redirect(303, '/cards');
	},
	deleteBenefit: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		const cardResult = positiveIdFromForm(f.get('cardId'), 'cardId');
		if (!cardResult.ok) return fail(400, { error: cardResult.error });
		_deleteBenefit(u.id, idResult.value, cardResult.value);
		throw redirect(303, '/cards');
	},
	deleteCard: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		db.delete(cards).where(and(eq(cards.id, idResult.value), eq(cards.userId, u.id))).run();
		throw redirect(303, '/cards');
	}
};
