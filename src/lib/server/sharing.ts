import { inList } from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import { segments } from './db/mongrelSchema';
import * as tripsRepo from './repositories/tripsRepo';
import type { Trip } from './repositories/tripsRepo';

export { TRIP_STATUSES } from '../tripStatus';
import type { TripStatus } from '../tripStatus';

export { listGroupsForUser } from './repositories/tripsRepo';

type Segment = {
	type: string;
	title: string;
	startAt: string;
	endAt: string | null;
	status: string;
	location: string | null;
	meetingPoint: string | null;
	meetingAt: string | null;
	confirmationNumber: string | null;
	detailsJson: string | null;
};

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
	const direct = tripsRepo.getDirectShareForTrip(trip.id, userId);
	if (direct?.permission === 'edit') return true;
	const viaGroup = tripsRepo.getGroupShareForTrip(trip.id, userId);
	return viaGroup?.permission === 'edit';
}

export function listEditableTripIds(userId: number): number[] {
	return tripsRepo.listEditableTripIdsForUser(userId);
}

export function canView(userId: number, trip: Trip) {
	if (trip.ownerId === userId) return true;
	const direct = tripsRepo.getDirectShareForTrip(trip.id, userId);
	if (direct) return true;
	const viaGroup = tripsRepo.getGroupShareForTrip(trip.id, userId);
	return !!viaGroup;
}

export function canViewDetails(userId: number, trip: Trip) {
	if (trip.ownerId === userId) return true;
	const direct = tripsRepo.getDirectShareForTrip(trip.id, userId);
	if (direct?.showDetails) return true;
	const viaGroup = tripsRepo.getGroupShareForTrip(trip.id, userId);
	return viaGroup?.showDetails ?? false;
}

function toSegmentProjection(row: Record<string, unknown>, includeDetails = false) {
	const base = {
		type: row.type as string,
		title: row.title as string,
		startAt: row.start_at as string,
		endAt: (row.end_at as string | null) ?? null,
		status: row.status as string,
		location: (row.location as string | null) ?? null,
		meetingPoint: (row.meeting_point as string | null) ?? null,
		meetingAt: (row.meeting_at as string | null) ?? null
	};
	if (!includeDetails) return base;
	return {
		...base,
		confirmationNumber: (row.confirmation_number as string | null) ?? null,
		detailsJson: (row.details_json as string | null) ?? null
	};
}

export function viewerProjection(trip: Trip, segs: Segment[], includeDetails = false) {
	return {
		id: trip.id,
		name: trip.name,
		destinationCountryCode: trip.destinationCountryCode,
		destinationCityName: trip.destinationCityName,
		destinationCityLat: trip.destinationCityLat,
		destinationCityLng: trip.destinationCityLng,
		startDate: trip.startDate,
		endDate: trip.endDate,
		status: trip.status,
		createdAt: trip.createdAt,
		archived: trip.archived,
		favorite: trip.favorite,
		tags: tripTags(trip),
		segments: segs.map((s) => ({
			type: s.type,
			title: s.title,
			startAt: s.startAt,
			endAt: s.endAt,
			status: s.status,
			location: s.location,
			meetingPoint: s.meetingPoint,
			meetingAt: s.meetingAt,
			...(includeDetails && {
				confirmationNumber: s.confirmationNumber,
				detailsJson: s.detailsJson
			})
		}))
	};
}

type ListedTrip =
	| (Trip & { isShared: false })
	| (ReturnType<typeof viewerProjection> & { isShared: true });

type SortField = 'name' | 'startDate' | 'createdAt';
type SortOrder = 'asc' | 'desc';
type TripFilter = 'active' | 'archived' | 'favorites';

export function listViewableTrips(
	userId: number,
	options?: { startDateGte?: string; q?: string; tag?: string; sort?: SortField; order?: SortOrder; filter?: TripFilter; status?: TripStatus }
): ListedTrip[] {
	const owned = tripsRepo
		.listTripsForUser(userId)
		.filter((t) => !options?.startDateGte || !t.startDate || t.startDate >= options.startDateGte);

	const shared = tripsRepo
		.listTripsSharedWithUser(userId)
		.filter((t) => !options?.startDateGte || !t.startDate || t.startDate >= options.startDateGte);

	const map = new Map<number, ListedTrip>();
	for (const t of owned) map.set(t.id, { ...t, isShared: false });
	for (const t of shared) {
		if (map.has(t.id)) continue;
		if (!canView(userId, t)) continue;
		map.set(t.id, { ...viewerProjection(t, []), isShared: true });
	}

	let result = Array.from(map.values());

	const q = options?.q?.trim();
	if (q) {
		const needle = q.toLowerCase();
		const ownedIds = result.filter((t) => !t.isShared).map((t) => t.id);
		let segmentTripIds = new Set<number>();
		if (ownedIds.length) {
			const segmentRows = kit
				.selectFrom(segments)
				.where(inList(segments.trip_id, ownedIds.map(BigInt)))
				.executeSync();
			for (const s of segmentRows) {
				const haystack = `${s.title ?? ''} ${s.location ?? ''} ${s.confirmation_number ?? ''}`.toLowerCase();
				if (haystack.includes(needle)) segmentTripIds.add(Number(s.trip_id));
			}
		}
		result = result.filter((t) => {
			const city = t.isShared
				? (t as ReturnType<typeof viewerProjection>).destinationCityName ?? ''
				: (t as Trip).destinationCityName ?? '';
			const haystack = `${t.name ?? ''} ${city}`.toLowerCase();
			if (haystack.includes(needle)) return true;
			if (!t.isShared && segmentTripIds.has(t.id)) return true;
			return false;
		});
	}

	const tag = options?.tag?.trim();
	if (tag) {
		result = result.filter((t) => tripHasTag(t, tag));
	}

	const status = options?.status;
	if (status) {
		result = result.filter((t) => t.status === status);
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
