import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { parseMobileSegment } from '$lib/server/mobileSegments';
import { addSegment } from '$lib/server/segments';
import { logAudit } from '$lib/server/audit';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals), body = await request.json() as Record<string, unknown>, tripId = Number(body.tripId);
	if (!Number.isSafeInteger(tripId) || tripId < 1) return json({ error: 'tripId must be a positive integer' }, { status: 400 });
	const segment = addSegment(user.id, tripId, parseMobileSegment(body, user.timezone)); logAudit(user.id, 'segment_create', 'segment', segment.id, { tripId }); return json({ segment }, { status: 201 });
};
