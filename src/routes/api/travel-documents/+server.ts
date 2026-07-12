import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import {
	listTravelDocumentsPaginated,
	countTravelDocuments
} from '$lib/server/repositories/profileRepo';
import { inList } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { tripCompanions } from '$lib/server/db/mongrelSchema';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { Validator } from '$lib/server/validation';
import { TRAVEL_DOCUMENT_TYPES } from '$lib/server/db/mongrelSchema';
import { addDocument } from '$lib/server/travelDocuments';
import { getCompanionTripId } from '$lib/server/tripCompanions';
import { requireOwnedTrip } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:travel-documents:list');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const { page, limit: pageLimit, search, sort, dir, from, to } = parseTableParams(url, [
		'type',
		'issuingAuthority',
		'expiresOn',
		'notes'
	]);
	const offset = (page - 1) * pageLimit;
	const docs = listTravelDocumentsPaginated(u.id, {
		search,
		sortBy: sort as 'type' | 'issuingAuthority' | 'expiresOn' | 'notes' | undefined,
		sortDir: dir,
		from,
		to,
		limit: pageLimit,
		offset
	});

	// Resolve companion names for the page of documents returned.
	const companionIds = Array.from(
		new Set(docs.map((d) => d.companionId).filter((id): id is number => id != null))
	);
	const companionName = new Map<number, string>();
	if (companionIds.length) {
		const rows = kit
			.selectFrom(tripCompanions)
			.where(inList(tripCompanions.id, companionIds.map((id) => BigInt(id))))
			.executeSync();
		const tripName = new Map(tripsRepo.listTripsForUser(u.id).map((t) => [t.id, t.name]));
		for (const c of rows) {
			companionName.set(
				Number(c.id),
				`${c.name} · ${tripName.get(Number(c.trip_id)) ?? ''}`.trim()
			);
		}
	}

	const rows = docs.map((d) => ({
		id: d.id,
		type: d.type,
		number: d.number,
		issuingAuthority: d.issuingAuthority,
		expiresOn: d.expiresOn,
		notes: d.notes,
		companionId: d.companionId,
		companionName: d.companionId != null ? companionName.get(d.companionId) ?? null : null
	}));
	const total = countTravelDocuments(u.id, { search, from, to });
	return json({ rows, total });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals), body = await request.json() as Record<string, unknown>, validator = new Validator();
	const type = validator.enumValue(String(body.type ?? ''), TRAVEL_DOCUMENT_TYPES, 'type'), number = validator.optionalString(body.number, 'number', { max: 200 });
	const issuingAuthority = validator.optionalString(body.issuingAuthority, 'issuingAuthority', { max: 200 }), expiresOn = validator.date(body.expiresOn, 'expiresOn'), notes = validator.optionalString(body.notes, 'notes', { max: 2000 });
	const companionId = body.companionId == null || body.companionId === '' ? null : validator.positiveId(body.companionId, 'companionId');
	if (companionId != null) { const tripId = getCompanionTripId(companionId); if (tripId == null) throw error(404, 'Companion not found'); requireOwnedTrip(user.id, tripId); }
	if (!validator.ok()) return json({ error: validator.failMessage(), errors: validator.errors }, { status: 400 });
	const document = addDocument(user.id, { type: type!, number, issuingAuthority, expiresOn, notes, companionId }); logAudit(user.id, 'document_create', 'document', document.id); return json({ document }, { status: 201 });
};
