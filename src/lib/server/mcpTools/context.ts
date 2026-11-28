import { error } from '@sveltejs/kit';
import type { Scope } from '../oauth';
import * as tripsRepo from '../repositories/tripsRepo';
import * as segmentsRepo from '../repositories/segmentsRepo';
import { loadTripFor } from '../../../routes/trips/shared';
import { viewerProjection } from '../sharing';
import { getSettings } from '../settings';
import { effectiveTripStatus, todayForUser } from '../tripLifecycle';
import { findCity } from '../cities';
import { reqString, optString } from '../mcpHelpers';
import { optionalPositiveId, positiveId } from '../mcpArgParsers';
import { requireViewableTrip } from '../ownership';
import type { TripDocumentRow } from '../repositories/tripDocumentsRepo';
import type { MailHold } from '../repositories/tripMiscRepo';

export type McpToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export interface McpToolContext {
	userId: number;
	scopes: Scope[];
	args: Record<string, unknown>;
}

export interface McpToolSpec {
	scope?: Scope;
	confirm?: boolean;
	handler: (ctx: McpToolContext) => Promise<McpToolResult> | McpToolResult;
}

export type McpToolModule = Record<string, McpToolSpec>;

export function hasScope(scopes: Scope[], required: Scope): boolean {
	return scopes.includes(required);
}

export function scopeError(required: Scope) {
	return {
		content: [{ type: 'text' as const, text: `Missing required scope: ${required}` }],
		isError: true
	};
}

export function textResult(obj: unknown) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }]
	};
}

export function withDerivedStatus<T extends { status?: string | null; startDate?: string | null; endDate?: string | null }>(
	userId: number,
	trip: T
): T & { status: ReturnType<typeof effectiveTripStatus> } {
	return { ...trip, status: effectiveTripStatus(trip, todayForUser(userId)) };
}

export function canReadPrivateDetails(scopes: Scope[]): boolean {
	return getSettings().allowMcpPii && hasScope(scopes, 'private-details:read');
}

export function safeTripProjection(tripId: number, userId: number, scopes: Scope[]) {
	const view = loadTripFor(userId, tripId);
	const includePrivateDetails = canReadPrivateDetails(scopes);
	if (view.editor) {
		const projection = viewerProjection(view.trip, view.segments, false);
		return withDerivedStatus(userId, {
			...projection,
			...(includePrivateDetails && {
				notes: view.trip.notes,
				segments: view.segments.map(({ tripId: _tripId, cardId: _cardId, ...segment }) => segment)
			}),
			canEdit: true,
			owner: view.owner
		});
	}
	if (includePrivateDetails) return withDerivedStatus(userId, { ...view.trip, canEdit: false, owner: false });
	return withDerivedStatus(userId, {
		...view.trip,
		segments: view.trip.segments.map((segment) => {
			const safe = { ...segment } as Record<string, unknown>;
			delete safe.confirmationNumber;
			delete safe.detailsJson;
			return safe;
		}),
		canEdit: false,
		owner: false
	});
}

