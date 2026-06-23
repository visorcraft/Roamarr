import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { tripShares, groupMembers } from './db/schema';
import type { trips, segments } from './db/schema';

type Trip = typeof trips.$inferSelect;
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
