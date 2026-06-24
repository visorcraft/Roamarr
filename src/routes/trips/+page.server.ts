import { requireUser } from '$lib/server/auth';
import { listViewableTrips } from '$lib/server/sharing';
import type { PageServerLoad } from './$types';

const SORT_FIELDS = ['name', 'startDate', 'createdAt'] as const;
const ORDERS = ['asc', 'desc'] as const;

export const load: PageServerLoad = ({ locals, url }) => {
	const u = requireUser(locals);
	const q = url.searchParams.get('q') ?? undefined;
	const sortRaw = url.searchParams.get('sort');
	const orderRaw = url.searchParams.get('order');
	const sort = SORT_FIELDS.includes(sortRaw as (typeof SORT_FIELDS)[number]) ? (sortRaw as (typeof SORT_FIELDS)[number]) : 'startDate';
	const order = ORDERS.includes(orderRaw as (typeof ORDERS)[number]) ? (orderRaw as (typeof ORDERS)[number]) : 'asc';
	return { trips: listViewableTrips(u.id, { q, sort, order }), q, sort, order };
};
