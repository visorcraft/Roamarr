import { and, eq, gte, inArray, like, sql } from 'drizzle-orm';
import { db } from './db';
import { trips, tripShares, groupMembers, segments } from './db/schema';
import type { trips as tripsTable } from './db/schema';

type Trip = typeof tripsTable.$inferSelect;
type Segment = typeof segments.$inferSelect;

export function tripTags(trip: { tags: string }): string[] {
	try {
		const parsed = JSON.parse(trip.tags);
		if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === 'string');
	} catch {
		// fall through
	}
	return [];
}

function tripHasTag(trip: ListedTrip, tag: string): boolean {
	const tags = 'isShared' in trip && trip.isShared ? trip.tags : tripTags(trip as Trip);
	return tags.some((t) => t.toLowerCase() === tag.toLowerCase());
}

export function canEdit(userId: number, trip: Trip) {
	if (trip.ownerId === userId) return true;
	const direct = db
		.select()
		.from(tripShares)
		.where(
			and(
				eq(tripShares.tripId, trip.id),
				eq(tripShares.sharedWithUserId, userId),
				eq(tripShares.permission, 'edit')
			)
		)
		.get();
	if (direct) return true;
	const viaGroup = db
		.select({ id: tripShares.id })
		.from(tripShares)
		.innerJoin(groupMembers, eq(tripShares.sharedWithGroupId, groupMembers.groupId))
		.where(
			and(
				eq(tripShares.tripId, trip.id),
				eq(groupMembers.userId, userId),
				eq(tripShares.permission, 'edit')
			)
		)
		.get();
	return !!viaGroup;
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

export function canViewDetails(userId: number, trip: Trip) {
	if (trip.ownerId === userId) return true;
	const direct = db
		.select({ id: tripShares.id })
		.from(tripShares)
		.where(
			and(
				eq(tripShares.tripId, trip.id),
				eq(tripShares.sharedWithUserId, userId),
				eq(tripShares.showDetails, true)
			)
		)
		.get();
	if (direct) return true;
	const viaGroup = db
		.select({ id: tripShares.id })
		.from(tripShares)
		.innerJoin(groupMembers, eq(tripShares.sharedWithGroupId, groupMembers.groupId))
		.where(
			and(
				eq(tripShares.tripId, trip.id),
				eq(groupMembers.userId, userId),
				eq(tripShares.showDetails, true)
			)
		)
		.get();
	return !!viaGroup;
}

export function viewerProjection(trip: Trip, segs: Segment[], includeDetails = false) {
	return {
		id: trip.id,
		name: trip.name,
		destination: trip.destination,
		startDate: trip.startDate,
		endDate: trip.endDate,
		createdAt: trip.createdAt,
		archived: trip.archived,
		favorite: trip.favorite,
		tags: tripTags(trip),
		segments: segs.map((s) => ({
			type: s.type,
			title: s.title,
			startAt: s.startAt,
			endAt: s.endAt,
			location: s.location,
			...(includeDetails && {
				confirmationNumber: s.confirmationNumber,
				detailsJson: s.detailsJson
			})
		}))
	};
}

export type ListedTrip =
	| (Trip & { isShared: false })
	| (ReturnType<typeof viewerProjection> & { isShared: true });

type SortField = 'name' | 'startDate' | 'createdAt';
type SortOrder = 'asc' | 'desc';
type TripFilter = 'active' | 'archived' | 'favorites';

export function listViewableTrips(
	userId: number,
	options?: { startDateGte?: string; q?: string; tag?: string; sort?: SortField; order?: SortOrder; filter?: TripFilter }
): ListedTrip[] {
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

	let result = Array.from(map.values());

	const q = options?.q?.trim();
	if (q) {
		const needle = q.toLowerCase();
		const pattern = `%${q.toLowerCase()}%`;
		const ownedIds = result.filter((t) => !t.isShared).map((t) => t.id);
		const segmentMatches = ownedIds.length
			? db
					.select({ tripId: segments.tripId })
					.from(segments)
					.where(
						and(
							inArray(segments.tripId, ownedIds),
							sql`lower(${segments.title}) like ${pattern} or lower(${segments.location}) like ${pattern} or lower(${segments.confirmationNumber}) like ${pattern}`
						)
					)
					.all()
			: [];
		const segmentTripIds = new Set(segmentMatches.map((s) => s.tripId));
		result = result.filter((t) => {
			const haystack = `${t.name ?? ''} ${t.destination ?? ''}`.toLowerCase();
			if (haystack.includes(needle)) return true;
			if (!t.isShared && segmentTripIds.has(t.id)) return true;
			return false;
		});
	}

	const tag = options?.tag?.trim();
	if (tag) {
		result = result.filter((t) => tripHasTag(t, tag));
	}

	const filter: TripFilter = options?.filter ?? 'active';
	if (filter === 'archived') {
		result = result.filter((t) => t.archived);
	} else if (filter === 'favorites') {
		result = result.filter((t) => t.favorite);
	} else {
		result = result.filter((t) => !t.archived);
	}

	const sort: SortField = options?.sort ?? 'startDate';
	const order: SortOrder = options?.order === 'desc' ? 'desc' : 'asc';
	const dir = order === 'desc' ? -1 : 1;
	result.sort((a, b) => {
		let va: string | null | undefined;
		let vb: string | null | undefined;
		if (sort === 'name') {
			va = a.name;
			vb = b.name;
		} else if (sort === 'createdAt') {
			va = a.createdAt;
			vb = b.createdAt;
		} else {
			va = a.startDate;
			vb = b.startDate;
		}
		if (va == null && vb == null) return 0;
		if (va == null) return 1;
		if (vb == null) return -1;
		return va.localeCompare(vb) * dir;
	});

	return result;
}
