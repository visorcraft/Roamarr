import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { eq as kitEq, inList, asc } from '@visorcraft/mongreldb-kit';
import { requireUser } from '$lib/server/auth';
import { kit } from '$lib/server/db';
import { tripCompanions } from '$lib/server/db/mongrelSchema';
import { TRAVEL_DOCUMENT_TYPES, type TravelDocumentType } from '$lib/server/db/mongrelSchema';
import { upsertRemindersForDocument, cancelRemindersFor } from '$lib/server/reminders';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';
import {
	createTravelDocument,
	updateTravelDocument,
	deleteTravelDocument,
	listTravelDocuments
} from '$lib/server/repositories/profileRepo';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import type { PageServerLoad } from './$types';

export function _addDocument(
	userId: number,
	i: {
		type: TravelDocumentType;
		number?: string;
		issuingAuthority?: string;
		expiresOn?: string;
		notes?: string;
		companionId?: number | null;
	}
) {
	const doc = createTravelDocument(userId, {
		type: i.type,
		number: i.number,
		issuingAuthority: i.issuingAuthority,
		expiresOn: i.expiresOn,
		notes: i.notes,
		companionId: i.companionId ?? null
	});
	upsertRemindersForDocument(doc);
	return doc;
}

function _updateDocument(
	userId: number,
	id: number,
	i: {
		type: TravelDocumentType;
		number?: string;
		issuingAuthority?: string;
		expiresOn?: string;
		notes?: string;
		companionId?: number | null;
	}
) {
	const doc = updateTravelDocument(id, userId, {
		type: i.type,
		number: i.number,
		issuingAuthority: i.issuingAuthority,
		expiresOn: i.expiresOn,
		notes: i.notes,
		companionId: i.companionId ?? null
	})!;
	upsertRemindersForDocument(doc);
	return doc;
}

function requireOwnedCompanion(userId: number, companionId: number) {
	const c = kit
		.selectFrom(tripCompanions)
		.where(kitEq(tripCompanions.id, BigInt(companionId)))
		.executeSync()[0];
	if (!c) throw error(404, 'Companion not found');
	const trip = tripsRepo.getTripById(Number(c.trip_id));
	if (!trip || trip.ownerId !== userId) throw error(404, 'Companion not found');
}

function parseCompanionId(raw: FormDataEntryValue | null): number | null {
	const s = String(raw || '').trim();
	if (!s) return null;
	const id = Number(s);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'Invalid companion');
	return id;
}

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const rows = listTravelDocuments(u.id);
	const ownedTrips = tripsRepo.listTripsForUser(u.id);
	const tripIds = ownedTrips.map((t) => BigInt(t.id));
	const tripNameMap = new Map(ownedTrips.map((t) => [BigInt(t.id), t.name]));
	const companions =
		tripIds.length === 0
			? []
			: kit
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
	return {
		documents: rows,
		companions
	};
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const type = v.enumValue(String(f.get('type') || ''), TRAVEL_DOCUMENT_TYPES, 'type');
		const companionId = parseCompanionId(f.get('companionId'));
		if (companionId != null) requireOwnedCompanion(u.id, companionId);
		if (!v.ok()) return fail(400, { error: v.failMessage() });
		const doc = _addDocument(u.id, {
			type: type!,
			number: String(f.get('number') || '') || undefined,
			issuingAuthority: String(f.get('issuingAuthority') || '') || undefined,
			expiresOn: String(f.get('expiresOn') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined,
			companionId
		});
		logAudit(u.id, 'document_create', 'document', doc.id);
		throw redirect(303, '/profile/documents');
	},
	update: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const type = v.enumValue(String(f.get('type') || ''), TRAVEL_DOCUMENT_TYPES, 'type');
		const companionId = parseCompanionId(f.get('companionId'));
		if (companionId != null) requireOwnedCompanion(u.id, companionId);
		if (!v.ok()) return fail(400, { error: v.failMessage() });
		const doc = _updateDocument(u.id, Number(f.get('id')), {
			type: type!,
			number: String(f.get('number') || '') || undefined,
			issuingAuthority: String(f.get('issuingAuthority') || '') || undefined,
			expiresOn: String(f.get('expiresOn') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined,
			companionId
		});
		logAudit(u.id, 'document_update', 'document', doc.id);
		throw redirect(303, '/profile/documents');
	},
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const id = Number((await request.formData()).get('id'));
		cancelRemindersFor('document', id);
		deleteTravelDocument(id, u.id);
		logAudit(u.id, 'document_delete', 'document', id);
		throw redirect(303, '/profile/documents');
	}
};
