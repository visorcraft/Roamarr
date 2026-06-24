import { and, eq, gte } from 'drizzle-orm';
import { db } from './db';
import { trips, tripShares, groupMembers } from './db/schema';
import type { trips as tripsTable, segments } from './db/schema';

type Trip = typeof tripsTable.$inferSelect;
type Segment = typeof segments.$inferSelect;

export function canEdit(userId: number, trip: Trip) {
	return trip.ownerId === userId;
}

export function canView(userId: number, trip: Trip) {
	if (trip.ownerId === userId) return true;
	const direct = db
		.select()
		.from(tripShares)
		.where(and(eq(tripShares.tripId, trip.id), eq(tripShares.sharedWithUserId, userId)))
		.get();
	if (direct) return true;
	const viaGroup = db
		.select({ id: tripShares.id })
		.from(tripShares)
		.innerJoin(groupMembers, eq(tripShares.sharedWithGroupId, groupMembers.groupId))
		.where(and(eq(tripShares.tripId, trip.id), eq(groupMembers.userId, userId)))
		.get();
	return !!viaGroup;
}

export function viewerProjection(trip: Trip, segs: Segment[]) {
	return {
		id: trip.id,
		name: trip.name,
		destination: trip.destination,
		startDate: trip.startDate,
		endDate: trip.endDate,
		segments: segs.map((s) => ({
			type: s.type,
			title: s.title,
			startAt: s.startAt,
			endAt: s.endAt,
			location: s.location
		}))
	};
}

export type ListedTrip =
	| (Trip & { isShared: false })
	| (ReturnType<typeof viewerProjection> & { isShared: true });

export function listViewableTrips(userId: number, options?: { startDateGte?: string }): ListedTrip[] {
	const ownedWhere = options?.startDateGte
		? and(eq(trips.ownerId, userId), gte(trips.startDate, options.startDateGte))
		: eq(trips.ownerId, userId);
	const owned = db.select().from(trips).where(ownedWhere).all();

	const sharedByUser = db
		.select({ trip: trips })
		.from(trips)
		.innerJoin(tripShares, eq(trips.id, tripShares.tripId))
		.where(eq(tripShares.sharedWithUserId, userId))
		.all();

	const sharedByGroup = db
		.select({ trip: trips })
		.from(trips)
		.innerJoin(tripShares, eq(trips.id, tripShares.tripId))
		.innerJoin(groupMembers, eq(tripShares.sharedWithGroupId, groupMembers.groupId))
		.where(eq(groupMembers.userId, userId))
		.all();

	const map = new Map<number, ListedTrip>();
	for (const t of owned) map.set(t.id, { ...t, isShared: false });
	for (const { trip: t } of [...sharedByUser, ...sharedByGroup]) {
		if (map.has(t.id)) continue;
		if (!canView(userId, t)) continue;
		if (options?.startDateGte && t.startDate && t.startDate < options.startDateGte) continue;
		map.set(t.id, { ...viewerProjection(t, []), isShared: true });
	}

	return Array.from(map.values());
}
