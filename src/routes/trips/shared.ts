import { error } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import type { Trip } from '$lib/server/repositories/tripsRepo';
import { listSegmentsForTrip, createSegment } from '$lib/server/repositories/segmentsRepo';
import { canView, canEdit, canViewDetails, viewerProjection } from '$lib/server/sharing';
import { requireOwnedTrip } from '$lib/server/ownership';
import { serializeTags } from '$lib/tags';

type Segment = ReturnType<typeof listSegmentsForTrip>[number];
type Projection = ReturnType<typeof viewerProjection>;

type TripView =
	| { owner: true; editor: true; trip: Trip; segments: Segment[] }
	| { owner: false; editor: true; trip: Trip; segments: Segment[] }
	| { owner: false; editor: false; trip: Projection };

export function createTrip(
	userId: number,
	i: {
		name: string;
		destinationCountryCode?: string;
		destinationCityName?: string;
		destinationCityLat?: number;
		destinationCityLng?: number;
		startDate?: string;
		endDate?: string;
		notes?: string;
		tags?: string;
		defaultVisibility?: string;
	}
) {
	const calendarToken = randomBytes(24).toString('base64url');
	return tripsRepo.createTrip(userId, {
		name: i.name,
		destinationCountryCode: i.destinationCountryCode,
		destinationCityName: i.destinationCityName,
		destinationCityLat: i.destinationCityLat,
		destinationCityLng: i.destinationCityLng,
		startDate: i.startDate,
		endDate: i.endDate,
		notes: i.notes,
		tags: serializeTags(i.tags),
		defaultVisibility: (i.defaultVisibility as 'private' | 'groups' | 'public') ?? 'private',
		calendarToken
	});
}

export function regenerateCalendarToken(ownerId: number, tripId: number, expiresAt?: string | null) {
	requireOwnedTrip(ownerId, tripId);
	const token = randomBytes(24).toString('base64url');
	tripsRepo.updateTrip(tripId, { calendarToken: token, calendarTokenExpiresAt: expiresAt ?? null });
	return token;
}

export function revokeCalendarToken(ownerId: number, tripId: number) {
	requireOwnedTrip(ownerId, tripId);
	tripsRepo.updateTrip(tripId, { calendarToken: null, calendarTokenExpiresAt: null });
}

export function duplicateTrip(ownerId: number, tripId: number) {
	const t = tripsRepo.getTripById(tripId);
	if (!t || t.ownerId !== ownerId) throw error(403, 'Not allowed');
	const segs = listSegmentsForTrip(tripId);
	const copy = tripsRepo.createTrip(ownerId, {
		name: `Copy of ${t.name}`,
		destinationCountryCode: t.destinationCountryCode,
		destinationCityName: t.destinationCityName,
		destinationCityLat: t.destinationCityLat,
		destinationCityLng: t.destinationCityLng,
		startDate: t.startDate,
		endDate: t.endDate,
		notes: t.notes,
		tags: t.tags,
		defaultVisibility: t.defaultVisibility
	});
	for (const s of segs) {
		createSegment({
			trip_id: BigInt(copy.id),
			type: s.type,
			title: s.title,
			start_at: s.startAt,
			start_tz: s.startTz,
			end_at: s.endAt,
			location: s.location,
			confirmation_number: s.confirmationNumber,
			details_json: s.detailsJson,
			card_id: s.cardId != null ? BigInt(s.cardId) : null
		});
	}
	return copy;
}

export function loadTripFor(userId: number, tripId: number): TripView {
	const t = tripsRepo.getTripById(tripId);
	if (!t || !canView(userId, t)) throw error(404, 'Not found');
	const segs = listSegmentsForTrip(t.id);
	const editable = canEdit(userId, t);
	if (editable) return { owner: t.ownerId === userId, editor: true, trip: t, segments: segs };
	return { owner: false, editor: false, trip: viewerProjection(t, segs, canViewDetails(userId, t)) };
}
