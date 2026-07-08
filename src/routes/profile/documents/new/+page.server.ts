import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';
import { TRAVEL_DOCUMENT_TYPES } from '$lib/server/db/mongrelSchema';
import { addDocument } from '$lib/server/travelDocuments';
import { eq, inList, asc } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { tripCompanions } from '$lib/server/db/mongrelSchema';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { companions: loadCompanions(u.id) };
};

function loadCompanions(userId: number) {
	const ownedTrips = tripsRepo.listTripsForUser(userId);
	const tripIds = ownedTrips.map((t) => BigInt(t.id));
	const tripNameMap = new Map(ownedTrips.map((t) => [BigInt(t.id), t.name]));
	if (tripIds.length === 0) return [];
	return kit
		.selectFrom(tripCompanions)
		.where(inList(tripCompanions.trip_id, tripIds))
		.orderBy(asc(tripCompanions.column('name')))
		.executeSync()
		.map((c) => ({
			id: Number(c.id),
			name: c.name as string,
			tripId: Number(c.trip_id),
			tripName: tripNameMap.get(c.trip_id as bigint) ?? ''
		}));
}

function requireOwnedCompanion(userId: number, companionId: number) {
	const c = kit
		.selectFrom(tripCompanions)
		.where(eq(tripCompanions.id, BigInt(companionId)))
		.executeSync()[0];
	if (!c) return false;
	const trip = tripsRepo.getTripById(Number(c.trip_id));
	return Boolean(trip && trip.ownerId === userId);
}

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'documents:create');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}

		const f = await request.formData();
		const v = new Validator();
		const type = v.enumValue(String(f.get('type') || ''), TRAVEL_DOCUMENT_TYPES, 'type');
		const number = v.optionalString(f.get('number'), 'number', { max: 200 });
		const issuingAuthority = v.optionalString(f.get('issuingAuthority'), 'issuingAuthority', { max: 200 });
		const expiresOn = v.date(f.get('expiresOn'), 'expiresOn');
		const notes = v.optionalString(f.get('notes'), 'notes', { max: 2000 });

		let companionId: number | null = null;
		const companionIdRaw = f.get('companionId');
		if (companionIdRaw != null && String(companionIdRaw) !== '') {
			const parsed = v.positiveId(companionIdRaw, 'companionId');
			if (parsed != null) {
				if (!requireOwnedCompanion(u.id, parsed)) {
					throw error(404, 'Companion not found');
				}
				companionId = parsed;
			}
		}

		if (!v.ok()) {
			return fail(400, {
				error: v.failMessage(),
				errors: v.errors,
				values: {
					type: String(f.get('type') || ''),
					number: String(f.get('number') || ''),
					issuingAuthority: String(f.get('issuingAuthority') || ''),
					expiresOn: String(f.get('expiresOn') || ''),
					companionId: String(f.get('companionId') || ''),
					notes: String(f.get('notes') || '')
				}
			});
		}

		const doc = addDocument(u.id, {
			type: type!,
			number,
			issuingAuthority,
			expiresOn,
			notes,
			companionId
		});
		logAudit(u.id, 'document_create', 'document', doc.id);
		throw redirect(303, '/profile/documents');
	}
};
