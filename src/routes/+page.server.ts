import { requireUser } from '$lib/server/auth';
import { formatDestination } from '$lib/tripDestination';
import { listTravelDocumentsExpiringBefore } from '$lib/server/repositories/profileRepo';
import { countUnreadNotificationsForUser } from '$lib/server/repositories/remindersRepo';
import { listEditableTripIds, listViewableTrips } from '$lib/server/sharing';
import * as segmentsRepo from '$lib/server/repositories/segmentsRepo';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import * as tripMiscRepo from '$lib/server/repositories/tripMiscRepo';
import * as travelDataRepo from '$lib/server/repositories/travelDataRepo';
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
		const segs = segmentsRepo.listSegmentsForTrips(viewableIds);
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
	const unreadCount = countUnreadNotificationsForUser(u.id);
	const expiring = listTravelDocumentsExpiringBefore(u.id, soon);

	const viewableIds = viewable.map((t) => t.id);
	const editableIds = listEditableTripIds(u.id);

	let paymentsDue: {
		segmentId: number;
		tripId: number;
		tripName: string;
		title: string;
		paymentDueDate: string;
		paymentStatus: string;
	}[] = [];
	if (editableIds.length > 0) {
		const tripMap = new Map(viewable.map((t) => [t.id, t.name]));
		const segs = segmentsRepo.listSegmentsForTrips(editableIds).filter(
			(s) =>
				s.paymentStatus !== 'fully_paid' &&
				s.paymentDueDate != null &&
				s.paymentDueDate <= soon &&
				s.paymentDueDate > today
		);
		segs.sort((a, b) => (a.paymentDueDate ?? '').localeCompare(b.paymentDueDate ?? ''));
		paymentsDue = segs.map((s) => ({
			segmentId: s.id,
			tripId: s.tripId,
			tripName: tripMap.get(s.tripId) ?? '',
			title: s.title,
			paymentDueDate: s.paymentDueDate ?? '',
			paymentStatus: s.paymentStatus
		}));
	}

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
	const activity: ActivityItem[] = [];
	if (viewableIds.length > 0) {
		const tripNameMap = new Map(viewable.map((t) => [t.id, t.name]));
		for (const tripId of viewableIds) {
			const comments = tripsRepo.listCommentsForTrip(tripId).map((c) => ({
				kind: 'comment' as const,
				id: c.id,
				tripId,
				tripName: tripNameMap.get(tripId) ?? '',
				createdAt: c.createdAt,
				body: c.body,
				displayName: c.displayName
			}));
			const journal = tripMiscRepo.listJournalEntriesForTrip(tripId).map((j) => ({
				kind: 'journal' as const,
				id: j.id,
				tripId,
				tripName: tripNameMap.get(tripId) ?? '',
				createdAt: j.createdAt,
				title: j.title,
				body: j.body
			}));
			activity.push(...comments, ...journal);
		}
		activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		activity.splice(10);
	}

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
			unread: unreadCount,
			expiring: expiring.length,
			watches: travelDataRepo.countFareWatchesForUser(u.id)
		},
		agenda: buildAgenda(u.id, u.timezone)
	};
};
