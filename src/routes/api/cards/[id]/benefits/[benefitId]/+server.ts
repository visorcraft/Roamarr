import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePositiveId } from '$lib/server/params';
import { requireUser } from '$lib/server/auth';
import { deleteCardBenefit, getCardBenefitById, getCardById, updateCardBenefit } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';
import { parseCardBenefit } from '$lib/server/mobileCardBenefits';

export const PATCH: RequestHandler = async ({ params, locals, request }) => { const user = requireUser(locals), cardId = requirePositiveId(params.id), benefitId = requirePositiveId(params.benefitId); if (!getCardById(cardId, user.id) || !getCardBenefitById(benefitId, cardId)) throw error(404, 'Not found'); const benefit = updateCardBenefit(benefitId, cardId, parseCardBenefit(await request.json())); logAudit(user.id, 'card_benefit_update', 'card_benefit', benefitId, { cardId }); return json({ benefit }); };
export const DELETE: RequestHandler = ({ params, locals }) => { const user = requireUser(locals), cardId = requirePositiveId(params.id), benefitId = requirePositiveId(params.benefitId); if (!getCardById(cardId, user.id) || !getCardBenefitById(benefitId, cardId)) throw error(404, 'Not found'); deleteCardBenefit(benefitId, cardId); logAudit(user.id, 'card_benefit_delete', 'card_benefit', benefitId, { cardId }); return new Response(null, { status: 204 }); };
