import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { createCardBenefit, getCardById, listBenefitsForCard } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';
import { parseCardBenefit } from '$lib/server/mobileCardBenefits';

const cardId = (raw: string | undefined) => { const id = Number(raw); if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found'); return id; };

export const GET: RequestHandler = ({ params, locals }) => { const user = requireUser(locals), id = cardId(params.id); if (!getCardById(id, user.id)) throw error(404, 'Not found'); return json({ rows: listBenefitsForCard(id) }); };
export const POST: RequestHandler = async ({ params, locals, request }) => { const user = requireUser(locals), id = cardId(params.id), benefit = createCardBenefit(user.id, id, parseCardBenefit(await request.json())); logAudit(user.id, 'card_benefit_create', 'card_benefit', benefit.id, { cardId: id }); return json({ benefit }, { status: 201 }); };
