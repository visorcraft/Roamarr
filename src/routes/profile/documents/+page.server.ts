import { redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { requireOwnedDocument } from '$lib/server/ownership';
import { db } from '$lib/server/db';
import { travelDocuments } from '$lib/server/db/schema';
import { encrypt, decrypt } from '$lib/server/crypto';
import { upsertRemindersForDocument, cancelRemindersFor } from '$lib/server/reminders';
import type { PageServerLoad } from './$types';

export function _addDocument(
	userId: number,
	i: {
		type: 'passport' | 'drivers_license' | 'global_entry';
		number?: string;
		issuingAuthority?: string;
		expiresOn?: string;
		notes?: string;
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
			notes: i.notes
		})
		.returning()
		.get();
	upsertRemindersForDocument(doc);
	return doc;
}

export function _updateDocument(
	userId: number,
	id: number,
	i: {
		type: 'passport' | 'drivers_license' | 'global_entry';
		number?: string;
		issuingAuthority?: string;
		expiresOn?: string;
		notes?: string;
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
			notes: i.notes
		})
		.where(eq(travelDocuments.id, id))
		.returning()
		.get();
	upsertRemindersForDocument(doc);
	return doc;
}

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const rows = db.select().from(travelDocuments).where(eq(travelDocuments.userId, u.id)).all();
	return { documents: rows.map((d) => ({ ...d, number: d.number ? decrypt(d.number) : null })) };
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		_addDocument(u.id, {
			type: f.get('type') as 'passport' | 'drivers_license' | 'global_entry',
			number: String(f.get('number') || '') || undefined,
			issuingAuthority: String(f.get('issuingAuthority') || '') || undefined,
			expiresOn: String(f.get('expiresOn') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		throw redirect(303, '/profile/documents');
	},
	update: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		_updateDocument(u.id, Number(f.get('id')), {
			type: f.get('type') as 'passport' | 'drivers_license' | 'global_entry',
			number: String(f.get('number') || '') || undefined,
			issuingAuthority: String(f.get('issuingAuthority') || '') || undefined,
			expiresOn: String(f.get('expiresOn') || '') || undefined,
			notes: String(f.get('notes') || '') || undefined
		});
		throw redirect(303, '/profile/documents');
	},
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const id = Number((await request.formData()).get('id'));
		db.delete(travelDocuments)
			.where(and(eq(travelDocuments.id, id), eq(travelDocuments.userId, u.id)))
			.run();
		cancelRemindersFor('document', id);
		throw redirect(303, '/profile/documents');
	}
};
