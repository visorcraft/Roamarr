import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { trips, segments } from '$lib/server/db/schema';
import { viewerProjection } from '$lib/server/sharing';
import { getSettings } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export function _loadByToken(token: string) {
	if (!token) throw error(404, 'Not found');
	const t = db.select().from(trips).where(eq(trips.publicToken, token)).get();
	if (!t) throw error(404, 'Not found');
	const segs = db.select().from(segments).where(eq(segments.tripId, t.id)).all();
	return { instanceName: getSettings().instanceName, trip: viewerProjection(t, segs) };
}

export const load: PageServerLoad = ({ params }) => _loadByToken(params.token);
