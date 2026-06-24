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
const FILTERS = ['active', 'archived', 'favorites'] as const;

export const load: PageServerLoad = ({ locals, url }) => {
	const u = requireUser(locals);
	const q = url.searchParams.get('q') ?? undefined;
	const tag = url.searchParams.get('tag') ?? undefined;
	const sortRaw = url.searchParams.get('sort');
	const orderRaw = url.searchParams.get('order');
	const filterRaw = url.searchParams.get('filter');
	const sort = SORT_FIELDS.includes(sortRaw as (typeof SORT_FIELDS)[number]) ? (sortRaw as (typeof SORT_FIELDS)[number]) : 'startDate';
	const order = ORDERS.includes(orderRaw as (typeof ORDERS)[number]) ? (orderRaw as (typeof ORDERS)[number]) : 'asc';
	const filter = FILTERS.includes(filterRaw as (typeof FILTERS)[number])
		? (filterRaw as (typeof FILTERS)[number])
		: 'active';
	return { trips: listViewableTrips(u.id, { q, tag, sort, order, filter }), q, tag, sort, order, filter };
};

function selectedIds(formData: FormData): number[] {
	return formData.getAll('selected').map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
}

function requireOwnedIds(userId: number, ids: number[]) {
	if (ids.length === 0) return [];
	return db
		.select({ id: trips.id })
		.from(trips)
		.where(and(inArray(trips.id, ids), eq(trips.ownerId, userId)))
		.all()
		.map((t) => t.id);
}

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const ids = selectedIds(await request.formData());
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		for (const id of requireOwnedIds(u.id, ids)) {
			cancelRemindersFor('trip', id);
			const segs = db.select({ id: segments.id }).from(segments).where(eq(segments.tripId, id)).all();
			for (const s of segs) cancelRemindersFor('segment', s.id);
			db.delete(trips).where(eq(trips.id, id)).run();
		}
		throw redirect(303, '/trips');
	},
	archive: async ({ request, locals }) => {
		const u = requireUser(locals);
		const ids = selectedIds(await request.formData());
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		for (const id of requireOwnedIds(u.id, ids)) {
			db.update(trips).set({ archived: true }).where(eq(trips.id, id)).run();
		}
		throw redirect(303, '/trips');
	},
	favorite: async ({ request, locals }) => {
		const u = requireUser(locals);
		const ids = selectedIds(await request.formData());
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		for (const id of requireOwnedIds(u.id, ids)) {
			db.update(trips).set({ favorite: true }).where(eq(trips.id, id)).run();
		}
		throw redirect(303, '/trips');
	},
	unarchive: async ({ request, locals }) => {
		const u = requireUser(locals);
		const ids = selectedIds(await request.formData());
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		for (const id of requireOwnedIds(u.id, ids)) {
			db.update(trips).set({ archived: false }).where(eq(trips.id, id)).run();
		}
		throw redirect(303, '/trips');
	},
	unfavorite: async ({ request, locals }) => {
		const u = requireUser(locals);
		const ids = selectedIds(await request.formData());
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		for (const id of requireOwnedIds(u.id, ids)) {
			db.update(trips).set({ favorite: false }).where(eq(trips.id, id)).run();
		}
		throw redirect(303, '/trips');
	}
};
