import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getTravelDocumentById, deleteTravelDocument } from '$lib/server/repositories/profileRepo';
import { cancelRemindersFor } from '$lib/server/reminders';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';
import { TRAVEL_DOCUMENT_TYPES } from '$lib/server/db/mongrelSchema';
import { updateDocument } from '$lib/server/travelDocuments';
import { getCompanionTripId } from '$lib/server/tripCompanions';
import { requireOwnedTrip } from '$lib/server/ownership';

const parseId = (raw: string | undefined) => { const id = Number(raw); if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found'); return id; };
export const GET: RequestHandler = ({ params, locals }) => { const user = requireUser(locals), document = getTravelDocumentById(parseId(params.id), user.id); if (!document) throw error(404, 'Not found'); return json({ document }); };
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	const user = requireUser(locals), id = parseId(params.id), old = getTravelDocumentById(id, user.id); if (!old) throw error(404, 'Not found'); const body = await request.json() as Record<string, unknown>, validator = new Validator();
	const type = validator.enumValue(String(body.type ?? old.type), TRAVEL_DOCUMENT_TYPES, 'type'), number = validator.optionalString(body.number ?? old.number, 'number', { max: 200 }), issuingAuthority = validator.optionalString(body.issuingAuthority ?? old.issuingAuthority, 'issuingAuthority', { max: 200 }), expiresOn = validator.date(body.expiresOn ?? old.expiresOn, 'expiresOn'), notes = validator.optionalString(body.notes ?? old.notes, 'notes', { max: 2000 });
	const companionId = body.companionId == null || body.companionId === '' ? null : validator.positiveId(body.companionId, 'companionId'); if (companionId != null) { const tripId = getCompanionTripId(companionId); if (tripId == null) throw error(404, 'Companion not found'); requireOwnedTrip(user.id, tripId); }
	if (!validator.ok()) return json({ error: validator.failMessage(), errors: validator.errors }, { status: 400 });
	const document = updateDocument(user.id, id, { type: type!, number, issuingAuthority, expiresOn, notes, companionId }); logAudit(user.id, 'document_update', 'document', id); return json({ document });
};

export const DELETE: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');

	const limit = checkRateLimit(getClientAddress(), 'api:travel-documents:delete');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const doc = getTravelDocumentById(id, u.id);
	if (!doc) throw error(404, 'Not found');

	cancelRemindersFor('document', id);
	deleteTravelDocument(id, u.id);
	logAudit(u.id, 'document_delete', 'document', id);
	return new Response(null, { status: 204 });
};
