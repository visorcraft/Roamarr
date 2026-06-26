import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { db } from '$lib/server/db';
import { trips, segments } from '$lib/server/db/schema';
import type { trips as tripsTable, segments as segmentsTable } from '$lib/server/db/schema';
import { canView, canEdit, canViewDetails, viewerProjection } from '$lib/server/sharing';
import { requireOwnedTrip } from '$lib/server/ownership';
import { serializeTags } from '$lib/tags';

type Trip = typeof tripsTable.$inferSelect;
type Segment = typeof segmentsTable.$inferSelect;
type Projection = ReturnType<typeof viewerProjection>;

type TripView =
	| { owner: true; editor: true; trip: Trip; segments: Segment[] }
	| { owner: false; editor: true; trip: Trip; segments: Segment[] }
	| { owner: false; editor: false; trip: Projection };

export function createTrip(
	userId: number,
	i: {
		name: string;
		destination?: string;
		startDate?: string;
		endDate?: string;
		notes?: string;
		tags?: string;
		defaultVisibility?: string;
	}
) {
	const publicToken =
		i.defaultVisibility === 'public' ? randomBytes(24).toString('base64url') : null;
	return db
		.insert(trips)
		.values({
			ownerId: userId,
			name: i.name,
			destination: i.destination,
			startDate: i.startDate,
			endDate: i.endDate,
			notes: i.notes,
			tags: serializeTags(i.tags),
			defaultVisibility: i.defaultVisibility ?? 'private',
			publicToken
		})
		.returning()
		.get();
}

export function regenerateCalendarToken(ownerId: number, tripId: number, expiresAt?: string | null) {
	requireOwnedTrip(ownerId, tripId);
	const token = randomBytes(24).toString('base64url');
	db.update(trips)
		.set({ calendarToken: token, calendarTokenExpiresAt: expiresAt ?? null })
		.where(eq(trips.id, tripId))
		.run();
	return token;
}

export function revokeCalendarToken(ownerId: number, tripId: number) {
	requireOwnedTrip(ownerId, tripId);
	db.update(trips).set({ calendarToken: null, calendarTokenExpiresAt: null }).where(eq(trips.id, tripId)).run();
}

export function duplicateTrip(ownerId: number, tripId: number) {
	const t = db.select().from(trips).where(eq(trips.id, tripId)).get();
	if (!t || t.ownerId !== ownerId) throw error(403, 'Not allowed');
	const segs = db.select().from(segments).where(eq(segments.tripId, tripId)).all();
	const copy = db
		.insert(trips)
		.values({
			ownerId,
			name: `Copy of ${t.name}`,
			destination: t.destination,
			startDate: t.startDate,
			endDate: t.endDate,
			notes: t.notes,
			tags: t.tags,
			defaultVisibility: t.defaultVisibility
		})
		.returning()
		.get();
	for (const s of segs) {
		db.insert(segments)
			.values({
				tripId: copy.id,
				type: s.type,
				title: s.title,
				startAt: s.startAt,
				startTz: s.startTz,
				endAt: s.endAt,
				location: s.location,
				confirmationNumber: s.confirmationNumber,
				detailsJson: s.detailsJson,
				cardId: s.cardId
			})
			.run();
	}
	return copy;
}

export function loadTripFor(userId: number, tripId: number): TripView {
	const t = db.select().from(trips).where(eq(trips.id, tripId)).get();
	if (!t || !canView(userId, t)) throw error(404, 'Not found');
	const segs = db.select().from(segments).where(eq(segments.tripId, t.id)).all();
	const editable = canEdit(userId, t);
	if (editable) return { owner: t.ownerId === userId, editor: true, trip: t, segments: segs };
	return { owner: false, editor: false, trip: viewerProjection(t, segs, canViewDetails(userId, t)) };
}


