import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { trips, segments } from '$lib/server/db/schema';
import { viewerProjection } from '$lib/server/sharing';
import { getSettings } from '$lib/server/settings';
import { checkRateLimit } from '$lib/server/rateLimit';
import { isExpired } from '$lib/server/dates';
import type { PageServerLoad } from './$types';

export function _loadByToken(token: string) {
	if (!token) throw error(404, 'Not found');
	const t = db.select().from(trips).where(eq(trips.publicToken, token)).get();
	if (!t || isExpired(t.publicTokenExpiresAt)) throw error(404, 'Not found');
	const segs = db.select().from(segments).where(eq(segments.tripId, t.id)).all();
	return { instanceName: getSettings().instanceName, trip: viewerProjection(t, segs, t.publicShowDetails) };
}

export const load: PageServerLoad = ({ params, getClientAddress }) => {
	const ip = getClientAddress();
	const limit = checkRateLimit(ip, 'share:token', { maxAttempts: 20, windowMs: 60_000 });
	if (!limit.allowed) throw error(429, 'Too many requests');
	return _loadByToken(params.token);
};
