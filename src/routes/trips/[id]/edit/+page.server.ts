import { redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { ownTrip } from '../../shared';
import { db } from '$lib/server/db';
import { trips } from '$lib/server/db/schema';
import { nowIso } from '$lib/server/tz';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const u = requireUser(locals);
	return { trip: ownTrip(u.id, Number(params.id)) };
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		ownTrip(u.id, Number(params.id));
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
	}
};
