import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from './auth';

export async function withTripAction(event: RequestEvent) {
	const user = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');
	const formData = await event.request.formData();
	return { user, tripId, formData };
}
