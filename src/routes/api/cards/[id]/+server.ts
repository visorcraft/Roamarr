import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getCardById, deleteCard, listBenefitsForCard, updateCard } from '$lib/server/repositories/profileRepo';
import { logAudit } from '$lib/server/audit';
import { Validator, sanitizeLast4 } from '$lib/server/validation';

const id = (raw: string | undefined) => { const value = Number(raw); if (!Number.isInteger(value) || value < 1) throw error(404, 'Not found'); return value; };

export const GET: RequestHandler = ({ params, locals }) => {
	const user = requireUser(locals), card = getCardById(id(params.id), user.id);
	if (!card) throw error(404, 'Not found');
	return json({ card, benefits: listBenefitsForCard(card.id) });
};

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	const user = requireUser(locals), cardId = id(params.id), existing = getCardById(cardId, user.id);
	if (!existing) throw error(404, 'Not found');
	const body = await request.json() as Record<string, unknown>, validator = new Validator();
	const nickname = validator.requiredString(body.nickname ?? existing.nickname, 'nickname', { max: 200 });
	const network = validator.enumValue(body.network ?? existing.network, ['visa', 'mc', 'amex', 'disc', 'other'] as const, 'network');
	const last4 = validator.optionalString(body.last4 ?? existing.last4, 'last4', { max: 4 }), notes = validator.optionalString(body.notes ?? existing.notes, 'notes', { max: 2000 });
	if (last4 && !/^\d{4}$/.test(last4)) validator.addError('last4', 'last4 must be exactly 4 digits');
	if (!validator.ok()) return json({ error: validator.failMessage(), errors: validator.errors }, { status: 400 });
	const card = updateCard(cardId, user.id, { nickname: nickname!, network: network!, last4: sanitizeLast4(last4), notes });
	logAudit(user.id, 'card_update', 'card', cardId);
	return json({ card });
};

export const DELETE: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');

	const limit = checkRateLimit(getClientAddress(), 'api:cards:delete');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const card = getCardById(id, u.id);
	if (!card) throw error(404, 'Not found');

	deleteCard(id, u.id);
	logAudit(u.id, 'card_delete', 'card', id);
	return new Response(null, { status: 204 });
};
