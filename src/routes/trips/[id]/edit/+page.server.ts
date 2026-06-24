import { redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip } from '$lib/server/ownership';
import { cancelRemindersFor } from '$lib/server/reminders';
import { db } from '$lib/server/db';
import { trips, segments } from '$lib/server/db/schema';
import { nowIso } from '$lib/server/tz';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const u = requireUser(locals);
	return { trip: requireOwnedTrip(u.id, Number(params.id)) };
};

export function _deleteTrip(userId: number, tripId: number) {
	requireOwnedTrip(userId, tripId);
	const segs = db.select({ id: segments.id }).from(segments).where(eq(segments.tripId, tripId)).all();
	for (const s of segs) cancelRemindersFor('segment', s.id);
	db.delete(trips).where(eq(trips.id, tripId)).run();
}

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		requireOwnedTrip(u.id, Number(params.id));
		const f = await request.formData();
		db.update(trips)
			.set({
				name: String(f.get('name')),
				destination: String(f.get('destination') ?? ''),
				startDate: String(f.get('startDate') ?? ''),
				endDate: String(f.get('endDate') ?? ''),
				notes: String(f.get('notes') ?? ''),
				updatedAt: nowIso()
			})
			.where(eq(trips.id, Number(params.id)))
			.run();
		throw redirect(303, `/trips/${params.id}`);
	},
	delete: async ({ locals, params }) => {
		const u = requireUser(locals);
		_deleteTrip(u.id, Number(params.id));
		throw redirect(303, '/trips');
	}
};
