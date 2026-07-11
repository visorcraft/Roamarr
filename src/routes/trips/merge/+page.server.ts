import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { mergeTrips } from '$lib/server/tripMerge';
import { setFlash } from '$lib/server/flash';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	return { trips: tripsRepo.listTripsForUser(user.id).filter((trip) => trip.ownerId === user.id) };
};

export const actions: Actions = {
	default: async ({ request, locals, cookies }) => {
		const user = requireUser(locals);
		const form = await request.formData();
		const donorId = Number(form.get('donorId'));
		const recipientId = Number(form.get('recipientId'));
		if (!Number.isInteger(donorId) || donorId < 1 || !Number.isInteger(recipientId) || recipientId < 1)
			return fail(400, { error: 'Choose both trips' });
		try { mergeTrips(user.id, donorId, recipientId); }
		catch (error) { return fail(400, { error: error instanceof Error ? error.message : 'Merge failed' }); }
		setFlash(cookies, 'Trips merged.');
		throw redirect(303, `/trips/${recipientId}`);
	}
};
