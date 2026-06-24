import { and, count, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import {
	fareProviders,
	fareWatches,
	notifications,
	travelDocuments
} from '$lib/server/db/schema';
import { listViewableTrips } from '$lib/server/sharing';
import { DateTime } from 'luxon';
import type { PageServerLoad } from './$types';

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
		}
	};
};
