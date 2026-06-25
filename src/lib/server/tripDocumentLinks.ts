import { desc, eq } from 'drizzle-orm';
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import { tripDocumentLinks } from './db/schema';
import { requireEditableTrip, requireOwnedTripRow } from './ownership';
import { logAudit } from './audit';
import { Validator, httpUrl, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';

export type DocumentLinkInput = {
	label: string;
	url: string;
	notes?: string | null;
};

export type DocumentLinkRow = typeof tripDocumentLinks.$inferSelect;

export function listDocumentLinks(tripId: number): DocumentLinkRow[] {
	return db
		.select()
		.from(tripDocumentLinks)
		.where(eq(tripDocumentLinks.tripId, tripId))
		.orderBy(desc(tripDocumentLinks.createdAt), desc(tripDocumentLinks.id))
		.all();
}

export function createDocumentLink(
	userId: number,
	tripId: number,
	input: DocumentLinkInput
): DocumentLinkRow {
	requireEditableTrip(userId, tripId);
	const { label, url, notes } = normalizeInput(input);

	const row = db
		.insert(tripDocumentLinks)
		.values({ tripId, label, url, notes })
		.returning()
		.get();

	logAudit(userId, 'document_link_create', 'trip_document_link', row.id, { tripId, label });
	return row;
}

export function editDocumentLink(
	userId: number,
	tripId: number,
	linkId: number,
	input: DocumentLinkInput
): DocumentLinkRow {
	requireEditableTrip(userId, tripId);
	requireOwnedTripRow(tripDocumentLinks, tripId, linkId, 'Not found');
	const { label, url, notes } = normalizeInput(input);
	const row = db
		.update(tripDocumentLinks)
		.set({ label, url, notes })
		.where(eq(tripDocumentLinks.id, linkId))
		.returning()
		.get();

	logAudit(userId, 'document_link_update', 'trip_document_link', linkId, { tripId, label });
	return row;
}

export function removeDocumentLink(userId: number, tripId: number, linkId: number) {
	requireEditableTrip(userId, tripId);
	const existing = requireOwnedTripRow(tripDocumentLinks, tripId, linkId, 'Not found');

	db.delete(tripDocumentLinks).where(eq(tripDocumentLinks.id, linkId)).run();
	logAudit(userId, 'document_link_delete', 'trip_document_link', linkId, {
		tripId,
		label: existing.label
	});
}

function normalizeInput(input: DocumentLinkInput) {
	const label = input.label.trim();
	const url = input.url.trim();
	const notes = input.notes?.trim() || null;
	if (!label) throw new Error('Label is required');
	if (!url) throw new Error('URL is required');
	if (!isValidHttpUrl(url)) throw new Error('URL must be a valid http or https URL');
	return { label, url, notes };
}

function isValidHttpUrl(raw: string): boolean {
	try {
		const u = new URL(raw);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

function validateLinkForm(
	formData: FormData
): { label: string; url: string; notes?: string } | { errors: Record<string, string>; message: string } {
	const v = new Validator();
	const label = v.requiredString(formData.get('label'), 'label', { max: 200 });
	const notes = v.optionalString(formData.get('notes'), 'notes', { max: 2000 });
	const urlResult = httpUrl(formData.get('url'), 'url');
	if (!urlResult.ok) v.addError('url', urlResult.error);
	if (!v.ok() || !urlResult.ok) return { errors: v.errors, message: v.failMessage() };
	return { label: label!, url: urlResult.value, notes };
}

export async function addDocumentLink(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);

	const validated = validateLinkForm(formData);
	if ('errors' in validated) {
		return fail(400, { error: validated.message, errors: validated.errors });
	}
	createDocumentLink(user.id, tripId, validated);
	throw redirect(303, `/trips/${tripId}`);
}

export async function updateDocumentLink(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const linkIdResult = positiveIdFromForm(formData.get('linkId'), 'linkId');
	if (!linkIdResult.ok) return fail(400, { error: linkIdResult.error });

	const validated = validateLinkForm(formData);
	if ('errors' in validated) {
		return fail(400, { error: validated.message, errors: validated.errors });
	}
	editDocumentLink(user.id, tripId, linkIdResult.value, validated);
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteDocumentLink(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const linkIdResult = positiveIdFromForm(formData.get('linkId'), 'linkId');
	if (!linkIdResult.ok) return fail(400, { error: linkIdResult.error });

	removeDocumentLink(user.id, tripId, linkIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}
