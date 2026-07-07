import { fail, redirect, error, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
	getCardById,
	updateCard,
	createCardBenefit,
	updateCardBenefit,
	deleteCardBenefit,
	listBenefitsForCard
} from '$lib/server/repositories/profileRepo';
import { listBenefitTemplates, getBenefitTemplate } from '$lib/server/benefitTemplates';
import { sanitizeLast4, positiveIdFromForm } from '$lib/server/validation';
import { logAudit } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

function parseId(params: { id?: string }): number {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');
	return id;
}

export const load: PageServerLoad = ({ params, locals }) => {
	const u = requireUser(locals);
	const id = parseId(params);
	const card = getCardById(id, u.id);
	if (!card) throw error(404, 'Not found');
	return {
		card,
		benefits: listBenefitsForCard(card.id),
		templates: listBenefitTemplates()
	};
};

export const actions: Actions = {
	updateCard: async ({ params, request, locals }) => {
		const u = requireUser(locals);
		const id = parseId(params);
		const f = await request.formData();
		updateCard(id, u.id, {
			nickname: String(f.get('nickname') || ''),
			network: String(f.get('network') || ''),
			last4: sanitizeLast4(String(f.get('last4') || '')),
			notes: String(f.get('notes') || '') || null
		});
		logAudit(u.id, 'card_update', 'card', id);
		throw redirect(303, '/cards');
	},
	addBenefit: async ({ params, request, locals }) => {
		const u = requireUser(locals);
		const cardId = parseId(params);
		const f = await request.formData();

		const templateIdRaw = f.get('templateId');
		let templateId: number | undefined;
		if (templateIdRaw) {
			const templateResult = positiveIdFromForm(templateIdRaw, 'templateId');
			if (!templateResult.ok) return fail(400, { error: templateResult.error });
			templateId = templateResult.value;
		}

		let benefitType: string | undefined;
		let coverageAmount: number | undefined;
		let currency: string | undefined;

		if (templateId != null) {
			const template = getBenefitTemplate(templateId);
			if (!template) return fail(400, { error: 'Template not found' });
			benefitType = template.benefitType;
			coverageAmount = template.coverageAmount ?? undefined;
			currency = template.currency;
		} else {
			benefitType = String(f.get('benefitType') || '');
			const amountRaw = f.get('coverageAmount');
			coverageAmount = amountRaw ? Number(amountRaw) : undefined;
			currency = String(f.get('currency') || '') || undefined;
		}

		createCardBenefit(u.id, cardId, {
			benefitType: benefitType!,
			coverageAmount,
			currency,
			notes: String(f.get('notes') || '') || undefined
		});
		logAudit(u.id, 'card_benefit_create', 'card_benefit', cardId);
		throw redirect(303, `/cards/${cardId}/edit`);
	},
	updateBenefit: async ({ params, request, locals }) => {
		const u = requireUser(locals);
		const cardId = parseId(params);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		if (!getCardById(cardId, u.id)) throw error(404, 'Not found');
		const amountRaw = f.get('coverageAmount');
		updateCardBenefit(idResult.value, cardId, {
			benefitType: String(f.get('benefitType') || ''),
			coverageAmount: amountRaw ? Number(amountRaw) : null,
			currency: String(f.get('currency') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		logAudit(u.id, 'card_benefit_update', 'card_benefit', idResult.value);
		throw redirect(303, `/cards/${cardId}/edit`);
	},
	deleteBenefit: async ({ params, request, locals }) => {
		const u = requireUser(locals);
		const cardId = parseId(params);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		if (!getCardById(cardId, u.id)) throw error(404, 'Not found');
		deleteCardBenefit(idResult.value, cardId);
		logAudit(u.id, 'card_benefit_delete', 'card_benefit', idResult.value);
		throw redirect(303, `/cards/${cardId}/edit`);
	}
};
