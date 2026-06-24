import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { db } from '$lib/server/db';
import { trips, segments } from '$lib/server/db/schema';
import type { trips as tripsTable, segments as segmentsTable } from '$lib/server/db/schema';
import { canView, canEdit, viewerProjection } from '$lib/server/sharing';
import { requireOwnedTrip } from '$lib/server/ownership';

type Trip = typeof tripsTable.$inferSelect;
type Segment = typeof segmentsTable.$inferSelect;
type Projection = ReturnType<typeof viewerProjection>;

export type TripView =
	| { owner: true; trip: Trip; segments: Segment[] }
	| { owner: false; trip: Projection };

export function createTrip(
	userId: number,
	i: {
		name: string;
		destination?: string;
		startDate?: string;
		endDate?: string;
		notes?: string;
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
			defaultVisibility: i.defaultVisibility ?? 'private',
			publicToken
		})
		.returning()
		.get();
}

export function loadTripFor(userId: number, tripId: number): TripView {
	const t = db.select().from(trips).where(eq(trips.id, tripId)).get();
	if (!t || !canView(userId, t)) throw error(404, 'Not found');
	const segs = db.select().from(segments).where(eq(segments.tripId, t.id)).all();
	if (canEdit(userId, t)) return { owner: true, trip: t, segments: segs };
	return { owner: false, trip: viewerProjection(t, segs) };
}


