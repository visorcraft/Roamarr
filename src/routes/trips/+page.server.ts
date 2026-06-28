import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { listViewableTrips, TRIP_STATUSES } from '$lib/server/sharing';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { listSegmentsForTrip } from '$lib/server/repositories/segmentsRepo';
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
	const statusRaw = url.searchParams.get('status');
	const sort = SORT_FIELDS.includes(sortRaw as (typeof SORT_FIELDS)[number]) ? (sortRaw as (typeof SORT_FIELDS)[number]) : 'startDate';
	const order = ORDERS.includes(orderRaw as (typeof ORDERS)[number]) ? (orderRaw as (typeof ORDERS)[number]) : 'asc';
	const filter = FILTERS.includes(filterRaw as (typeof FILTERS)[number])
		? (filterRaw as (typeof FILTERS)[number])
		: 'active';
	const status = TRIP_STATUSES.includes(statusRaw as (typeof TRIP_STATUSES)[number])
		? (statusRaw as (typeof TRIP_STATUSES)[number])
		: undefined;
	return { trips: listViewableTrips(u.id, { q, tag, sort, order, filter, status }), q, tag, sort, order, filter, status };
};

function selectedIds(formData: FormData): number[] {
	return formData.getAll('selected').map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
}

function requireOwnedIds(userId: number, ids: number[]) {
	return ids.filter((id) => {
		const t = tripsRepo.getTripById(id);
		return t && t.ownerId === userId;
	});
}

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const ids = selectedIds(await request.formData());
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		for (const id of requireOwnedIds(u.id, ids)) {
			cancelRemindersFor('trip', id);
			const segs = listSegmentsForTrip(id);
			for (const s of segs) cancelRemindersFor('segment', s.id);
			tripsRepo.deleteTrip(id);
		}
		throw redirect(303, '/trips');
	},
	archive: async ({ request, locals }) => {
		const u = requireUser(locals);
		const ids = selectedIds(await request.formData());
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		for (const id of requireOwnedIds(u.id, ids)) {
			tripsRepo.updateTrip(id, { archived: true });
		}
		throw redirect(303, '/trips');
	},
	favorite: async ({ request, locals }) => {
		const u = requireUser(locals);
		const ids = selectedIds(await request.formData());
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		for (const id of requireOwnedIds(u.id, ids)) {
			tripsRepo.updateTrip(id, { favorite: true });
		}
		throw redirect(303, '/trips');
	},
	unarchive: async ({ request, locals }) => {
		const u = requireUser(locals);
		const ids = selectedIds(await request.formData());
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		for (const id of requireOwnedIds(u.id, ids)) {
			tripsRepo.updateTrip(id, { archived: false });
		}
		throw redirect(303, '/trips');
	},
	unfavorite: async ({ request, locals }) => {
		const u = requireUser(locals);
		const ids = selectedIds(await request.formData());
		if (ids.length === 0) return fail(400, { error: 'No trips selected' });
		for (const id of requireOwnedIds(u.id, ids)) {
			tripsRepo.updateTrip(id, { favorite: false });
		}
		throw redirect(303, '/trips');
	}
};
