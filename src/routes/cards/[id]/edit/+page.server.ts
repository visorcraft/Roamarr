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
import { Validator, sanitizeLast4, positiveIdFromForm, currency } from '$lib/server/validation';
import { logAudit } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

const allowedNetworks = ['visa', 'mc', 'amex', 'disc', 'other'] as const;
const allowedBenefitTypes = ['trip_delay', 'baggage_delay', 'trip_cancellation', 'other'] as const;

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
		const v = new Validator();
		const nickname = v.requiredString(f.get('nickname'), 'nickname', { max: 200 });
		const network = v.enumValue(f.get('network'), allowedNetworks, 'network');
		const last4Raw = v.optionalString(f.get('last4'), 'last4');
		const notes = v.optionalString(f.get('notes'), 'notes', { max: 2000 });
		if (!v.ok()) {
			return fail(400, {
				error: v.failMessage(),
				errors: v.errors,
				values: {
					nickname: String(f.get('nickname') || '').trim(),
					network: String(f.get('network') || ''),
					last4: String(f.get('last4') || ''),
					notes: String(f.get('notes') || '').trim()
				}
			});
		}
		updateCard(id, u.id, {
			nickname: nickname!,
			network: network!,
			last4: sanitizeLast4(last4Raw),
			notes
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
		let coverageAmount: number | null = null;
		let currencyValue: string | undefined;
		const notes = String(f.get('notes') || '').trim() || undefined;

		if (templateId != null) {
			const template = getBenefitTemplate(templateId);
			if (!template) return fail(404, { error: 'Template not found' });
			benefitType = template.benefitType;
			coverageAmount = template.coverageAmount ?? null;
			currencyValue = template.currency;
		} else {
			const v = new Validator();
			benefitType = v.enumValue(f.get('benefitType'), allowedBenefitTypes, 'benefitType');
			const coverageRaw = f.get('coverageAmount');
			if (coverageRaw !== '' && coverageRaw != null) {
				const n = Number(coverageRaw);
				if (!Number.isFinite(n)) {
					v.addError('coverageAmount', 'coverageAmount must be a number');
				} else {
					coverageAmount = n;
				}
			}
			const currencyResult = currency(f.get('currency'), 'currency');
			if (!currencyResult.ok) {
				v.addError('currency', currencyResult.error);
			} else {
				currencyValue = currencyResult.value;
			}
			if (!v.ok()) {
				return fail(400, {
					error: v.failMessage(),
					errors: v.errors,
					values: {
						benefitType,
						coverageAmount: coverageRaw,
						currency: String(f.get('currency') || ''),
						notes
					}
				});
			}
		}

		const benefit = createCardBenefit(u.id, cardId, {
			benefitType: benefitType!,
			coverageAmount: coverageAmount ?? undefined,
			currency: currencyValue,
			notes
		});
		logAudit(u.id, 'card_benefit_create', 'card_benefit', benefit.id);
		throw redirect(303, `/cards/${cardId}/edit`);
	},
	updateBenefit: async ({ params, request, locals }) => {
		const u = requireUser(locals);
		const cardId = parseId(params);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		if (!getCardById(cardId, u.id)) throw error(404, 'Not found');

		const v = new Validator();
		const benefitType = v.enumValue(f.get('benefitType'), allowedBenefitTypes, 'benefitType');
		const coverageRaw = f.get('coverageAmount');
		let coverageAmount: number | null = null;
		if (coverageRaw !== '' && coverageRaw != null) {
			const n = Number(coverageRaw);
			if (!Number.isFinite(n)) {
				v.addError('coverageAmount', 'coverageAmount must be a number');
			} else {
				coverageAmount = n;
			}
		}
		const currencyResult = currency(f.get('currency'), 'currency');
		let currencyValue: string | undefined;
		if (!currencyResult.ok) {
			v.addError('currency', currencyResult.error);
		} else {
			currencyValue = currencyResult.value;
		}
		const notes = v.optionalString(f.get('notes'), 'notes');
		if (!v.ok()) {
			return fail(400, {
				error: v.failMessage(),
				errors: v.errors,
				values: {
					id: idResult.value,
					benefitType,
					coverageAmount: coverageRaw,
					currency: String(f.get('currency') || ''),
					notes
				}
			});
		}
		updateCardBenefit(idResult.value, cardId, {
			benefitType: benefitType!,
			coverageAmount,
			currency: currencyValue,
			notes
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
