import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import {
	listDocumentLinksForTrip,
	createDocumentLink as repoCreateDocumentLink,
	updateDocumentLink as repoUpdateDocumentLink,
	deleteDocumentLink as repoDeleteDocumentLink,
	getDocumentLinkById
} from './repositories/tripMiscRepo';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { Validator, httpUrl, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';

type DocumentLinkInput = {
	label: string;
	url: string;
	notes?: string | null;
};

export function listDocumentLinks(tripId: number) {
	return listDocumentLinksForTrip(tripId);
}

export function createDocumentLink(
	userId: number,
	tripId: number,
	input: DocumentLinkInput
) {
	requireEditableTrip(userId, tripId);
	const { label, url, notes } = normalizeInput(input);

	const row = repoCreateDocumentLink({ tripId, label, url, notes });

	logAudit(userId, 'document_link_create', 'trip_document_link', row.id, { tripId, label });
	return row;
}

export function editDocumentLink(
	userId: number,
	tripId: number,
	linkId: number,
	input: DocumentLinkInput
) {
	requireEditableTrip(userId, tripId);
	requireOwnedDocumentLink(tripId, linkId);
	const { label, url, notes } = normalizeInput(input);
	const row = repoUpdateDocumentLink(linkId, { label, url, notes });
	if (!row) throw error(404, 'Not found');

	logAudit(userId, 'document_link_update', 'trip_document_link', linkId, { tripId, label });
	return row;
}

export function removeDocumentLink(userId: number, tripId: number, linkId: number) {
	requireEditableTrip(userId, tripId);
	const existing = requireOwnedDocumentLink(tripId, linkId);

	repoDeleteDocumentLink(linkId);
	logAudit(userId, 'document_link_delete', 'trip_document_link', linkId, {
		tripId,
		label: existing.label
	});
}

function requireOwnedDocumentLink(tripId: number, linkId: number) {
	const row = getDocumentLinkById(linkId);
	if (!row || row.tripId !== tripId) throw error(404, 'Not found');
	return row;
}

function normalizeInput(input: DocumentLinkInput) {
	const label = input.label.trim();
	const url = input.url.trim();
	const notes = input.notes?.trim() || null;
	if (!label) throw error(400, 'Label is required');
	if (!url) throw error(400, 'URL is required');
	if (!isValidHttpUrl(url)) throw error(400, 'URL must be a valid http or https URL');
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

export async function deleteDocumentLink(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const linkIdResult = positiveIdFromForm(formData.get('linkId'), 'linkId');
	if (!linkIdResult.ok) return fail(400, { error: linkIdResult.error });

	removeDocumentLink(user.id, tripId, linkIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}
