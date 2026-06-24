import { and, eq, inArray } from 'drizzle-orm';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { listViewableTrips } from '$lib/server/sharing';
import { db } from '$lib/server/db';
import { trips, segments } from '$lib/server/db/schema';
import { cancelRemindersFor } from '$lib/server/reminders';
import type { PageServerLoad } from './$types';

const SORT_FIELDS = ['name', 'startDate', 'createdAt'] as const;
const ORDERS = ['asc', 'desc'] as const;

export const load: PageServerLoad = ({ locals, url }) => {
	const u = requireUser(locals);
	const q = url.searchParams.get('q') ?? undefined;
	const tag = url.searchParams.get('tag') ?? undefined;
	const sortRaw = url.searchParams.get('sort');
	const orderRaw = url.searchParams.get('order');
	const sort = SORT_FIELDS.includes(sortRaw as (typeof SORT_FIELDS)[number]) ? (sortRaw as (typeof SORT_FIELDS)[number]) : 'startDate';
	const order = ORDERS.includes(orderRaw as (typeof ORDERS)[number]) ? (orderRaw as (typeof ORDERS)[number]) : 'asc';
	return { trips: listViewableTrips(u.id, { q, tag, sort, order }), q, tag, sort, order };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const raw = f.getAll('selected');
		const ids = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		const owned = db
			.select({ id: trips.id })
			.from(trips)
			.where(and(inArray(trips.id, ids), eq(trips.ownerId, u.id)))
			.all();
		const ownedIds = owned.map((t) => t.id);
		for (const id of ownedIds) {
			const segs = db.select({ id: segments.id }).from(segments).where(eq(segments.tripId, id)).all();
			for (const s of segs) cancelRemindersFor('segment', s.id);
			db.delete(trips).where(eq(trips.id, id)).run();
		}
		throw redirect(303, '/trips');
	}
};
