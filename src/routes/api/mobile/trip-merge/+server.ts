import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { mergeTrips } from '$lib/server/tripMerge';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const { donorId, recipientId } = await request.json() as { donorId?: number; recipientId?: number };
	if (!Number.isSafeInteger(donorId) || !Number.isSafeInteger(recipientId) || donorId! < 1 || recipientId! < 1) {
		return json({ error: 'Choose both trips' }, { status: 400 });
	}
	mergeTrips(user.id, donorId!, recipientId!);
	return json({ ok: true, tripId: recipientId });
};
