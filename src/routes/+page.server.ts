import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { notifications, travelDocuments } from '$lib/server/db/schema';
import { listViewableTrips } from '$lib/server/sharing';
import { DateTime } from 'luxon';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const today = DateTime.utc().toISODate()!;
	const soon = DateTime.utc().plus({ days: 120 }).toISODate()!;
	return {
		upcoming: listViewableTrips(u.id, { startDateGte: today }),
		unread: db
			.select()
			.from(notifications)
			.where(eq(notifications.userId, u.id))
			.all()
			.filter((n) => !n.readAt).length,
		expiring: db
			.select()
			.from(travelDocuments)
			.where(
				and(
					eq(travelDocuments.userId, u.id),
					isNotNull(travelDocuments.expiresOn),
					lte(travelDocuments.expiresOn, soon)
				)
			)
			.all()
	};
};
