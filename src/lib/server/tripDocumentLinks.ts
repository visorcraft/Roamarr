import { and, desc, eq } from 'drizzle-orm';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import { tripDocumentLinks } from './db/schema';
import { requireUser } from './auth';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { Validator } from './validation';

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
	const existing = db
		.select()
		.from(tripDocumentLinks)
		.where(and(eq(tripDocumentLinks.id, linkId), eq(tripDocumentLinks.tripId, tripId)))
		.get();
	if (!existing) throw error(404, 'Not found');

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
	const existing = db
		.select()
		.from(tripDocumentLinks)
		.where(and(eq(tripDocumentLinks.id, linkId), eq(tripDocumentLinks.tripId, tripId)))
		.get();
	if (!existing) throw error(404, 'Not found');

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
	const urlRaw = typeof formData.get('url') === 'string' ? String(formData.get('url')).trim() : '';
	if (!urlRaw) {
		v.addError('url', 'url is required');
	} else if (urlRaw.length > 2048) {
		v.addError('url', 'url must be at most 2048 characters');
	} else if (!isValidHttpUrl(urlRaw)) {
		v.addError('url', 'url must be a valid http or https URL');
	}
	if (!v.ok()) return { errors: v.errors, message: v.failMessage() };
	return { label: label!, url: urlRaw, notes };
}

export async function addDocumentLink(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const validated = validateLinkForm(await event.request.formData());
	if ('errors' in validated) {
		return fail(400, { error: validated.message, errors: validated.errors });
	}
	createDocumentLink(u.id, tripId, validated);
	throw redirect(303, `/trips/${tripId}`);
}

export async function updateDocumentLink(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const formData = await event.request.formData();
	const linkId = Number(formData.get('linkId'));
	if (!Number.isFinite(linkId) || linkId <= 0) throw error(400, 'Invalid link');

	const validated = validateLinkForm(formData);
	if ('errors' in validated) {
		return fail(400, { error: validated.message, errors: validated.errors });
	}
	editDocumentLink(u.id, tripId, linkId, validated);
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteDocumentLink(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const formData = await event.request.formData();
	const linkId = Number(formData.get('linkId'));
	if (!Number.isFinite(linkId) || linkId <= 0) throw error(400, 'Invalid link');

	removeDocumentLink(u.id, tripId, linkId);
	throw redirect(303, `/trips/${tripId}`);
}
