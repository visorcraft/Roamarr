import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from './db';
import { segments } from './db/schema';
import { nowIso } from './tz';

export interface NextCity {
	segmentId: number;
	cityName: string;
	countryCode: string;
	lat: number;
	lng: number;
	startAt: string;
	startTz: string;
}

export function selectNextSegmentCity(tripId: number): NextCity | null {
	const rows = db
		.select({
			id: segments.id,
			cityName: segments.cityName,
			countryCode: segments.countryCode,
			cityLat: segments.cityLat,
			cityLng: segments.cityLng,
			startAt: segments.startAt,
			startTz: segments.startTz
		})
		.from(segments)
		.where(eq(segments.tripId, tripId))
		.orderBy(segments.startAt)
		.all();

	const now = DateTime.fromISO(nowIso(), { zone: 'utc' });
	for (const row of rows) {
		if (!row.cityName || row.cityLat == null || row.cityLng == null || !row.countryCode) continue;
		const localStart = DateTime.fromISO(row.startAt, { zone: row.startTz || 'UTC' });
		if (!localStart.isValid) continue;
		if (localStart.toUTC() >= now) {
			return {
				segmentId: row.id,
				cityName: row.cityName,
				countryCode: row.countryCode,
				lat: row.cityLat,
				lng: row.cityLng,
				startAt: row.startAt,
				startTz: row.startTz
			};
		}
	}
	return null;
}
