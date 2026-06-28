import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from './db';
import { segments, trips } from './db/schema';
import { nowIso } from './tz';

export interface NextCity {
	segmentId: number | null;
	cityName: string;
	countryCode: string;
	lat: number;
	lng: number;
	startAt: string | null;
	startTz: string | null;
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

// City to focus the trip map/globe on: the next upcoming segment's city, or — when no
// upcoming segment has a city — the trip's own destination city (so trips whose segments
// lack coordinates still get a map centered on where they're going).
export function tripMapCity(tripId: number): NextCity | null {
	const segmentCity = selectNextSegmentCity(tripId);
	if (segmentCity) return segmentCity;

	const trip = db
		.select({
			cityName: trips.destinationCityName,
			countryCode: trips.destinationCountryCode,
			lat: trips.destinationCityLat,
			lng: trips.destinationCityLng
		})
		.from(trips)
		.where(eq(trips.id, tripId))
		.get();

	if (trip?.cityName && trip.lat != null && trip.lng != null) {
		return {
			segmentId: null,
			cityName: trip.cityName,
			countryCode: trip.countryCode ?? '',
			lat: trip.lat,
			lng: trip.lng,
			startAt: null,
			startTz: null
		};
	}
	return null;
}
