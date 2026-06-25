import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { requireOwnedDocument } from '$lib/server/ownership';
import { db } from '$lib/server/db';
import { travelDocuments, trips, tripCompanions, TRAVEL_DOCUMENT_TYPES, type TravelDocumentType } from '$lib/server/db/schema';
import { encrypt, decrypt } from '$lib/server/crypto';
import { upsertRemindersForDocument, cancelRemindersFor } from '$lib/server/reminders';
import { logAudit } from '$lib/server/audit';
import { Validator } from '$lib/server/validation';
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
	const doc = db
		.insert(travelDocuments)
		.values({
			userId,
			type: i.type,
			number: i.number ? encrypt(i.number) : null,
			issuingAuthority: i.issuingAuthority,
			expiresOn: i.expiresOn,
			notes: i.notes,
			companionId: i.companionId ?? null
		})
		.returning()
		.get();
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
	requireOwnedDocument(userId, id);
	const doc = db
		.update(travelDocuments)
		.set({
			type: i.type,
			number: i.number ? encrypt(i.number) : null,
			issuingAuthority: i.issuingAuthority,
			expiresOn: i.expiresOn,
			notes: i.notes,
			companionId: i.companionId ?? null
		})
		.where(eq(travelDocuments.id, id))
		.returning()
		.get();
	upsertRemindersForDocument(doc);
	return doc;
}

function requireOwnedCompanion(userId: number, companionId: number) {
	const c = db
		.select({ id: tripCompanions.id })
		.from(tripCompanions)
		.innerJoin(trips, eq(tripCompanions.tripId, trips.id))
		.where(and(eq(tripCompanions.id, companionId), eq(trips.ownerId, userId)))
		.get();
	if (!c) throw error(404, 'Companion not found');
	return c;
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
	const rows = db.select().from(travelDocuments).where(eq(travelDocuments.userId, u.id)).all();
	const companions = db
		.select({
			id: tripCompanions.id,
			name: tripCompanions.name,
			tripId: tripCompanions.tripId,
			tripName: trips.name
		})
		.from(tripCompanions)
		.innerJoin(trips, eq(tripCompanions.tripId, trips.id))
		.where(eq(trips.ownerId, u.id))
		.orderBy(tripCompanions.name)
		.all();
	return {
		documents: rows.map((d) => ({ ...d, number: d.number ? decrypt(d.number) : null })),
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
		requireOwnedDocument(u.id, id);
		cancelRemindersFor('document', id);
		db.delete(travelDocuments)
			.where(and(eq(travelDocuments.id, id), eq(travelDocuments.userId, u.id)))
			.run();
		logAudit(u.id, 'document_delete', 'document', id);
		throw redirect(303, '/profile/documents');
	}
};
