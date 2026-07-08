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
