import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { formatDestination } from '$lib/tripDestination';
import {
	fareProviders,
	fareWatches,
	notifications,
	segments,
	tripComments,
	tripJournalEntries,
	trips,
	users
} from '$lib/server/db/schema';
import { listTravelDocumentsExpiringBefore } from '$lib/server/repositories/profileRepo';
import { listEditableTripIds, listViewableTrips } from '$lib/server/sharing';
import { DateTime } from 'luxon';
import type { PageServerLoad } from './$types';

type AgendaItem =
	| {
			kind: 'segment-start';
			id: number;
			tripId: number;
			tripName: string;
			title: string;
			type: string;
			time: string;
	  }
	| {
			kind: 'segment-end';
			id: number;
			tripId: number;
			tripName: string;
			title: string;
			type: string;
			time: string;
	  }
	| {
			kind: 'trip';
			id: number;
			name: string;
			destinationLabel: string | null;
			isShared: boolean;
	  };

type AgendaSortItem =
	| ({
			kind: 'segment-start' | 'segment-end';
			id: number;
			tripId: number;
			tripName: string;
			title: string;
			type: string;
			sortAt: string;
	  } & { time?: never })
	| {
			kind: 'trip';
			id: number;
			name: string;
			destinationLabel: string | null;
			isShared: boolean;
	  };

function buildAgenda(userId: number, timezone: string): AgendaItem[] {
	const today = DateTime.now().setZone(timezone).toISODate()!;
	const viewable = listViewableTrips(userId);
	const tripNameById = new Map(viewable.map((t) => [t.id, t.name]));
	const viewableIds = viewable.map((t) => t.id);

	const agenda: AgendaSortItem[] = [];

	for (const t of viewable) {
		if (t.startDate && t.endDate && t.startDate <= today && t.endDate >= today) {
			agenda.push({
				kind: 'trip',
				id: t.id,
				name: t.name,
				destinationLabel: formatDestination(t.destinationCityName, t.destinationCountryCode),
				isShared: t.isShared
			});
		}
	}

	if (viewableIds.length > 0) {
		const segs = db.select().from(segments).where(inArray(segments.tripId, viewableIds)).all();
		for (const s of segs) {
			const startDate = DateTime.fromISO(s.startAt, { zone: 'utc' }).setZone(timezone).toISODate();
			if (startDate === today) {
				agenda.push({
					kind: 'segment-start',
					id: s.id,
					tripId: s.tripId,
					tripName: tripNameById.get(s.tripId) ?? '',
					title: s.title,
					type: s.type,
					sortAt: s.startAt
				});
			}
			if (s.endAt) {
				const endDate = DateTime.fromISO(s.endAt, { zone: 'utc' }).setZone(timezone).toISODate();
				if (endDate === today) {
					agenda.push({
						kind: 'segment-end',
						id: s.id,
						tripId: s.tripId,
						tripName: tripNameById.get(s.tripId) ?? '',
						title: s.title,
						type: s.type,
						sortAt: s.endAt
					});
				}
			}
		}
	}

	agenda.sort((a, b) => {
		if (a.kind !== 'trip' && b.kind !== 'trip') {
			return a.sortAt.localeCompare(b.sortAt);
		}
		if (a.kind !== 'trip') return -1;
		if (b.kind !== 'trip') return 1;
		return a.name.localeCompare(b.name);
	});

	return agenda.map((item) => {
		if (item.kind === 'trip') return item;
		const { sortAt, ...rest } = item;
		return {
			...rest,
			time: DateTime.fromISO(sortAt, { zone: 'utc' }).setZone(timezone).toFormat('h:mm a')
		};
	});
}

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const today = DateTime.utc().toISODate()!;
	const soon = DateTime.utc().plus({ days: u.documentExpiryLeadDays }).toISODate()!;

	const viewable = listViewableTrips(u.id);
	const upcoming = listViewableTrips(u.id, { startDateGte: today });
	const unreadRow = db
		.select({ count: count() })
		.from(notifications)
		.where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)))
		.get();
	const expiring = listTravelDocumentsExpiringBefore(u.id, soon);
	const watchesRow = db
		.select({ count: count() })
		.from(fareWatches)
		.innerJoin(fareProviders, eq(fareWatches.providerId, fareProviders.id))
		.where(eq(fareProviders.userId, u.id))
		.get();

	const viewableIds = viewable.map((t) => t.id);
	const editableIds = listEditableTripIds(u.id);
	const paymentsDue =
		editableIds.length > 0
			? db
					.select({
						segmentId: segments.id,
						tripId: segments.tripId,
						tripName: trips.name,
						title: segments.title,
						paymentDueDate: segments.paymentDueDate,
						paymentStatus: segments.paymentStatus
					})
					.from(segments)
					.innerJoin(trips, eq(segments.tripId, trips.id))
					.where(
						and(
							inArray(segments.tripId, editableIds),
							ne(segments.paymentStatus, 'fully_paid'),
							isNotNull(segments.paymentDueDate),
							lte(segments.paymentDueDate, soon),
							gt(segments.paymentDueDate, today)
						)
					)
					.orderBy(segments.paymentDueDate)
					.all()
			: [];

	const recentComments =
		viewableIds.length > 0
			? db
					.select({
						id: tripComments.id,
						tripId: tripComments.tripId,
						tripName: trips.name,
						body: tripComments.body,
						createdAt: tripComments.createdAt,
						displayName: users.displayName
					})
					.from(tripComments)
					.innerJoin(trips, eq(tripComments.tripId, trips.id))
					.innerJoin(users, eq(tripComments.userId, users.id))
					.where(inArray(tripComments.tripId, viewableIds))
					.orderBy(desc(tripComments.createdAt))
					.limit(10)
					.all()
			: [];

	const recentJournal =
		viewableIds.length > 0
			? db
					.select({
						id: tripJournalEntries.id,
						tripId: tripJournalEntries.tripId,
						tripName: trips.name,
						title: tripJournalEntries.title,
						body: tripJournalEntries.body,
						createdAt: tripJournalEntries.createdAt
					})
					.from(tripJournalEntries)
					.innerJoin(trips, eq(tripJournalEntries.tripId, trips.id))
					.where(inArray(tripJournalEntries.tripId, viewableIds))
					.orderBy(desc(tripJournalEntries.createdAt))
					.limit(10)
					.all()
			: [];

	type ActivityItem = {
		kind: 'comment' | 'journal';
		id: number;
		tripId: number;
		tripName: string;
		createdAt: string;
		body?: string;
		displayName?: string;
		title?: string;
	};
	const activity: ActivityItem[] = [
		...recentComments.map((c) => ({ kind: 'comment' as const, ...c })),
		...recentJournal.map((j) => ({ kind: 'journal' as const, ...j }))
	]
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, 10);

	return {
		upcoming: upcoming.map((t) => ({
			...t,
			destinationLabel: formatDestination(t.destinationCityName, t.destinationCountryCode)
		})),
		expiring,
		paymentsDue,
		activity,
		stats: {
			upcoming: upcoming.length,
			unread: unreadRow?.count ?? 0,
			expiring: expiring.length,
			watches: watchesRow?.count ?? 0
		},
		agenda: buildAgenda(u.id, u.timezone)
	};
};
