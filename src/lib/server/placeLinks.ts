import { eq, desc, inList } from '@visorcraft/mongreldb-kit';
import { error } from '@sveltejs/kit';
import { kit } from '$lib/server/db';
import { placeLinks } from '$lib/server/db/mongrelSchema';
import { getPlaceById } from './places';
import { logAudit } from './audit';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';

// Mirrors tripDocumentLinks.ts at place scope. Places are owner-only (no
// sharing), so every mutation verifies the place belongs to the user.
export interface PlaceLink {
	id: number;
	placeId: number;
	label: string;
	url: string;
	notes: string | null;
	createdAt: string;
}

export interface PlaceLinkInput {
	label: string;
	url: string;
	notes?: string | null;
}

/** Partial update: absent keys are left untouched (never written as NULL). */
export type PlaceLinkPatch = Partial<PlaceLinkInput>;

export const PLACE_LINK_LABEL_MAX = 200;
export const PLACE_LINK_URL_MAX = 2000;
export const PLACE_LINK_NOTES_MAX = 2000;

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function toPlaceLink(row: Row<typeof placeLinks>): PlaceLink {
	return {
		id: Number(row.id),
		placeId: Number(row.place_id),
		label: row.label,
		url: row.url,
		notes: row.notes,
		createdAt: row.created_at
	};
}

function requireOwnedPlace(userId: number, placeId: number) {
	const place = getPlaceById(placeId, userId);
	if (!place) throw error(404, 'Not found');
	return place;
}

export function getPlaceLinkById(id: number): PlaceLink | null {
	const rows = kit
		.selectFrom(placeLinks)
		.where(eq(placeLinks.id, toBigInt(id)))
		.executeSync();
	return rows[0] ? toPlaceLink(rows[0]) : null;
}

function requireOwnedPlaceLink(placeId: number, linkId: number): PlaceLink {
	const row = getPlaceLinkById(linkId);
	if (!row || row.placeId !== placeId) throw error(404, 'Not found');
	return row;
}

function validateLabel(raw: string): string {
	const label = raw.trim();
	if (!label) throw error(400, 'Label is required');
	if (label.length > PLACE_LINK_LABEL_MAX) {
		throw error(400, `Label must be ${PLACE_LINK_LABEL_MAX} characters or less`);
	}
	return label;
}

function validateUrl(raw: string): string {
	const url = raw.trim();
	if (!url) throw error(400, 'URL is required');
	if (url.length > PLACE_LINK_URL_MAX) {
		throw error(400, `URL must be ${PLACE_LINK_URL_MAX} characters or less`);
	}
	if (!isValidHttpUrl(url)) throw error(400, 'URL must be a valid http or https URL');
	return url;
}

function isValidHttpUrl(raw: string): boolean {
	try {
		const u = new URL(raw);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

function validateNotes(raw: string | null | undefined): string | null {
	const notes = raw?.trim() || null;
	if (notes && notes.length > PLACE_LINK_NOTES_MAX) {
		throw error(400, `Notes must be ${PLACE_LINK_NOTES_MAX} characters or less`);
	}
	return notes;
}

export function listPlaceLinks(placeId: number): PlaceLink[] {
	const rows = kit
		.selectFrom(placeLinks)
		.where(eq(placeLinks.place_id, toBigInt(placeId)))
		.orderBy(desc(placeLinks.created_at), desc(placeLinks.id))
		.executeSync();
	return rows.map(toPlaceLink);
}

/** Batch fetch for list pages (one query, grouped by place). */
export function listPlaceLinksForPlaces(placeIds: number[]): Map<number, PlaceLink[]> {
	const result = new Map<number, PlaceLink[]>();
	if (placeIds.length === 0) return result;
	const rows = kit
		.selectFrom(placeLinks)
		.where(inList(placeLinks.place_id, placeIds.map(toBigInt)))
		.orderBy(desc(placeLinks.created_at), desc(placeLinks.id))
		.executeSync();
	for (const row of rows) {
		const link = toPlaceLink(row);
		const list = result.get(link.placeId) ?? [];
		list.push(link);
		result.set(link.placeId, list);
	}
	return result;
}

export function createPlaceLink(userId: number, placeId: number, input: PlaceLinkInput): PlaceLink {
	requireOwnedPlace(userId, placeId);
	const label = validateLabel(input.label);
	const url = validateUrl(input.url);
	const notes = validateNotes(input.notes);

	const row = kit
		.insertInto(placeLinks)
		.values({
			place_id: toBigInt(placeId),
			label,
			url,
			notes
		} as Insert<typeof placeLinks>)
		.executeSync();
	const link = toPlaceLink(row);

	logAudit(userId, 'place_link_create', 'place_link', link.id, { placeId, label });
	return link;
}

export function updatePlaceLink(
	userId: number,
	placeId: number,
	linkId: number,
	patch: PlaceLinkPatch
): PlaceLink {
	requireOwnedPlace(userId, placeId);
	const existing = requireOwnedPlaceLink(placeId, linkId);

	// Partial patch: absent keys are omitted entirely so they are never
	// written as NULL (Kit treats explicit undefined as NULL).
	const set: Update<typeof placeLinks> = {};
	if (patch.label !== undefined) set.label = validateLabel(patch.label);
	if (patch.url !== undefined) set.url = validateUrl(patch.url);
	if (patch.notes !== undefined) set.notes = validateNotes(patch.notes);
	if (Object.keys(set).length === 0) return existing;

	const rows = kit
		.updateTable(placeLinks)
		.set(set)
		.where(eq(placeLinks.id, toBigInt(linkId)))
		.executeSync();
	const row = rows[0];
	if (!row) throw error(404, 'Not found');

	logAudit(userId, 'place_link_update', 'place_link', linkId, { placeId });
	return toPlaceLink(row);
}

export function deletePlaceLink(userId: number, placeId: number, linkId: number): void {
	requireOwnedPlace(userId, placeId);
	const existing = requireOwnedPlaceLink(placeId, linkId);

	kit.deleteFrom(placeLinks).where(eq(placeLinks.id, toBigInt(linkId))).executeSync();
	logAudit(userId, 'place_link_delete', 'place_link', linkId, {
		placeId,
		label: existing.label
	});
}