export function destinationCityPatch(
	args: Record<string, unknown>,
	current?: ReturnType<typeof tripsRepo.getTripById>
) {
	const destinationCityName = args.destinationCityName as string | undefined;
	const destinationCountryCode = args.destinationCountryCode as string | undefined;
	const destinationAdmin1Code =
		(args.destinationAdmin1Code as string | undefined) ??
		(args.admin1Code as string | undefined);
	const latArg = args.destinationCityLat as number | undefined;
	const lngArg = args.destinationCityLng as number | undefined;

	// Metadata-only updates (name/notes/status/…) must not touch destination
	// fields — otherwise a missed findCity would write null lat/lng and wipe
	// stored coordinates (updateTrip treats null as an intentional clear).
	const touchingDestination =
		destinationCityName !== undefined ||
		destinationCountryCode !== undefined ||
		destinationAdmin1Code !== undefined ||
		latArg !== undefined ||
		lngArg !== undefined;
	if (!touchingDestination) return {};

	const name = destinationCityName ?? current?.destinationCityName ?? null;
	const countryCode = destinationCountryCode ?? current?.destinationCountryCode ?? null;
	const admin1 =
		destinationAdmin1Code !== undefined
			? destinationAdmin1Code
			: (current?.destinationAdmin1Code ?? null);
	const hasCoords = latArg != null && lngArg != null;
	// Prefer explicit coords; otherwise look up highest-pop exact name in
	// country (+ admin1 when set). findCity works even when maps UI is off
	// as long as the city table has rows (MCP/import enrichment path).
	const city = name && countryCode ? findCity(countryCode, name, admin1) : null;

	// Only include keys that should be written. Omitting lat/lng on a miss
	// leaves updateTrip as a no-op for those columns (undefined ≠ null wipe).
	const patch: {
		destinationCountryCode?: string | null;
		destinationAdmin1Code?: string | null;
		destinationCityName?: string | null;
		destinationCityLat?: number | null;
		destinationCityLng?: number | null;
	} = {};

	if (destinationCountryCode !== undefined) {
		patch.destinationCountryCode = destinationCountryCode || null;
	}
	if (destinationAdmin1Code !== undefined) {
		patch.destinationAdmin1Code = destinationAdmin1Code || null;
	} else if (city?.admin1Code != null) {
		patch.destinationAdmin1Code = city.admin1Code;
	}
	if (destinationCityName !== undefined) {
		patch.destinationCityName = (city?.name ?? destinationCityName) || null;
	} else if (city?.name) {
		patch.destinationCityName = city.name;
	}
	if (hasCoords) {
		patch.destinationCityLat = latArg!;
		patch.destinationCityLng = lngArg!;
	} else if (city) {
		patch.destinationCityLat = city.lat;
		patch.destinationCityLng = city.lng;
	}

	return patch;
}

export function attachmentMimeType(value: unknown): string {
	const mime = reqString(value, 'mimeType', 127).split(';', 1)[0]!.trim().toLowerCase();
	if (!mime) throw error(400, 'mimeType is required');
	return mime;
}

export function boundedOptional(value: unknown, field: string, max: number): string | null {
	if (value == null) return null;
	if (typeof value !== 'string') throw error(400, `${field} must be a string`);
	return optString(value, max);
}

/** tripId, segmentId, or both. A segment id alone resolves its trip. */
export function resolveAttachmentTarget(args: Record<string, unknown>): { tripId: number; segmentId: number | null } {
	const tripId = optionalPositiveId(args.tripId, 'tripId');
	const segmentId = optionalPositiveId(args.segmentId, 'segmentId');
	if (tripId == null && segmentId == null) throw error(400, 'tripId or segmentId is required');
	if (tripId == null) {
		const seg = segmentsRepo.getSegmentById(segmentId!);
		if (!seg) throw error(404, 'Not found');
		return { tripId: seg.tripId, segmentId };
	}
	return { tripId, segmentId };
}

export function projectTripDocument(row: Omit<TripDocumentRow, 'attachmentId'>, includeNotes: boolean) {
	return {
		id: row.id,
		tripId: row.tripId,
		segmentId: row.segmentId,
		label: row.label,
		notes: includeNotes ? row.notes : null,
		filename: row.filename,
		contentType: row.contentType,
		sizeBytes: row.sizeBytes,
		createdAt: row.createdAt
	};
}

export function projectMailHold(hold: MailHold, includePrivate: boolean) {
	return {
		...hold,
		confirmationNumber: includePrivate ? hold.confirmationNumber : null,
		notes: includePrivate ? hold.notes : null
	};
}

/** View-authorized trip document. Optional tripId must match the file's trip. */
export async function loadTripDocumentForView(userId: number, args: Record<string, unknown>) {
	const documentId = positiveId(args.documentId, 'documentId');
	const expectedTripId = optionalPositiveId(args.tripId, 'tripId');
	const { getTripDocumentLinkById } = await import('../repositories/tripDocumentsRepo');
	const link = getTripDocumentLinkById(documentId);
	if (!link || (expectedTripId != null && link.tripId !== expectedTripId)) {
		throw error(404, 'Document not found');
	}
	const trip = requireViewableTrip(userId, link.tripId);
	const { listTripDocuments } = await import('../tripDocuments');
	const row = listTripDocuments(link.tripId).find((item) => item.id === link.id);
	if (!row) throw error(404, 'Document not found');
	return { row, trip };
}
