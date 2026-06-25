import { and, count, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import {
	fareProviders,
	fareWatches,
	notifications,
	segments,
	travelDocuments
} from '$lib/server/db/schema';
import { listViewableTrips } from '$lib/server/sharing';
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
			destination: string | null;
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
			destination: string | null;
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
				destination: t.destination,
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

	const upcoming = listViewableTrips(u.id, { startDateGte: today });
	const unreadRow = db
		.select({ count: count() })
		.from(notifications)
		.where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)))
		.get();
	const expiring = db
		.select()
		.from(travelDocuments)
		.where(
			and(
				eq(travelDocuments.userId, u.id),
				isNotNull(travelDocuments.expiresOn),
				lte(travelDocuments.expiresOn, soon)
			)
		)
		.all();
	const watchesRow = db
		.select({ count: count() })
		.from(fareWatches)
		.innerJoin(fareProviders, eq(fareWatches.providerId, fareProviders.id))
		.where(eq(fareProviders.userId, u.id))
		.get();

	return {
		upcoming,
		expiring,
		stats: {
			upcoming: upcoming.length,
			unread: unreadRow?.count ?? 0,
			expiring: expiring.length,
			watches: watchesRow?.count ?? 0
		},
		agenda: buildAgenda(u.id, u.timezone)
	};
};
